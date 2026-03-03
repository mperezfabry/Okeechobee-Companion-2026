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


# --- DYNAMODB WIPE ---
def clear_table():
    print("Clearing existing ghost data from DynamoDB...")
    try:
        keys = [k['AttributeName'] for k in table.key_schema]
        scan = table.scan(ProjectionExpression=", ".join(keys))
        
        with table.batch_writer() as batch:
            for each in scan.get('Items', []):
                batch.delete_item(Key=each)
                
        while 'LastEvaluatedKey' in scan:
            scan = table.scan(
                ProjectionExpression=", ".join(keys),
                ExclusiveStartKey=scan['LastEvaluatedKey']
            )
            with table.batch_writer() as batch:
                for each in scan.get('Items', []):
                    batch.delete_item(Key=each)
        print("Table cleared.\n")
    except Exception as e:
        print(f"❌ Error clearing table: {e}")


# --- HARDCODED FIXES ---
MANUAL_FIXES = {
    "Apache": {"name": "Apashe", "artist_id": "1fd3fmwlhrDl2U5wbbPQYN"},
    "Aquachobee Dub Reggae": {"name": "Aquachobee Dub Reggae", "artist_id": "5wdQ2IkL8WASlcyt0x2s8Q"},
    "Cut & Sew": {"name": "Cut & Sew", "artist_id": None},
    "GRiZ Chasing the Golden Hour": {"name": "GRiZ Chasing the Golden Hour", "artist_id": "25oLRSUjJk4YHNUsQXk7Ut"},
    "Ian": {"name": "Ian", "artist_id": "23hzc59PkIUau13dqXx5Ef"},
    "Lightcode by LSDREAM": {"name": "Lightcode by LSDREAM", "artist_id": "0Nfr5f8rhhP04vt0U8kC28"},
    "Maure": {"name": "Maure", "artist_id": None},
    "Pirate Wifi": {"name": "Pirate Wifi", "artist_id": None},
    "POWOW!": {"name": "POWOW!", "artist_id": None},
    "The Scientist Dubmaster": {"name": "Scientist", "artist_id": "1edl5fzpdS471TaQ8Bgs3w"},
    "Truth": {"name": "Truth", "artist_id": "0ZDCCJSvjcdJZH9hOl1uYc"}
}


# --- MAIN ---
def seed():
    clear_table()

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
        for idx, raw_artist_name in enumerate(artists, start=1):

            print(f"Resolving: {raw_artist_name}")

            # Check manual fixes first
            if raw_artist_name in MANUAL_FIXES:
                fix = MANUAL_FIXES[raw_artist_name]
                print(f"  ✔ Using manual fix for: {fix['name']}")
                
                artist_id = fix["artist_id"]
                uri = f"spotify:artist:{artist_id}" if artist_id else "TBD"

                item = {
                    "ArtistId": str(idx),
                    "Name": fix["name"],
                    "Stage": "TBD",
                    "Time": "TBD",
                    "SpotifyURI": uri
                }
                
                batch.put_item(Item=item)
                print(f"  🎵 Stored hardcoded URI: {uri}")
                continue

            # Default API flow
            try:
                artist = resolve_artist(raw_artist_name, token)

                if not artist:
                    print("  ❌ No artist found.")
                    continue

                artist_id = artist["id"]
                artist_name = artist["name"]
                print(f"  ✔ Matched: {artist_name} (popularity {artist.get('popularity', 0)})")

                item = {
                    "ArtistId": str(idx),
                    "Name": artist_name,
                    "Stage": "TBD",
                    "Time": "TBD",
                    "SpotifyURI": f"spotify:artist:{artist_id}"
                }

                batch.put_item(Item=item)
                print(f"  🎵 Stored artist URI: spotify:artist:{artist_id}")

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