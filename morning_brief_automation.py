import os
from datetime import datetime, timedelta
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from docx import Document

# If modifying these scopes, delete the file token.json.
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/drive.metadata.readonly'
]

def get_services():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            # Note: This requires credentials.json from Google Cloud Console
            flow = InstalledAppFlow.from_client_secret_file('credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    gmail = build('gmail', 'v1', credentials=creds)
    calendar = build('calendar', 'v3', credentials=creds)
    drive = build('drive', 'v3', credentials=creds)
    return gmail, calendar, drive

def get_today_events(service):
    now = datetime.now().strftime('%Y-%m-%dT00:00:00Z')
    end = datetime.now().strftime('%Y-%m-%dT23:59:59Z')
    events_result = service.events().list(calendarId='primary', timeMin=now, timeMax=end, singleEvents=True, orderBy='startTime').execute()
    events = events_result.get('items', [])
    return events

def get_unread_emails(service):
    results = service.users().messages().list(userId='me', q='is:unread').execute()
    messages = results.get('messages', [])
    email_summaries = []
    for msg in messages[:10]: # Limit to 10 for brevity
        m = service.users().messages().get(userId='me', id=msg['id']).execute()
        headers = m.get('payload', {}).get('headers', [])
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), 'No Subject')
        from_ = next((h['value'] for h in headers if h['name'] == 'From'), 'Unknown')
        email_summaries.append(f"{subject} (From: {from_})")
    return email_summaries

def get_recent_drive_files(service):
    results = service.files().list(pageSize=10, fields="nextPageToken, files(id, name, mimeType)").execute()
    files = results.get('files', [])
    return [f"{f['name']} ({f['mimeType']})" for f in files]

def create_report(events, emails, files):
    doc = Document()
    today_str = datetime.now().strftime('%B %d, %Y')
    doc.add_heading(f'Daily Morning Brief: {today_str}', 0)

    doc.add_heading('📅 Calendar Events', level=1)
    if not events:
        doc.add_paragraph('No upcoming events found for today.')
    else:
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            doc.add_paragraph(f"- {start}: {event['summary']}", style='List Bullet')

    doc.add_heading('📧 Unread Emails', level=1)
    if not emails:
        doc.add_paragraph('No unread emails.')
    else:
        for email in emails:
            doc.add_paragraph(email, style='List Bullet')

    doc.add_heading('📁 Recent Drive Files', level=1)
    if not files:
        doc.add_paragraph('No recent files found.')
    else:
        for file_info in files:
            doc.add_paragraph(file_info, style='List Bullet')

    filename = f"Morning_Brief_{datetime.now().strftime('%Y-%m-%d')}.docx"
    doc.save(filename)
    print(f"Report created: {filename}")

if __name__ == '__main__':
    try:
        gmail_svc, cal_svc, drive_svc = get_services()
        events = get_today_events(cal_svc)
        emails = get_unread_emails(gmail_svc)
        files = get_recent_drive_files(drive_svc)
        create_report(events, emails, files)
        print("Success!")
    except Exception as e:
        print(f"Error: {e}")
