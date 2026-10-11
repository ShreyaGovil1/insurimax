import urllib.request
import json

def test_req(name, url, body=None):
    if body:
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
    else:
        req = urllib.request.Request(url, method='GET')
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"[{name}] SUCCESS!")
        print(f"   Patient: {data['claim']['patient_name']} | Hospital: {data['claim']['hospital_name']}")
        print(f"   Billed: {data['claim']['billed_amount']} | Status: {data['claim']['status']}")
        print(f"   Issue: {data['escalation']['issue_type']}")
        print(f"   Grievance Text: {data['escalation']['complaint_preview'][:120]}...")
        print(f"   Autofill Script Length: {len(data['escalation']['autofill_script'])} chars")
        print(f"   Government Portal URL: {data['escalation']['portal_url']}")
        print(f"   Matching Claims Count: {data['matching_count']}\n")

test_req("Lookup by Name GET", "http://localhost:8000/api/v1/patient/escalation/lookup?q=Srikanth")
test_req("Lookup by Phone POST", "http://localhost:8000/api/v1/patient/escalation/lookup", {"phone": "9930021169"})
test_req("Lookup by Name POST", "http://localhost:8000/api/v1/patient/escalation/lookup", {"patient_name": "Padma B N"})
