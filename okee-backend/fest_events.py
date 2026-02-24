import json
import boto3
import uuid

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-fest-data') # Events live in the festival data table

def lambda_handler(event, context):
    body = json.loads(event.get('body', '{}'))
    action = body.get('action') # CREATE, GET, DELETE
    
    if action == 'CREATE':
        event_id = f"EVENT#{uuid.uuid4().hex[:8]}"
        item = {
            'EntityId': event_id,
            'Type': 'CommunityEvent',
            'Name': body.get('name'),
            'Description': body.get('description'),
            'Location': body.get('location'), # [lat, lng]
            'StartTime': body.get('start_time'),
            'Organizer': body.get('user_id'),
            'TrustLevel': 'UserGenerated'
        }
        table.put_item(Item=item)
        return {'statusCode': 201, 'body': json.dumps({'event_id': event_id})}

    elif action == 'GET':
        # Retrieve all active community events
        # In a real scenario, we'd filter by time so old meetups don't clutter the map
        response = table.scan(
            FilterExpression="#t = :val",
            ExpressionAttributeNames={"#t": "Type"},
            ExpressionAttributeValues={":val": "CommunityEvent"}
        )
        return {'statusCode': 200, 'body': json.dumps(response.get('Items', []))}