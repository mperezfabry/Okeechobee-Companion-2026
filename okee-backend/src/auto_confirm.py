def lambda_handler(event, context):
    # 1. Auto-confirm the user (skips the verification code step)
    event['response']['autoConfirmUser'] = True
    
    # 2. Auto-verify the email (so Cognito doesn't try to send a code later)
    if 'email' in event['request']['userAttributes']:
        event['response']['autoVerifyEmail'] = True
        
    return event