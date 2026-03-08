import json
import boto3
import pygeohash as pgh
from decimal import Decimal
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
user_table = dynamodb.Table('okee-user-data')
fest_table = dynamodb.Table('okee-fest-data')

def is_point_in_polygon(lat, lon, polygon):
    inside = False
    n = len(polygon)
    if n == 0: return False
    
    p1lat, p1lon = float(polygon[0][0]), float(polygon[0][1])
    for i in range(n + 1):
        p2lat, p2lon = float(polygon[i % n][0]), float(polygon[i % n][1])
        if lon > min(p1lon, p2lon):
            if lon <= max(p1lon, p2lon):
                if lat <= max(p1lat, p2lat):
                    if p1lon != p2lon:
                        xinters = (lon - p1lon) * (p2lat - p1lat) / (p2lon - p1lon) + p1lat
                    if p1lat == p2lat or lat <= xinters:
                        inside = not inside
        p1lat, p1lon = p2lat, p2lon
    return inside

def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))
        user_id = body.get('user_id')
        lat_val = body.get('lat')
        lon_val = body.get('lon')

        if not all([user_id, lat_val, lon_val]):
            return {'statusCode': 400, 'headers': {'Access-Control-Allow-Origin': '*'}, 'body': json.dumps({'error': 'Missing data'})}

        lat = Decimal(str(lat_val))
        lon = Decimal(str(lon_val))
        display_name = body.get('display_name')

        current_zone_name = "The Void"
        current_zone_type = "OUT_OF_BOUNDS"

        # --- PRODUCTION ZONES ---
        zones_response = fest_table.scan(
            FilterExpression="#t = :val",
            ExpressionAttributeNames={"#t": "Type"},
            ExpressionAttributeValues={":val": "Zone"}
        )
        all_zones = zones_response.get('Items', [])

        # Priority 1: Venue
        venue_zones = [z for z in all_zones if z['ZoneType'] == 'VENUE']
        for zone in venue_zones:
            if is_point_in_polygon(float(lat), float(lon), zone['Coordinates']):
                current_zone_name = zone['ZoneName']
                current_zone_type = "VENUE"
                break
        
        # Priority 2: Campground
        if current_zone_type == "OUT_OF_BOUNDS":
            camp_zones = [z for z in all_zones if z['ZoneType'] == 'CAMPGROUND']
            for zone in camp_zones:
                if is_point_in_polygon(float(lat), float(lon), zone['Coordinates']):
                    current_zone_name = zone['ZoneName']
                    current_zone_type = "CAMPGROUND"
                    break

        geohash = pgh.encode(float(lat), float(lon), precision=7)
        timestamp = datetime.now(timezone.utc).isoformat()

        # Update the user's location record
        update_expr = "SET CurrentLocation = :loc, ZoneName = :zn, ZoneType = :zt, LastUpdated = :time"
        expr_attrs = {
            ':loc': {'lat': lat, 'lon': lon, 'geohash': geohash},
            ':zn': current_zone_name,
            ':zt': current_zone_type,
            ':time': timestamp,
            ':uid': user_id
        }

        if display_name:
            update_expr += ", DisplayName = :dn"
            expr_attrs[':dn'] = display_name
        else:
            update_expr += ", DisplayName = if_not_exists(DisplayName, :uid)"

        user_table.update_item(
            Key={'UserId': user_id},
            UpdateExpression=update_expr,
            ExpressionAttributeValues=expr_attrs
        )

        return {
            'statusCode': 200,
            'headers': {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'},
            'body': json.dumps({'status': 'success', 'location_tag': current_zone_name, 'is_venue': current_zone_type == "VENUE"})
        }

    except Exception as e:
        print(f"Error: {e}")
        return {'statusCode': 500, 'headers': {'Access-Control-Allow-Origin': '*'}, 'body': json.dumps({'error': str(e)})}