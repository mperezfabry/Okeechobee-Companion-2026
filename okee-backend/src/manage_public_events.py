import json
import boto3
from botocore.exceptions import ClientError
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-public-events')

def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,GET,POST'
    }

    method = event.get('httpMethod')

    if method == 'GET':
        return get_events(headers)
    elif method == 'POST':
        return add_event(event, headers)
    else:
        return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Unsupported method'})}

def get_events(headers):
    try:
        response = table.scan()
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'events': response.get('Items', [])})}
    except ClientError as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}

def add_event(event, headers):
    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id')
        title = body.get('title')
        location = body.get('location')
        description = body.get('description')
        day = body.get('day') # Thursday, Friday, Saturday, Sunday

        if not all([user_id, title, location, day]):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing required fields'})}

        # Put item - uses UserId as PK to enforce one event per user
        table.put_item(
            Item={
                'UserId': user_id,
                'Title': title,
                'Location': location,
                'Description': description,
                'Day': day,
                'CreatedAt': datetime.now(timezone.utc).isoformat()
            }
        )
        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Public event added successfully!'})}
    except ClientError as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}
    except Exception as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}