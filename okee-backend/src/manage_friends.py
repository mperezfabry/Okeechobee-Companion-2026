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
            requests_data = user_doc.get('IncomingRequests', {})
            
            return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'friends': friends_data, 'requests': requests_data})}

        # --- POST: MANAGE FRIENDS ---
        body = json.loads(event.get('body', '{}'))
        action = body.get('action') 
        user_id = body.get('user_id')
        friend_id = body.get('friend_id')
        
        # Preserving your original default perms
        perms = body.get('permissions', {'location': True, 'camp': False, 'schedule': True})

        if not all([user_id, friend_id, action]):
            return {'statusCode': 400, 'headers': headers, 'body': json.dumps({'error': 'Missing parameters'})}

        if action == 'add' or action == 'REQUEST':
            return send_request(user_id, friend_id, perms, headers)
        elif action == 'ACCEPT':
            return accept_request(user_id, friend_id, perms, headers)
        elif action == 'DENY':
            return deny_request(user_id, friend_id, headers)
        elif action == 'UPDATE':
            # Upgraded to handle specific permission toggles
            perm_key = body.get('permission_key') 
            perm_value = body.get('permission_value') 
            return update_perms(user_id, friend_id, perm_key, perm_value, headers)
        elif action == 'REMOVE':
            return remove_friend(user_id, friend_id, headers)

    except Exception as e:
        print(f"Friends Error: {e}")
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}


def send_request(user_id, friend_id, requested_perms, headers):
    try:
        table.update_item(
            Key={'UserId': friend_id},
            UpdateExpression="SET #ir.#uid = :val",
            ExpressionAttributeNames={'#ir': 'IncomingRequests', '#uid': user_id},
            ExpressionAttributeValues={':val': requested_perms},
            ConditionExpression="attribute_exists(UserId)"
        )
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ValidationException':
            # IncomingRequests map does not exist yet; create it.
            try:
                table.update_item(
                    Key={'UserId': friend_id},
                    UpdateExpression="SET #ir = :val",
                    ExpressionAttributeNames={'#ir': 'IncomingRequests'},
                    ExpressionAttributeValues={':val': {user_id: requested_perms}},
                    ConditionExpression="attribute_exists(UserId)"
                )
            except ClientError as e2:
                if e2.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'User not found'})}
                raise e2
        elif error_code == 'ConditionalCheckFailedException':
            return {'statusCode': 404, 'headers': headers, 'body': json.dumps({'error': 'User not found'})}
        else:
            return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}
        
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Request sent'})}


def accept_request(user_id, friend_id, receiver_perms, headers):
    # Default all sharing to FALSE per current reality
    final_perms = {
        'shareLocationVenue': False,
        'shareLocationCampground': False,
        'shareCampsitePin': False,
        'shareSchedule': False
    }
    
    def safe_add_friend(uid, fid, perms):
        try:
            # Try to add the friend assuming the Friends map already exists
            table.update_item(
                Key={'UserId': uid},
                UpdateExpression="SET #f.#fid = :val",
                ExpressionAttributeNames={'#f': 'Friends', '#fid': fid},
                ExpressionAttributeValues={':val': perms},
                ConditionExpression="attribute_exists(#f)"
            )
        except ClientError as e:
            if e.response['Error']['Code'] in ['ConditionalCheckFailedException', 'ValidationException']:
                # Map doesn't exist, so initialize it with the new friend
                table.update_item(
                    Key={'UserId': uid},
                    UpdateExpression="SET #f = :val",
                    ExpressionAttributeNames={'#f': 'Friends'},
                    ExpressionAttributeValues={':val': {fid: perms}}
                )
            else:
                raise 

    # Run the safe add for both users
    safe_add_friend(user_id, friend_id, final_perms)
    safe_add_friend(friend_id, user_id, final_perms)
    
    # Remove the pending request
    try:
        table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="REMOVE #ir.#fid",
            ExpressionAttributeNames={'#ir': 'IncomingRequests', '#fid': friend_id}
        )
    except ClientError:
        pass
    
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Friendship Activated'})}

def deny_request(user_id, friend_id, headers):
    table.update_item(
        Key={'UserId': user_id},
        UpdateExpression="REMOVE #ir.#fid",
        ExpressionAttributeNames={'#ir': 'IncomingRequests', '#fid': friend_id}
    )
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Request denied'})}


def remove_friend(user_id, friend_id, headers):
    try:
        # 1. Remove friend from user's list
        table.update_item(
            Key={'UserId': user_id},
            UpdateExpression="REMOVE #f.#fid",
            ExpressionAttributeNames={'#f': 'Friends', '#fid': friend_id}
        )
        # 2. Remove user from friend's list (Mutual Drop)
        table.update_item(
            Key={'UserId': friend_id},
            UpdateExpression="REMOVE #f.#uid",
            ExpressionAttributeNames={'#f': 'Friends', '#uid': user_id}
        )
    except ClientError as e:
        return {'statusCode': 500, 'headers': headers, 'body': json.dumps({'error': str(e)})}
    
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': 'Friend removed'})}


def update_perms(user_id, friend_id, perm_key, perm_value, headers):
    table.update_item(
        Key={'UserId': user_id},
        UpdateExpression="SET #f.#fid.#pkey = :pval",
        ExpressionAttributeNames={'#f': 'Friends', '#fid': friend_id, '#pkey': perm_key},
        ExpressionAttributeValues={':pval': perm_value}
    )
    return {'statusCode': 200, 'headers': headers, 'body': json.dumps({'message': f'Updated {perm_key} to {perm_value}'})}