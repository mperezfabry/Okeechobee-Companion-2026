import json
import boto3
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
user_table = dynamodb.Table('okee-user-data')

def lambda_handler(event, context):
    # Always return these headers, even on a crash
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    }
    
    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id')
        active = body.get('active')
        target = body.get('target', 'everyone') 

        if not user_id or active is None:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing user_id or active'})}

        # Update DynamoDB
        user_table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="SET SosStatus = :sos, LastUpdated = :time",
            ExpressionAttributeValues={
                ':sos': {
                    'active': active,
                    'broadcastTarget': target
                },
                ':time': datetime.now(timezone.utc).isoformat()
            }
        )

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': f'SOS set to {active}'})
        }

    except Exception as e:
        print(f"SOS Error: {e}")
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}