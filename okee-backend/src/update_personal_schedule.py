import json
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-user-data')

def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    }

    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id')
        artist_id = body.get('artist_id')
        action = body.get('action') # 'ADD' or 'REMOVE'

        if not all([user_id, artist_id, action]):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing parameters'})}

        if action == 'ADD':
            return add_to_schedule(user_id, artist_id, headers)
        elif action == 'REMOVE':
            return remove_from_schedule(user_id, artist_id, headers)
        else:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Invalid action'})}

    except Exception as e:
        print(f"Schedule Error: {e}")
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}

def add_to_schedule(user_id, artist_id, headers):
    try:
        # Use list_append and if_not_exists to handle the case where PersonalSchedule doesn't exist
        table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="SET PersonalSchedule = list_append(if_not_exists(PersonalSchedule, :empty_list), :artist)",
            ExpressionAttributeValues={
                ':artist': [artist_id],
                ':empty_list': []
            },
            # Prevent duplicates if possible, though list_append doesn't check
            # For a production app, we might use a Set or check if exists first
        )
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Added to schedule'})}
    except ClientError as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}

def remove_from_schedule(user_id, artist_id, headers):
    try:
        # DynamoDB doesn't have a direct "remove from list by value" without an index
        # We'll fetch, filter, and save
        response = table.get_item(Key={'UserId': user_id})
        user_doc = response.get('Item', {})
        schedule = user_doc.get('PersonalSchedule', [])
        
        if artist_id in schedule:
            schedule.remove(artist_id)
            table.update_item(
                Key={'UserId': user_id},
                UpdateExpression="SET PersonalSchedule = :s",
                ExpressionAttributeValues={':s': schedule}
            )
        
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Removed from schedule'})}
    except ClientError as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}