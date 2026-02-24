import os
import json
import requests
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
    # Execute the function to pull the secret
    client_secret = get_spotify_secret()
    
    redirect_uri = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod/auth/callback'

    auth_string = f"{client_id}:{client_secret}"
    auth_header = base64.b64encode(auth_string.encode()).decode()

    token_url = 'https://accounts.spotify.com/api/token'
    headers = {
        'Authorization': f'Basic {auth_header}',
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    payload = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirect_uri
    }

    response = requests.post(token_url, headers=headers, data=payload)
    token_data = response.json()

    if response.status_code != 200:
        return {'statusCode': response.status_code, 'body': json.dumps(token_data)}

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
        return {'statusCode': 500, 'body': str(e)}

    # Redirect the user back to the local frontend with the success flag
    # (When you host the app for real, you'll change localhost to your custom domain)
    frontend_url = 'http://localhost:3000/?auth=success'
    return {
        'statusCode': 302,
        'headers': {
            'Location': frontend_url
        }
    }