import boto3
import requests
import base64
import time

# --- AWS INIT ---
session = boto3.Session(profile_name='okee')
ssm = session.client('ssm')
dynamodb = session.resource('dynamodb')
table = dynamodb.Table('okee-lineup-data')

# --- SPOTIFY AUTH ---
def get_secrets():
    id_param = ssm.get_parameter(Name='SpotifyClientId')
    secret_param = ssm.get_parameter(Name='SpotifyClientSecret', WithDecryption=True)
    return id_param['Parameter']['Value'], secret_param['Parameter']['Value']


def get_token(client_id, client_secret):
    auth_str = f"{client_id}:{client_secret}"
    b64_auth = base64.b64encode(auth_str.encode()).decode()

    response = requests.post(
        "https://accounts.spotify.com/api/token",
        headers={
            "Authorization": f"Basic {b64_auth}",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        data={"grant_type": "client_credentials"}
    )

    response.raise_for_status()
    return response.json()["access_token"]


# --- SAFE REQUEST WRAPPER ---
def spotify_get(url, token, params=None):
    response = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        params=params
    )

    if response.status_code == 401:
        raise Exception("TOKEN_EXPIRED")

    if response.status_code == 429:
        retry_after = int(response.headers.get("Retry-After", 1))
        print(f"⏳ Rate limited. Sleeping {retry_after}s...")
        time.sleep(retry_after)
        return spotify_get(url, token, params)

    if response.status_code != 200:
        print(f"⚠ Spotify error {response.status_code}: {response.text}")
        return None

    return response.json()


# --- RESOLVE ARTIST ---
def resolve_artist(name, token):
    data = spotify_get(
        "https://api.spotify.com/v1/search",
        token,
        {"q": name, "type": "artist", "limit": 10}
    )

    if not data:
        return None

    items = data.get("artists", {}).get("items", [])
    if not items:
        return None

    # Exact match first
    exact = [a for a in items if a.get("name", "").lower() == name.lower()]
    candidates = exact if exact else items

    # Highest popularity wins
    candidates.sort(key=lambda x: x.get("popularity", 0), reverse=True)

    return candidates[0]


# --- GET TOP TRACK ---
def get_top_track(artist_name, token):
    data = spotify_get(
        "https://api.spotify.com/v1/search",
        token,
        {"q": f"artist:{artist_name}", "type": "track", "limit": 1, "market": "US"}
    )

    if not data:
        return None

    tracks = data.get("tracks", {}).get("items", [])
    if not tracks:
        return None

    return tracks[0]["id"]


# --- MAIN ---
def seed():
    client_id, client_secret = get_secrets()
    token = get_token(client_id, client_secret)

    # Load artist list
    artists = []
    try:
        with open('2026okeeartists.txt', 'r', encoding='utf-8') as f:
            for line in f:
                clean = line.strip()
                if clean and not clean.startswith("#"):
                    artists.append(clean)
    except Exception as e:
        print(f"❌ Error reading artists file: {e}")
        return

    print(f"Found {len(artists)} artists. Seeding...\n")

    with table.batch_writer() as batch:
        for idx, artist_name in enumerate(artists, start=1):

            print(f"Resolving: {artist_name}")

            try:
                artist = resolve_artist(artist_name, token)

                if not artist:
                    print("  ❌ No artist found.")
                    continue

                artist_id = artist["id"]
                print(f"  ✔ Matched: {artist['name']} (popularity {artist.get('popularity', 0)})")

                track_id = get_top_track(artist_name, token)

                if not track_id:
                    print("  ❌ No top track found.")
                    continue

                item = {
                    "ArtistId": str(idx),
                    "Name": artist_name,
                    "Stage": "TBD",
                    "Time": "TBD",
                    "SpotifyURI": f"spotify:track:{track_id}"
                }

                batch.put_item(Item=item)
                print(f"  🎵 Stored track: {track_id}")

                time.sleep(0.2)

            except Exception as e:
                if str(e) == "TOKEN_EXPIRED":
                    print("  🔄 Token expired. Refreshing...")
                    token = get_token(client_id, client_secret)
                    print("  ⚠ Skipping this artist. Re-run script to catch missed ones.")
                else:
                    print(f"  ❌ Unexpected error: {e}")

    print("\n✅ Seeding complete.")


if __name__ == "__main__":
    seed()