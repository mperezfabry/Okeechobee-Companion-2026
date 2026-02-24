import os
import urllib.parse

def lambda_handler(event, context):
    client_id = os.environ.get('SPOTIFY_CLIENT_ID')
    # Use your live API endpoint
    redirect_uri = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod/auth/callback' 
    
    query_params_in = event.get('queryStringParameters', {})
    user_id = query_params_in.get('user_id')
    
    if not user_id:
        return {'statusCode': 400, 'body': 'Missing user_id'}

    scopes = 'user-library-read user-library-modify streaming'
    
    query_params_out = {
        'client_id': client_id,
        'response_type': 'code',
        'redirect_uri': redirect_uri,
        'scope': scopes,
        'state': user_id, 
        'show_dialog': 'true'
    }
    
    auth_url = f"https://accounts.spotify.com/authorize?{urllib.parse.urlencode(query_params_out)}"
    
    return {
        'statusCode': 302,
        'headers': {
            'Location': auth_url
        }
    }