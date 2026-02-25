import json
import boto3
import uuid
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-map-reports')

def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST'
    }
    
    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id', 'Anonymous')
        lat = body.get('lat')
        lon = body.get('lon')
        description = body.get('description', 'No description provided')

        if not lat or not lon:
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing coordinates'})}

        report_id = str(uuid.uuid4())
        
        table.put_item(Item={
            'ReportId': report_id,
            'UserId': user_id,
            'Timestamp': datetime.now(timezone.utc).isoformat(),
            'Coordinates': {'lat': str(lat), 'lon': str(lon)},
            'Description': description,
            'Status': 'PENDING'
        })

        return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Report received. Thanks for the help!'})}

    except Exception as e:
        print(f"Report Error: {e}")
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}