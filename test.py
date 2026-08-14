import urllib.request
import urllib.error
import ssl
import json

url = 'https://umxyyfneyhmjlfujlgkk.supabase.co'
key = 'sb_publishable_l7gBFU9vkSjORhrYlPCy1A_ga4Vq53C'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# 1. Upsert
body = json.dumps({"pdf_id": "test-pdf-id", "content": "hello from test"}).encode('utf-8')
req_upsert = urllib.request.Request(f"{url}/rest/v1/pdf_notes?on_conflict=pdf_id", data=body, headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation,resolution=merge-duplicates"
}, method='POST')

try:
    with urllib.request.urlopen(req_upsert, context=ctx) as response:
        print("Upsert Success:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"Upsert HTTP Error: {e.code} {e.reason}")
    print(e.read().decode('utf-8'))

# 2. Select
req_select = urllib.request.Request(f"{url}/rest/v1/pdf_notes?pdf_id=eq.test-pdf-id", headers={
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
})

try:
    with urllib.request.urlopen(req_select, context=ctx) as response:
        print("Select Success:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"Select HTTP Error: {e.code} {e.reason}")
    print(e.read().decode('utf-8'))

