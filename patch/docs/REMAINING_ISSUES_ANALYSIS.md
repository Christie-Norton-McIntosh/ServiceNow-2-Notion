# Remaining Pages Issues Analysis
**Date:** November 15, 2025  
**After Batch PATCH Run**

## Summary

- **pages-to-update/**: 7 files (HTTP 500 errors)
- **problematic-files/**: 1 file (timeout issue)

## Issue #1: Archived Pages (7 files) 🔴 CRITICAL

### Root Cause
All 7 pages in `pages-to-update/` are **archived in Notion** (`archived: true`).  
The Notion API returns HTTP 500 when trying to list/modify blocks of archived pages.

### Affected Files
1. `computer-cmdb-ci-computer-class-2025-11-15T06-55-14.html`
2. `create-a-service-credit-in-vendor-management-workspace-2025-11-13T13-55-30.html`
3. `end-a-conference-call-from-major-incident-2025-11-13T13-55-35.html`
4. `integrating-vendor-management-workspace-with-other-serviceno-2025-11-13T13-55-18.html`
5. `set-up-indicator-attributes-in-vendor-management-workspace-2025-11-13T13-55-42.html`
6. `train-the-similarity-model-2025-11-13T13-56-37.html`
7. `vendor-kpi-groups-in-vendor-management-workspace-reference-2025-11-13T13-56-38.html`

### Error Details
```
PATCH HTTP error: 500
Error message: Could not find block with ID: [page-id]
Reason: Pages are archived in Notion database
```

### Solutions (Choose One)

#### Option 1: Unarchive Pages via Notion API (Recommended)
```bash
# Script to unarchive all 7 pages
cd patch/pages-to-update

for file in *.html; do
  page_id=$(grep "Page ID:" "$file" | head -1 | sed 's/.*Page ID: //' | sed 's/-->.*//' | tr -d '-' | tr -d ' ')
  echo "Unarchiving: $file (ID: $page_id)"
  
  curl -X PATCH "https://api.notion.com/v1/pages/$page_id" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"archived": false}'
  
  echo ""
done

# Then re-run batch PATCH
cd ../config
bash batch-patch-with-cooldown.sh
```

#### Option 2: Delete Old Pages & Create New Ones
```bash
# 1. Delete HTML files for archived pages
rm computer-cmdb-ci-computer-class-2025-11-15T06-55-14.html
rm create-a-service-credit-in-vendor-management-workspace-2025-11-13T13-55-30.html
# ... (delete all 7)

# 2. Re-extract from ServiceNow using AutoExtract
# 3. New pages will be created via POST instead of PATCH
```

#### Option 3: Manual Unarchive in Notion UI
1. Open each page in Notion
2. Click "⋯" menu → "Restore from Archive"
3. Re-run batch PATCH script

---

## Issue #2: Timeout (1 file) 🟡 NEEDS INVESTIGATION

### Affected File
- `problematic-files/generic-policies-in-devops-config-2025-11-11T10-02-11.html`

### Status
- **NOT archived** (archived: false)
- Previously moved to problematic-files/ due to timeout
- Likely needs extended timeout (>300s)

### Solution
```bash
# Check page complexity
curl -s -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"test\",\"databaseId\":\"282a89fedba5815e91f0db972912ef9f\",\"content\":$(cat problematic-files/generic-policies-in-devops-config-2025-11-11T10-02-11.html | jq -Rs .),\"dryRun\":true}" \
  | jq '.data | {blocks: (.children | length), tables: [.children[] | select(.type == "table")] | length}'

# If very complex (>500 blocks or >50 tables), use manual PATCH with 480s timeout
# Or move back to pages-to-update/ and re-run batch script
```

---

## Recommended Action Plan

### Immediate (Option 1 - Unarchive)

1. **Create unarchive script:**
```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update

cat > unarchive-pages.sh << 'SCRIPT'
#!/bin/bash
set -e

NOTION_TOKEN=$(grep NOTION_TOKEN ../../server/.env | cut -d= -f2)

for file in *.html; do
  page_id=$(grep "Page ID:" "$file" | head -1 | sed 's/.*Page ID: //' | sed 's/-->.*//' | tr -d '-' | tr -d ' ')
  filename=$(basename "$file")
  
  echo "📤 Unarchiving: $filename"
  echo "   Page ID: $page_id"
  
  response=$(curl -s -w "\n%{http_code}" -X PATCH \
    "https://api.notion.com/v1/pages/$page_id" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    -d '{"archived": false}')
  
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  
  if [ "$http_code" = "200" ]; then
    echo "   ✅ Unarchived successfully"
  else
    echo "   ❌ Failed (HTTP $http_code)"
    echo "   Response: $body"
  fi
  
  echo ""
  sleep 0.5  # Rate limit protection
done

echo "✅ All pages processed"
SCRIPT

chmod +x unarchive-pages.sh
```

2. **Run unarchive script:**
```bash
bash unarchive-pages.sh
```

3. **Re-run batch PATCH:**
```bash
cd ../config
bash batch-patch-with-cooldown.sh
```

### Prevention

**Update PATCH endpoint to detect archived pages:**

Add to `/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/routes/w2n.cjs` after line 1309:

```javascript
// Check if page is archived before attempting PATCH
try {
  const pageInfo = await notion.pages.retrieve({ page_id: normalizedPageId });
  if (pageInfo.archived) {
    cleanup();
    return sendError(res, "PAGE_ARCHIVED", 
      `Cannot update archived page. Please unarchive the page first in Notion.`, 
      { pageId: normalizedPageId }, 400);
  }
} catch (error) {
  cleanup();
  return sendError(res, "PAGE_NOT_FOUND", 
    `Page ${normalizedPageId} not found or not accessible`, 
    { error: error.message }, 404);
}
```

This will return a clear error message instead of HTTP 500.

---

## Status After Fixes

- **Before:** 8 files stuck (7 archived + 1 timeout)
- **After unarchive:** 7 files ready for PATCH, 1 needs investigation
- **Expected outcome:** All 7 pages successfully updated, moved to updated-pages/

