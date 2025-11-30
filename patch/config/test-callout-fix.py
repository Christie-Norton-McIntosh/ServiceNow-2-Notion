#!/usr/bin/env python3
"""Test the callout extraction fix with Performance overview page."""

import json
import requests
import sys
from pathlib import Path

# Configuration
SERVER_URL = "http://localhost:3004"
DATABASE_ID = "282a89fedba5815e91f0db972912ef9f"
HTML_FILE = Path("/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/performance-overview-2025-11-13T06-49-50.html")

def test_callout_fix():
    """Test the callout extraction fix."""
    print(f"📄 Testing callout fix with: {HTML_FILE.name}")
    
    # Read HTML content
    with open(HTML_FILE, 'r', encoding='utf-8') as f:
        html_content = f.read()
    
    # Create page
    payload = {
        "title": "Performance Overview (TEST FIX v3)",
        "databaseId": DATABASE_ID,
        "contentHtml": html_content,
        "url": f"https://example.servicenow.com/{HTML_FILE.name}",
        "properties": {
            "Source": "ServiceNow KB",
            "Status": "Published"
        }
    }
    
    print("🚀 Creating page...")
    response = requests.post(f"{SERVER_URL}/api/W2N", json=payload, timeout=120)
    
    if response.status_code != 200:
        print(f"❌ Error: HTTP {response.status_code}")
        print(response.text)
        return False
    
    result = response.json()
    
    if not result.get('success'):
        print(f"❌ Page creation failed")
        print(json.dumps(result, indent=2))
        return False
    
    page_id = result.get('pageId')
    validation = result.get('validation', {})
    has_errors = validation.get('hasErrors', True)
    
    print(f"✅ Page created: {page_id}")
    print(f"   URL: {result.get('url')}")
    print(f"\n📊 Validation Results:")
    print(f"   Has Errors: {has_errors}")
    
    if 'source' in validation:
        print(f"\n   Source counts:")
        print(f"      Tables: {validation['source'].get('tables', 0)}")
        print(f"      Images: {validation['source'].get('images', 0)}")
        print(f"      Lists: {validation['source'].get('lists', 0)}")
        print(f"      Callouts: {validation['source'].get('callouts', 0)}")
    
    if 'notion' in validation:
        print(f"\n   Notion counts:")
        print(f"      Tables: {validation['notion'].get('tables', 0)}")
        print(f"      Images: {validation['notion'].get('images', 0)}")
        print(f"      Lists: {validation['notion'].get('lists', 0)}")
        print(f"      Callouts: {validation['notion'].get('callouts', 0)}")
    
    if 'errors' in validation and validation['errors']:
        print(f"\n   ⚠️ Errors:")
        for error in validation['errors']:
            print(f"      - {error}")
    
    return not has_errors

if __name__ == '__main__':
    success = test_callout_fix()
    sys.exit(0 if success else 1)
