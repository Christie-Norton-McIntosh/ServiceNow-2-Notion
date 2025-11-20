# Revalidation Auto-Save Enhancement

## Overview

Modified `server/revalidate-pages.cjs` to automatically save failed pages to the `pages-to-update` folder when marker leaks are detected.

## Changes

### Added Functionality

1. **Tracks Failed Pages**: Collects pages with marker leaks during revalidation
2. **Creates Metadata Files**: Saves JSON files with page details for re-extraction
3. **Summary Report**: Shows which pages need action at the end

### Metadata File Structure

Each failed page gets a JSON file with:
```json
{
  "pageId": "2b0a89fedba581db9adaee70908ffb12",
  "pageUrl": "https://www.notion.so/2b0a89fedba581db9adaee70908ffb12",
  "title": "Create a CMDB 360 Compare Attribute Values query",
  "failureReason": "Manual revalidation detected marker leaks",
  "markerCount": 2,
  "markers": ["(sn2n:mi5jiuqd-t7b3uf)", "(sn2n:mi5jiuqf-mmz7oq)"],
  "timestamp": "2025-11-18T23:45:00.000Z",
  "instructions": "This page needs to be re-extracted from ServiceNow and PATCHed to Notion"
}
```

### Workflow

**Before:**
```
Run revalidation → Find marker leaks → Update properties → Manual tracking needed
```

**After:**
```
Run revalidation → Find marker leaks → Update properties → Auto-save to pages-to-update → Ready for re-extraction
```

## Usage

### Running Revalidation

**Via Task Button:**
- Use VS Code task: "🔍 Revalidate Pages"

**Via Command Line:**
```bash
cd server
node revalidate-pages.cjs
```

### Output Example

```
==========================================
Manual Revalidation of 5 Pages
==========================================

[1/5] Exclude classes from CMDB 360
    Page ID: 2b0a89fedba5819585d1efe570e7113c
    Fetching blocks...
    Found 11 blocks
    Block types: paragraph:8, callout:1, numbered_list_item:2
    ✅ No markers found
    ✅ Properties updated

[2/5] Create a CMDB 360 Compare Attribute Values query
    Page ID: 2b0a89fedba581db9adaee70908ffb12
    Fetching blocks...
    Found 27 blocks
    Block types: paragraph:7, callout:1, numbered_list_item:12, table:2
    ❌ MARKER LEAK: 2 marker(s) found
       Markers: (sn2n:mi5jiuqd-t7b3uf), (sn2n:mi5jiuqf-mmz7oq)
    ✅ Properties updated

==========================================
Revalidation Complete
==========================================

⚠️  1 page(s) failed validation - saving to pages-to-update

   ✅ Saved: create-a-cmdb-360-compare-attribute-values-query-revalidation-failed-2025-11-18T23-45-00.json

📝 Summary:
   - 1 page(s) need re-extraction
   - Metadata files saved to: /path/to/patch/pages/pages-to-update
   - Re-extract these pages from ServiceNow using the userscript
```

## Integration with Workflow

1. **Revalidation detects issues** → Metadata saved to `pages-to-update/`
2. **Open ServiceNow page** → Use page URL from metadata file
3. **Run userscript** → Extract HTML and save to `pages-to-update/`
4. **Run batch PATCH** → Update the page in Notion

## Files Modified

- `server/revalidate-pages.cjs` - Added auto-save logic for failed pages

## Benefits

1. **Automated Tracking**: No manual note-taking about which pages failed
2. **Clear Instructions**: Metadata files contain page URLs and failure details
3. **Workflow Integration**: Files go directly to `pages-to-update` for batch processing
4. **Audit Trail**: JSON files provide history of validation failures
