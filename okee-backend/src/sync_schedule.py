import json
import boto3
import requests
from bs4 import BeautifulSoup
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('okee-fest-data')

# Target URL (You will update this when the official schedule page drops)
SCHEDULE_URL = "https://okeechobeefest.com/schedule" 

def lambda_handler(event, context):
    try:
        # 1. Fetch the webpage
        headers = {'User-Agent': 'Mozilla/5.0'} # Spoof a standard browser
        response = requests.get(SCHEDULE_URL, headers=headers, timeout=10)
        response.raise_for_status()
        
        # 2. Parse the HTML
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # NOTE: These selectors are placeholders. You will inspect the live 
        # HTML and update these classes (e.g., 'artist-card', 'time-slot').
        performances = []
        for stage_block in soup.find_all('div', class_='stage-container'):
            stage_name = stage_block.find('h2').text.strip()
            
            for artist_block in stage_block.find_all('div', class_='artist-slot'):
                artist_name = artist_block.find('h3').text.strip()
                start_time = artist_block['data-start'] # Assuming they use data attributes
                end_time = artist_block['data-end']
                
                performances.append({
                    'EntityId': f"ARTIST#{artist_name.replace(' ', '').upper()}",
                    'Type': 'Artist',
                    'Name': artist_name,
                    'Stage': stage_name,
                    'StartTime': start_time,
                    'EndTime': end_time
                })

        # 3. Write updates to DynamoDB
        # Using a batch writer for efficiency
        with table.batch_writer() as batch:
            for perf in performances:
                batch.put_item(Item=perf)
                
        return {
            'statusCode': 200,
            'body': json.dumps({'message': f'Synced {len(performances)} performances'})
        }

    except requests.exceptions.RequestException as e:
        return {'statusCode': 502, 'body': json.dumps({'error': f'Failed to fetch schedule: {str(e)}'})}
    except Exception as e:
         return {'statusCode': 500, 'body': json.dumps({'error': f'Parsing/Database error: {str(e)}'})}