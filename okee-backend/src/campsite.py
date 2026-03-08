import json
import boto3
import os
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
user_table = dynamodb.Table(os.environ.get('USER_DATA_TABLE', 'okee-user-data'))

def lambda_handler(event, context):
    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "OPTIONS,POST",
        "Access-Control-Allow-Headers": "Content-Type"
    }
    
    if event.get('httpMethod') == 'OPTIONS':
        return {"statusCode": 200, "headers": headers}

    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id')
        lat = body.get('lat')
        lon = body.get('lon')

        if not user_id or lat is None or lon is None:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps({"error": "Missing user_id, lat, or lon"})
            }

        # Save the campsite location to the user's profile
        user_table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="SET campsite = :c",
            ExpressionAttributeValues={
                ':c': {
                    'lat': lat,
                    'lon': lon,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }
            }
        )

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps({"status": "Campsite saved successfully"})
        }
    except Exception as e:
        print(f"Error: {e}")
        return {
            "statusCode": 500, 
            "headers": headers,
            "body": json.dumps({"error": str(e)})
        }