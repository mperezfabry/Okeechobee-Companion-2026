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
lineup_table = dynamodb.Table('okee-lineup-data') 
reports_table = dynamodb.Table('okee-map-reports') 

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
        # 1. Get user data
        user_response = user_table.get_item(Key={'UserId': user_id})
        user_doc = user_response.get('Item', {})
        friend_ids = list(user_doc.get('Friends', {}).keys())
        my_campsite = user_doc.get('campsite')
        my_schedule = user_doc.get('PersonalSchedule', [])
        display_name = user_doc.get('DisplayName', user_id)
        spotify_connected = 'SpotifyAccessToken' in user_doc
        
        friends_location_data = []

        # 2. Fetch friend data with New Granular Privacy logic
        if friend_ids:
            keys_to_get = [{'UserId': fid} for fid in friend_ids]
            batch_response = dynamodb.batch_get_item(
                RequestItems={
                    'okee-user-data': {
                        'Keys': keys_to_get,
                        'ProjectionExpression': 'UserId, DisplayName, CurrentLocation, Friends, SosStatus, ZoneType, campsite, PersonalSchedule'
                    }
                }
            )
            
            friend_docs = batch_response.get('Responses', {}).get('okee-user-data', [])
            
            for f_doc in friend_docs:
                # Get the permissions THAT friend gave to THIS user
                friend_permissions = f_doc.get('Friends', {}).get(user_id, {})
                venue_shared = friend_permissions.get('shareLocationVenue', False)
                camp_shared = friend_permissions.get('shareLocationCampground', False)
                pin_shared = friend_permissions.get('shareCampsitePin', False)
                schedule_shared = friend_permissions.get('shareSchedule', False)

                friend_payload = {
                    'user_id': f_doc['UserId'],
                    'name': f_doc.get('DisplayName', f_doc['UserId']),
                    'zone': f_doc.get('ZoneType', 'OUT_OF_BOUNDS')
                }

                # Determine GPS visibility
                is_gps_visible = False
                if friend_payload['zone'] == 'VENUE' and venue_shared:
                    is_gps_visible = True
                elif friend_payload['zone'] == 'CAMPGROUND' and camp_shared:
                    is_gps_visible = True
                
                if is_gps_visible and 'CurrentLocation' in f_doc:
                    friend_payload['location'] = f_doc['CurrentLocation']
                    friend_payload['sos_active'] = f_doc.get('SosStatus', {}).get('active', False)

                # Add Campsite if shared
                if pin_shared and f_doc.get('campsite'):
                    friend_payload['campsite'] = f_doc['campsite']

                # Add Schedule if shared
                if schedule_shared:
                    friend_payload['schedule'] = f_doc.get('PersonalSchedule', [])

                friends_location_data.append(friend_payload)

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
                    sos_alerts.append({ 'user_id': alert['UserId'], 'location': alert['CurrentLocation'] })

        # 4. Fetch App Data
        zones = fest_table.scan(FilterExpression="#t = :val", ExpressionAttributeNames={"#t": "Type"}, ExpressionAttributeValues={":val": "Zone"}).get('Items', [])
        lineup = lineup_table.scan().get('Items', [])
        reports = reports_table.scan().get('Items', [])
        
        public_events_table = dynamodb.Table('okee-public-events')
        public_events = public_events_table.scan().get('Items', [])

        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*', 
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,GET'
            },
            'body': json.dumps({
                'my_campsite': my_campsite,
                'my_schedule': my_schedule,
                'display_name': display_name,
                'spotify_connected': spotify_connected,
                'friends': friends_location_data,
                'nearby_sos': sos_alerts,
                'zones': zones,
                'lineup': lineup,
                'reports': reports,
                'public_events': public_events
            }, cls=DecimalEncoder)
        }

    except ClientError as e:
        return { 'statusCode': 500, 'headers': {'Access-Control-Allow-Origin': '*'}, 'body': json.dumps({'error': str(e)}) }