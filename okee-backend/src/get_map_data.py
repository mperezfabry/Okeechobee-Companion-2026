import json
import boto3
import pygeohash as pgh
import decimal
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key, Attr

# Helper to convert DynamoDB Decimals into standard JSON floats
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)

dynamodb = boto3.resource('dynamodb')
user_table = dynamodb.Table('okee-user-data')
fest_table = dynamodb.Table('okee-fest-data') 

def lambda_handler(event, context):
    query_params = event.get('queryStringParameters', {}) or {}
    user_id = query_params.get('user_id')
    lat_str = query_params.get('lat')
    lon_str = query_params.get('lon')

    if not user_id:
        return {
            'statusCode': 400, 
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'user_id required'})
        }

    try:
        # 1. Get the requesting user's profile to find their friend list
        user_response = user_table.get_item(Key={'UserId': user_id})
        user_doc = user_response.get('Item', {})
        friend_ids = list(user_doc.get('Friends', {}).keys())
        
        friends_location_data = []

        # 2. Fetch friend data if they have friends
        if friend_ids:
            keys_to_get = [{'UserId': fid} for fid in friend_ids]
            batch_response = dynamodb.batch_get_item(
                RequestItems={
                    'okee-user-data': {
                        'Keys': keys_to_get,
                        'ProjectionExpression': 'UserId, DisplayName, CurrentLocation, Friends, SosStatus, ZoneType'
                    }
                }
            )
            
            friend_docs = batch_response.get('Responses', {}).get('okee-user-data', [])
            
            for f_doc in friend_docs:
                friend_permissions = f_doc.get('Friends', {}).get(user_id, {})
                base_location_shared = friend_permissions.get('shareLocation', False)
                camp_location_shared = friend_permissions.get('shareCamp', False)

                if base_location_shared and 'CurrentLocation' in f_doc:
                    friend_zone_type = f_doc.get('ZoneType', 'OUT_OF_BOUNDS')
                    
                    # --- THE PRIVACY WALL ---
                    is_visible = False
                    if friend_zone_type == 'VENUE':
                        is_visible = True
                    elif friend_zone_type == 'CAMPGROUND' and camp_location_shared:
                        is_visible = True
                    
                    if is_visible:
                        friends_location_data.append({
                            'user_id': f_doc['UserId'],
                            'name': f_doc.get('DisplayName', 'Unknown'),
                            'location': f_doc['CurrentLocation'],
                            'zone': friend_zone_type,
                            'sos_active': f_doc.get('SosStatus', {}).get('active', False)
                        })

        # 3. Find nearby SOS broadcasts
        sos_alerts = []
        if lat_str and lon_str:
            search_geohash_prefix = pgh.encode(float(lat_str), float(lon_str), precision=5)
            sos_response = user_table.scan(
                FilterExpression=Attr('SosStatus.active').eq(True) & 
                                 Attr('SosStatus.broadcastTarget').eq('everyone') &
                                 Attr('CurrentLocation.geohash').begins_with(search_geohash_prefix)
            )
            
            for alert in sos_response.get('Items', []):
                if alert['UserId'] != user_id and alert['UserId'] not in friend_ids:
                    sos_alerts.append({
                        'user_id': alert['UserId'],
                        'location': alert['CurrentLocation']
                    })

        # 4. Fetch all geofenced zones for the map
        zones_response = fest_table.scan(
            FilterExpression="#t = :val",
            ExpressionAttributeNames={"#t": "Type"},
            ExpressionAttributeValues={":val": "Zone"}
        )
        zones = zones_response.get('Items', [])

        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*', 
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,GET'
            },
            'body': json.dumps({
                'friends': friends_location_data,
                'nearby_sos': sos_alerts,
                'zones': zones
            }, cls=DecimalEncoder)
        }

    except ClientError as e:
        return {
            'statusCode': 500, 
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': str(e)})
        }