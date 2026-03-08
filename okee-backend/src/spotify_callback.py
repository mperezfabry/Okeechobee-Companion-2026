import os
import json
import urllib.request
import urllib.parse
import base64
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-user-data')
ssm = boto3.client('ssm')

def get_spotify_secret():
    secret_name = os.environ['SPOTIFY_SECRET_NAME']
    response = ssm.get_parameter(Name=secret_name, WithDecryption=True)
    return response['Parameter']['Value']

def lambda_handler(event, context):
    query_params = event.get('queryStringParameters', {})
    code = query_params.get('code')
    user_id = query_params.get('state') 
    
    if not code or not user_id:
        return {'statusCode': 400, 'body': 'Missing code or state parameter'}

    client_id = os.environ.get('SPOTIFY_CLIENT_ID')
    
    try:
        client_secret = get_spotify_secret()
    except Exception as e:
        print(f"SSM Error: {e}")
        return {'statusCode': 500, 'body': f"Server Error: Could not retrieve secrets. {str(e)}"}
    
    redirect_uri = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod/auth/callback'

    auth_string = f"{client_id}:{client_secret}"
    auth_header = base64.b64encode(auth_string.encode()).decode()

    token_url = 'https://accounts.spotify.com/api/token'
    
    # Prepare request using standard library (no 'requests' dependency needed)
    data = urllib.parse.urlencode({
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri
    }).encode('utf-8')
    
    req = urllib.request.Request(token_url, data=data, headers={
        'Authorization': f'Basic {auth_header}',
        'Content-Type': 'application/x-www-form-urlencoded'
    })

    try:
        with urllib.request.urlopen(req) as response:
            response_body = response.read()
            token_data = json.loads(response_body)
    except urllib.error.HTTPError as e:
        return {'statusCode': e.code, 'body': e.read().decode()}
    except Exception as e:
        return {'statusCode': 500, 'body': f"Token exchange failed: {str(e)}"}

    try:
        table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="set SpotifyAccessToken=:a, SpotifyRefreshToken=:r",
            ExpressionAttributeValues={
                ':a': token_data.get('access_token'),
                ':r': token_data.get('refresh_token')
            }
        )
    except ClientError as e:
        return {'statusCode': 500, 'body': f"Database Error: {str(e)}"}

    # Redirect back to frontend with user_id so app.js can pick it up
    base_url = os.environ.get('FRONTEND_URL', 'http://localhost:5500/')
    frontend_url = f'{base_url}?user_id={user_id}'
    return {
        'statusCode': 302,
        'headers': {
            'Location': frontend_url
        }
    }

