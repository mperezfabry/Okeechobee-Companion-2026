import json
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-user-data')

def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
    }

    try:
        http_method = event.get('httpMethod')

        # --- GET: FETCH FRIENDS LIST ---
        if http_method == 'GET':
            user_id = event.get('queryStringParameters', {}).get('user_id')
            if not user_id:
                return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing user_id'})}
            
            response = table.get_item(Key={'UserId': user_id})
            user_doc = response.get('Item', {})
            friends_data = user_doc.get('Friends', {})
            
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'friends': friends_data})}

        # --- POST: MANAGE FRIENDS ---
        body = json.loads(event.get('body', '{}'))
        action = body.get('action') 
        user_id = body.get('user_id')
        friend_id = body.get('friend_id')
        
        # Preserving your original default perms
        perms = body.get('permissions', {'location': True, 'camp': False, 'schedule': True})

        if not all([user_id, friend_id, action]):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing parameters'})}

        # FAST-TRACK FOR V1 TESTING
        if action == 'add':
            return accept_request(user_id, friend_id, perms, headers)

        if action == 'REQUEST':
            return send_request(user_id, friend_id, perms, headers)
        elif action == 'ACCEPT':
            return accept_request(user_id, friend_id, perms, headers)
        elif action == 'UPDATE':
            # Upgraded to handle specific permission toggles
            perm_key = body.get('permission_key') 
            perm_value = body.get('permission_value') 
            return update_perms(user_id, friend_id, perm_key, perm_value, headers)

    except Exception as e:
        print(f"Friends Error: {e}")
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}


def send_request(user_id, friend_id, requested_perms, headers):
    relationship_id = f"FRIEND#{sorted([user_id, friend_id])[0]}#{sorted([user_id, friend_id])[1]}"
    table.put_item(Item={
        'UserId': relationship_id, 
        'Type': 'Friendship',
        'Status': 'PENDING',
        'RequesterId': user_id,
        'ReceiverId': friend_id,
        'RequesterPerms': requested_perms
    })
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Request sent'})}


def accept_request(user_id, friend_id, receiver_perms, headers):
    final_perms = {
        'shareLocation': receiver_perms.get('location', True), 
        'shareCamp': receiver_perms.get('camp', False),
        'shareSchedule': receiver_perms.get('schedule', True) # Preserved
    }
    
    def safe_add_friend(uid, fid, perms):
        try:
            # Try to add the friend assuming the Friends map already exists
            table.update_item(
                Key={'UserId': uid},
                UpdateExpression="SET Friends.#fid = :val",
                ExpressionAttributeNames={'#fid': fid},
                ExpressionAttributeValues={':val': perms},
                ConditionExpression="attribute_exists(Friends)"
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                # Map doesn't exist, so initialize it with the new friend
                table.update_item(
                    Key={'UserId': uid},
                    UpdateExpression="SET Friends = :val",
                    ExpressionAttributeValues={':val': {fid: perms}}
                )
            else:
                raise 

    # Run the safe add for both users
    safe_add_friend(user_id, friend_id, final_perms)
    safe_add_friend(friend_id, user_id, final_perms)
    
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Friendship Activated'})}


def update_perms(user_id, friend_id, perm_key, perm_value, headers):
    table.update_item(
        Key={'UserId': user_id},
        UpdateExpression="SET Friends.#fid.#pkey = :pval",
        ExpressionAttributeNames={'#fid': friend_id, '#pkey': perm_key},
        ExpressionAttributeValues={':pval': perm_value}
    )
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': f'Updated {perm_key} to {perm_value}'})}