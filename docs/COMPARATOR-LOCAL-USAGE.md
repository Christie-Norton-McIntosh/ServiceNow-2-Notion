# Text Completeness Comparator - Local Usage Guide

This guide provides step-by-step instructions for running the Text Completeness Comparator locally on your pages.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Option A: Enhanced PATCH Script (Integrated Validation)](#option-a-enhanced-patch-script)
3. [Option B: Standalone Validation Script (Already-Patched Pages)](#option-b-standalone-validation-script)
4. [Option C: Manual API Usage](#option-c-manual-api-usage)
5. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create or update `.env` file in the `server/` directory:

```bash
# Required
NOTION_TOKEN=secret_your_notion_token
NOTION_VERSION=2022-06-28

# Optional - for automatic POST/PATCH integration
SN2N_VALIDATE_OUTPUT=1

# Optional - Comparator tuning
MAX_CELLS=50000000      # LCS DP guardrail
MIN_SPAN=40             # Minimum tokens to report
APPEND_TOGGLE=false     # Append missing spans to page

# Optional - API authentication
AUTH_TOKEN=your_secret_token
```

### 3. Add Notion Database Properties
Add these properties to your Notion database before using the comparator:

| Property Name | Type | Description |
|--------------|------|-------------|
| `Coverage` | Number | 0.0-1.0 coverage percentage |
| `MissingCount` | Number | Number of missing text spans |
| `Method` | Select | Options: `lcs`, `jaccard` |
| `LastChecked` | Date | Comparison timestamp |
| `MissingSpans` | Rich text | Top 5 missing spans |
| `RunId` | Rich text | Unique run identifier |
| `Status` | Select | Options: `Complete`, `Attention` |

### 4. Start the Server
```bash
cd /path/to/ServiceNow-2-Notion
npm start
```

The server should start on port 3004 (default) and log:
```
✅ Comparator routes loaded successfully
Server listening on port 3004
```

---

## Option A: Enhanced PATCH Script

**Use Case:** Running PATCH operations with integrated completeness validation

This script combines PATCH operations with completeness validation, categorizing results based on both standard validation and completeness metrics.

### Usage

```bash
cd patch/config
bash batch-patch-with-comparator.sh
```

### Custom Thresholds

```bash
# More lenient thresholds
COVERAGE_THRESHOLD=0.95 MAX_MISSING_SPANS=2 bash batch-patch-with-comparator.sh

# Strict thresholds (default)
COVERAGE_THRESHOLD=0.97 MAX_MISSING_SPANS=0 bash batch-patch-with-comparator.sh
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `COVERAGE_THRESHOLD` | 0.97 | Minimum coverage required (97%) |
| `MAX_MISSING_SPANS` | 0 | Maximum missing spans allowed |
| `SERVER_URL` | http://localhost:3004 | Proxy server URL |

### Output Directories

- **`updated-pages/`** - ✅ All validation passed (structure + completeness)
- **`incomplete-content/`** - ⚠️ Structure passed but content incomplete
- **`pages-to-update/`** - ❌ Validation failed or PATCH failed
- **`log/`** - Execution logs with timestamps

### What It Does

1. Reads HTML files from `patch/pages/pages-to-update/`
2. Extracts Page ID and content
3. Runs PATCH operation (delete + upload + orchestration)
4. Waits for Notion eventual consistency
5. Runs standard validation (block count, structure)
6. **Runs completeness comparison** (text coverage)
7. Updates Notion properties with both results
8. Categorizes files based on combined validation

### Example Log Output

```
[1/5] Processing: managing-favorites-20251210.html
  Page ID: a1b2c3d4e5f6...
  Running PATCH operation...
  ✓ PATCH successful
  Running standard validation...
  ✓ Validation passed
  Running completeness comparison...
  Coverage: 98% (method: lcs)
  Missing spans: 0
  ✓ COMPLETE - All validation passed
  → Moved to updated-pages/
```

### Documentation

See [patch/docs/BATCH-PATCH-WITH-COMPARATOR.md](../patch/docs/BATCH-PATCH-WITH-COMPARATOR.md) for complete documentation.

---

## Option B: Standalone Validation Script

**Use Case:** Validating already-patched pages without re-running PATCH

This script only runs completeness validation on existing pages, useful for:
- Pages created before comparator was available
- Auditing existing page completeness
- Updating comparator properties without modifying page content

### Usage

```bash
cd patch/config
bash validate-existing-pages-comparator.sh
```

### Custom Configuration

```bash
# Validate pages in custom directory
PAGES_LIST=patch/pages/custom-directory bash validate-existing-pages-comparator.sh

# Custom thresholds
COVERAGE_THRESHOLD=0.95 MAX_MISSING_SPANS=2 bash validate-existing-pages-comparator.sh
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `PAGES_LIST` | patch/pages/updated-pages | Directory with HTML files |
| `COVERAGE_THRESHOLD` | 0.97 | Minimum coverage required |
| `MAX_MISSING_SPANS` | 0 | Maximum missing spans allowed |
| `SERVER_URL` | http://localhost:3004 | Proxy server URL |

### Output Directories

- **`validated-complete/`** - ✅ Pages meeting completeness thresholds
- **`incomplete-content/`** - ⚠️ Pages with missing content
- **`log/`** - Validation logs with timestamps

### What It Does

1. Reads HTML files from specified directory
2. Extracts Page ID and source content
3. **Runs completeness comparison via API** (no PATCH)
4. Updates Notion properties (Coverage, MissingCount, etc.)
5. Categorizes pages based on completeness only
6. Copies files to appropriate directories (preserves originals)

### Example Log Output

```
[1/10] Processing: managing-favorites-20251210.html
  Page ID: a1b2c3d4e5f6...
  Running completeness comparison...
  Coverage: 94% (method: lcs)
  Missing spans: 3
  ⚠ INCOMPLETE - Missing content detected
  Missing content (top 3):
    - rationale for audit purposes and compliance requirements...
    - approval workflow must include stakeholder review before final...
    - escalation procedures for rejected requests should be documented...
  ✓ Properties updated in Notion
  → Copied to incomplete-content/
```

### Use Cases

**Audit Existing Pages:**
```bash
# Check all updated pages for completeness
PAGES_LIST=patch/pages/updated-pages bash validate-existing-pages-comparator.sh
```

**Re-validate After Content Changes:**
```bash
# Check incomplete pages after manual fixes
PAGES_LIST=patch/pages/incomplete-content bash validate-existing-pages-comparator.sh
```

**Bulk Property Update:**
```bash
# Update comparator properties for all pages
PAGES_LIST=patch/pages/all-pages bash validate-existing-pages-comparator.sh
```

---

## Option C: Manual API Usage

**Use Case:** Direct API calls for custom workflows or scripting

The comparator provides REST API endpoints for manual integration.

### Endpoint: Compare Two Text Sections

Compare arbitrary text strings without Notion integration.

```bash
curl -X POST http://localhost:3004/api/compare/section \
  -H "Content-Type: application/json" \
  -d '{
    "srcText": "The approval process requires rationale and stakeholder review.",
    "dstText": "The approval process requires rationale.",
    "options": {
      "minMissingSpanTokens": 3,
      "lowerCase": true
    }
  }'
```

**Response:**
```json
{
  "runId": "2f74b9c91b3b0e5e",
  "method": "lcs",
  "coverage": 0.777778,
  "lcsLength": 7,
  "srcTokenCount": 9,
  "dstTokenCount": 6,
  "missingSpans": [
    {
      "start": 7,
      "end": 9,
      "text": "stakeholder review"
    }
  ],
  "params": {
    "lowerCase": true,
    "maxCells": 50000000,
    "minMissingSpanTokens": 3
  }
}
```

### Endpoint: Compare Against Notion Page

Fetch Notion page content and compare.

```bash
PAGE_ID="a1b2c3d4e5f67890abcdef1234567890"
SOURCE_TEXT="Your ServiceNow page content here"

curl -X POST http://localhost:3004/api/compare/notion-page \
  -H "Content-Type: application/json" \
  -d "{
    \"pageId\": \"$PAGE_ID\",
    \"srcText\": \"$SOURCE_TEXT\",
    \"options\": {
      \"minMissingSpanTokens\": 40
    }
  }"
```

**Response:**
```json
{
  "pageId": "a1b2c3d4e5f67890abcdef1234567890",
  "method": "lcs",
  "coverage": 0.987,
  "lcsLength": 1234,
  "srcTokenCount": 1250,
  "dstTokenCount": 1275,
  "missingSpans": [
    {
      "start": 540,
      "end": 592,
      "text": "approval escalation procedures for rejected requests..."
    }
  ]
}
```

### Endpoint: Compare + Update Notion Properties

Compare and automatically update database properties.

```bash
PAGE_ID="a1b2c3d4e5f67890abcdef1234567890"
SOURCE_TEXT="Your ServiceNow page content here"

curl -X POST http://localhost:3004/api/compare/notion-db-row \
  -H "Content-Type: application/json" \
  -d "{
    \"pageId\": \"$PAGE_ID\",
    \"srcText\": \"$SOURCE_TEXT\",
    \"options\": {
      \"minMissingSpanTokens\": 40
    }
  }"
```

**Response:**
```json
{
  "pageId": "a1b2c3d4e5f67890abcdef1234567890",
  "updated": true,
  "coverage": 0.987,
  "missingCount": 1,
  "method": "lcs",
  "missingSpans": [
    "approval escalation procedures for rejected requests..."
  ]
}
```

### Scripting Examples

**Bash Script - Validate Multiple Pages:**

```bash
#!/bin/bash

# List of Page IDs
PAGE_IDS=(
  "a1b2c3d4e5f67890abcdef1234567890"
  "b2c3d4e5f67890abcdef1234567890ab"
  "c3d4e5f67890abcdef1234567890abc3"
)

for PAGE_ID in "${PAGE_IDS[@]}"; do
  echo "Validating page: $PAGE_ID"
  
  # Get source HTML from file
  SOURCE_HTML=$(cat "pages/${PAGE_ID}.html")
  SOURCE_JSON=$(echo "$SOURCE_HTML" | jq -Rs .)
  
  # Run comparison and update properties
  curl -s -X POST http://localhost:3004/api/compare/notion-db-row \
    -H "Content-Type: application/json" \
    -d "{\"pageId\":\"$PAGE_ID\",\"srcText\":$SOURCE_JSON}" \
    | jq '.coverage, .missingCount'
  
  # Rate limiting
  sleep 1
done
```

**Python Script - Batch Validation:**

```python
#!/usr/bin/env python3
import requests
import json
import time
from pathlib import Path

SERVER_URL = "http://localhost:3004"
PAGES_DIR = Path("patch/pages/updated-pages")

def validate_page(page_id, source_html):
    """Run completeness comparison and update properties."""
    response = requests.post(
        f"{SERVER_URL}/api/compare/notion-db-row",
        json={
            "pageId": page_id,
            "srcText": source_html,
            "options": {"minMissingSpanTokens": 40}
        }
    )
    return response.json()

# Process all HTML files
for html_file in PAGES_DIR.glob("*.html"):
    print(f"Processing: {html_file.name}")
    
    # Extract Page ID from comment
    with open(html_file) as f:
        content = f.read()
        page_id = None
        for line in content.split('\n'):
            if 'Page ID:' in line:
                page_id = line.split('Page ID:')[1].strip().replace('-', '')
                break
    
    if not page_id:
        print(f"  ⚠ No Page ID found, skipping")
        continue
    
    # Get source HTML
    source_html = content.split('-->')[1].strip()
    
    # Validate
    result = validate_page(page_id, source_html)
    
    print(f"  Coverage: {result.get('coverage', 0)*100:.1f}%")
    print(f"  Missing: {result.get('missingCount', 0)} spans")
    print(f"  Status: {'✓ Complete' if result.get('coverage', 0) >= 0.97 else '⚠ Incomplete'}")
    print()
    
    # Rate limiting
    time.sleep(1)
```

**Node.js Script - Async Validation:**

```javascript
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const SERVER_URL = 'http://localhost:3004';
const PAGES_DIR = 'patch/pages/updated-pages';

async function validatePage(pageId, sourceHtml) {
  const response = await axios.post(`${SERVER_URL}/api/compare/notion-db-row`, {
    pageId,
    srcText: sourceHtml,
    options: { minMissingSpanTokens: 40 }
  });
  return response.data;
}

async function processAllPages() {
  const files = await fs.readdir(PAGES_DIR);
  const htmlFiles = files.filter(f => f.endsWith('.html'));
  
  for (const file of htmlFiles) {
    console.log(`Processing: ${file}`);
    
    const content = await fs.readFile(path.join(PAGES_DIR, file), 'utf-8');
    
    // Extract Page ID
    const pageIdMatch = content.match(/Page ID: ([a-f0-9]{32})/);
    if (!pageIdMatch) {
      console.log('  ⚠ No Page ID found, skipping');
      continue;
    }
    const pageId = pageIdMatch[1].replace(/-/g, '');
    
    // Get source HTML
    const sourceHtml = content.split('-->')[1].trim();
    
    // Validate
    try {
      const result = await validatePage(pageId, sourceHtml);
      console.log(`  Coverage: ${(result.coverage * 100).toFixed(1)}%`);
      console.log(`  Missing: ${result.missingCount} spans`);
      console.log(`  Status: ${result.coverage >= 0.97 ? '✓ Complete' : '⚠ Incomplete'}`);
    } catch (error) {
      console.error(`  ✗ Error: ${error.message}`);
    }
    
    console.log();
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

processAllPages().catch(console.error);
```

---

## Troubleshooting

### Server Not Running

**Error:** `ERROR: Server not responding at http://localhost:3004`

**Solution:**
```bash
# Start the server
npm start

# Or specify custom port
PORT=3005 npm start
```

### Missing Notion Properties

**Error:** Properties not updating in Notion

**Solution:** Add required properties to your Notion database:
1. Open your Notion database
2. Click "+ New Property" (bottom of any column header)
3. Add each property with exact name and type from Prerequisites section
4. Run validation again

### Page ID Not Found

**Error:** `No Page ID found in file`

**Solution:** HTML files must contain Page ID in comment block:
```html
<!--
Page ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
-->
```

If missing, you can add it manually or extract from Notion URL.

### Rate Limiting

**Error:** `429 Too Many Requests`

**Solution:** Adjust rate limiting in scripts:
```bash
# Increase sleep time between requests
# In bash scripts, change: sleep 1  →  sleep 2
# In Python/Node scripts, increase timeout
```

### Low Coverage False Positives

**Issue:** Pages show low coverage despite appearing complete

**Common Causes:**
1. **HTML formatting differences** - ServiceNow HTML has extra whitespace/tags
2. **Dynamic content** - Timestamps, user names, auto-generated IDs
3. **Stripped content** - Some HTML elements removed during conversion

**Solutions:**
- Adjust `MIN_SPAN` threshold to ignore small differences
- Use Jaccard method for order-insensitive comparison
- Check `MissingSpans` property to see what's actually missing

### Authentication Errors

**Error:** `401 Unauthorized`

**Solution:** If `AUTH_TOKEN` is set in `.env`, include in API calls:
```bash
curl -X POST http://localhost:3004/api/compare/section \
  -H "Authorization: Bearer your_secret_token" \
  -H "Content-Type: application/json" \
  -d '...'
```

---

## Additional Resources

- **Quick Start:** [docs/COMPARATOR-QUICK-START.md](COMPARATOR-QUICK-START.md)
- **API Reference:** [docs/API-COMPARATOR.md](API-COMPARATOR.md)
- **Architecture:** [docs/ARCHITECTURE-COMPARATOR.md](ARCHITECTURE-COMPARATOR.md)
- **Deployment:** [docs/DEPLOYMENT-COMPARATOR.md](DEPLOYMENT-COMPARATOR.md)
- **PATCH Script:** [patch/docs/BATCH-PATCH-WITH-COMPARATOR.md](../patch/docs/BATCH-PATCH-WITH-COMPARATOR.md)

---

## Summary

### Quick Reference

| Use Case | Script/Method | When to Use |
|----------|---------------|-------------|
| PATCH + Validate | `batch-patch-with-comparator.sh` | Creating/updating pages with validation |
| Validate Only | `validate-existing-pages-comparator.sh` | Auditing existing pages |
| Custom Workflow | API endpoints | Scripting or custom integrations |

### Key Points

1. **Option A** (PATCH script) - Best for new pages or re-extracting content
2. **Option B** (Validation script) - Best for auditing existing pages
3. **Option C** (Manual API) - Best for custom workflows and scripting

All three options update Notion properties automatically and provide detailed logging for troubleshooting.
