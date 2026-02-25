import json
import boto3
import os

dynamodb = boto3.resource('dynamodb')
# Make sure this matches your actual table name in template.yaml
user_table = dynamodb.Table(os.environ.get('USER_DATA_TABLE', 'okee-user-data'))

def lambda_handler(event, context):
    try:
        body = json.loads(event['body'])
        user_id = body.get('user_id')
        lat = body.get('lat')
        lon = body.get('lon')

        if not user_id or lat is None or lon is None:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing user_id, lat, or lon"})
            }

        # Save the campsite location to the user's profile
        user_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression="SET campsite = :c",
            ExpressionAttributeValues={
                ':c': {
                    'lat': str(lat),
                    'lon': str(lon),
                    'timestamp': int(boto3.resource('dynamodb').meta.client.get_waiter('table_exists').waiter_config.get('delay', 0)) # or just use time.time()
                }
            }
        )

        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST"
            },
            "body": json.dumps({"status": "Campsite saved successfully"})
        }
    except Exception as e:
        print(f"Error: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}