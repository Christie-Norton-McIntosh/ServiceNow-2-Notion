# Failed Validation Auto-Save Enhancement (v11.0.24)

## Overview

Enhanced the POST endpoint to automatically save pages to the `failed-validation` folder when validation property updates fail after successful page creation.

## Problem

Previously, when a page was successfully created in Notion but the validation property update failed (after 5 retries):
- The page existed in Notion with content
- But had **no validation properties set** (Error checkbox, Validation text, Stats)
- These pages were saved to `pages-to-update` folder (incorrect - they don't need PATCH, just revalidation)

## Solution

**v11.0.24 Changes**:
- Changed auto-save directory from `pages-to-update` to `failed-validation`
- Updated log messages to reflect this is for revalidation, not re-extraction
- Updated comment version numbers from v11.0.19 to v11.0.24

## What Changed

### File: `server/routes/w2n.cjs`

**Lines ~1508-1512** - Directory path update:
```javascript
// OLD:
const pagesDir = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update');

// NEW:
const pagesDir = path.join(__dirname, '..', 'patch', 'pages', 'failed-validation');
```

**Lines ~1543-1544** - Log message update:
```javascript
// OLD:
log(`   This page will be picked up by batch PATCH workflow`);

// NEW:
log(`   This page will be added to failed-validation folder for revalidation`);
```

**Line ~1548** - Comment version update:
```javascript
// OLD:
savedToUpdateFolder = true; // FIX v11.0.19: Mark as saved

// NEW:
savedToUpdateFolder = true; // FIX v11.0.24: Mark as saved
```

## Workflow

### Before
```
Page Creation Success
  ↓
Validation Property Update Fails (5 retries)
  ↓
Auto-save to pages-to-update/ ❌ Wrong folder
  ↓
Would be picked up by PATCH batch (unnecessary)
```

### After (v11.0.24)
```
Page Creation Success
  ↓
Validation Property Update Fails (5 retries)
  ↓
Auto-save to failed-validation/ ✅ Correct folder
  ↓
Use revalidation script to update properties only
```

## Usage

### When This Triggers

Automatically saves to `failed-validation/` when:
1. ✅ `notion.pages.create()` succeeds
2. ✅ Content blocks uploaded successfully
3. ❌ `notion.pages.update()` (properties) fails after 5 retries

### How to Revalidate

**Option 1: Revalidation Script**
```bash
cd server
node revalidate-pages.cjs
```

**Option 2: Manual Property Update**
```bash
# Extract page IDs from HTML file comments
# Update using Notion API directly
```

### File Metadata

Each saved HTML file includes:
```html
<!--
Auto-saved: Validation properties failed to update after 6 retries
Page ID: 2b0a89fe-dba5-8119-85d1-efe570e7113c
Page URL: https://www.notion.so/...
Page Title: Example Page
Created: 2025-11-18T12:34:56.789Z
Source URL: https://servicenow.com/...

Validation Result:
{
  "success": false,
  "hasErrors": true,
  "issues": [...],
  "summary": "..."
}

Error Details:
- Primary Error: Notion API timeout during property update
-->
```

## Benefits

1. **Semantic Clarity**: Pages in `failed-validation/` need revalidation, not re-extraction
2. **Correct Workflow**: Prevents unnecessary PATCH operations
3. **Easy Identification**: Clear separation from pages needing content updates
4. **Tracking**: `validation-property-failures.log` provides audit trail

## Related Files

- `server/routes/w2n.cjs` - Modified auto-save logic
- `patch/pages/failed-validation/README.md` - New documentation
- `patch/logs/validation-property-failures.log` - Persistent log
- `server/revalidate-pages.cjs` - Revalidation script

## Testing

To test this change:
1. Start server with validation enabled: `SN2N_VALIDATE_OUTPUT=1 npm start`
2. Create a page that will trigger property update failure (simulate by temporarily breaking Notion API credentials during property update phase)
3. Verify page is saved to `patch/pages/failed-validation/`
4. Check log entry in `patch/logs/validation-property-failures.log`
5. Run revalidation script on the saved page

## Version

- **Version**: 11.0.24
- **Date**: 2025-11-18
- **Type**: Enhancement
- **Impact**: Low (internal workflow improvement)
