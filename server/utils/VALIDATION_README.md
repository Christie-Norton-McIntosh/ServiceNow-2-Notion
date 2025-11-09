# Post-Creation Validation Utility

## Overview

The validation utility (`validate-notion-page.cjs`) runs after a Notion page is created to verify that the content was converted correctly. It checks for common issues and flags problems by updating Notion page properties.

## Quick Start (3 Steps)

1. Add two properties to your target Notion database:
  - `Error` (Checkbox)
  - `Validation` (Text or Rich Text)
2. Enable validation by setting `SN2N_VALIDATE_OUTPUT=1` in your root or `server/.env`.
3. Restart the server (`npm start`) and create/export a page — validation runs automatically post-creation.

### What You Will See
**Passing Page:**
- Error (unchecked)
- Validation: `✅ Validation passed: <blocks> blocks, <headings> headings, no issues`

**Failing Page (critical issues):**
- Error (checked)
- Validation summary starting with `❌ Validation failed...` detailing marker leaks or block count problems.

**Warnings Only:**
- Error remains unchecked
- Validation summary starts with `✅ Validation passed (critical elements match)` and lists informational warnings (e.g. block count high, missing expected headings).

### Typical Use Cases
- During debugging of conversion changes (keep enabled)
- During bulk import (disable for speed)
- While adding new deep-nesting or marker orchestration logic (enable to catch leaks)

## Features

### 1. **Marker Leak Detection** (CRITICAL)
- Searches all blocks recursively for visible `(sn2n:marker-id)` tokens
- These markers should be cleaned up during orchestration
- If found, indicates orchestration or cleanup failure

### 2. **Block Count Validation**
- Compares actual block count with expected range
- Allows ±30% tolerance to account for:
  - Block splitting (rich_text chunks, nested lists)
  - Block deduplication
  - Orchestrated blocks appended later

### 3. **Heading Verification** (Optional)
- Checks for expected section headings
- Case-insensitive partial matching
- Helps ensure major sections weren't skipped

### 4. **Structural Integrity**
- Verifies page has expected block types (paragraphs, lists, etc.)
- Detects empty pages or extraction failures

## Usage

### Enable Validation

Set environment variable before starting the server:

```bash
# In server/.env or root .env
SN2N_VALIDATE_OUTPUT=1

# Or when starting server
SN2N_VALIDATE_OUTPUT=1 npm start
```

### Notion Database Properties

The validation utility requires these properties in your Notion database:

#### 1. **Error** (Checkbox)
- Type: Checkbox
- Purpose: Flagged when validation finds critical errors
- Set automatically by validator

#### 2. **Validation** (Rich Text / Multi-line Text)
- Type: Rich Text (or Text)
- Purpose: Contains validation summary and details
- Format:
  ```
  ✅ Validation passed: 45 blocks, 3 headings, no issues
  
  Stats: {
    "totalBlocks": 45,
    "blockTypes": {
      "paragraph": 20,
      "numbered_list_item": 10,
      "heading_2": 3,
      ...
    },
    "headingCount": 3,
    "fetchTimeMs": 1234
  }
  ```

### Add Properties to Database

1. Open your Notion database
2. Add two new properties:
   - **Error** → Type: Checkbox
   - **Validation** → Type: Text (or Rich Text)
3. No code changes needed - validator updates these automatically

### Optional Expected Headings
You can supply an `expectedHeadings` array when invoking validation (already wired in route integration) to ensure critical sections (e.g. "Overview", "Prerequisites", "Procedure") appear. Missing headings are treated as warnings, not failures.

## Validation Results

### Success (No Errors)
- **Error checkbox**: Unchecked (or not set)
- **Validation text**: 
  ```
  ✅ Validation passed: X blocks, Y headings, no issues
  ```

### Warnings (Non-Critical)
- **Error checkbox**: Unchecked
- **Validation text**:
  ```
  ⚠️ Validation passed with warnings: 2 warning(s)
  
  Warnings:
  1. Block count high: expected at most 50, got 65
  2. Missing expected headings: Prerequisites
  ```

### Errors (Critical Issues)
- **Error checkbox**: ✅ Checked
- **Validation text**:
  ```
  ❌ Validation failed: 1 error(s), 1 warning(s)
  
  Errors:
  1. Marker leak: 3 visible sn2n:marker token(s) found
  
  Warnings:
  1. Missing expected headings: Setup
  ```

## Common Issues Detected

### Marker Leaks
**Symptom**: Visible `(sn2n:a1b2c3d4)` tokens in Notion page text

**Cause**: 
- Orchestration failed to append deferred blocks
- Marker cleanup didn't run or failed
- Network error during PATCH requests

**Fix**: Check server logs for orchestration errors; verify Notion API connectivity

### Block Count Mismatch (Low)
**Symptom**: `Block count too low: expected at least X, got Y`

**Cause**:
- HTML content not fully parsed
- Blocks filtered/deduplicated aggressively
- Error during conversion

**Fix**: Check extraction warnings; review HTML parsing logs

### Block Count Mismatch (High)
**Symptom**: `Block count high: expected at most X, got Y`

**Cause**:
- Rich text splitting created extra paragraphs
- List items split into multiple blocks
- Usually harmless (extra blocks from chunking)

**Fix**: Review if acceptable; adjust tolerance if needed

### Missing Headings
**Symptom**: `Missing expected headings: Section Name`

**Cause**:
- Section not present in source HTML
- Heading text doesn't match expected format
- Section extracted as different block type

**Fix**: Check source ServiceNow page; verify heading selector logic

## API Integration

### Response Format

When validation is enabled, the API response includes validation results:

```json
{
  "success": true,
  "data": {
    "pageUrl": "https://notion.so/...",
    "page": {
      "id": "abc-123-def",
      "url": "https://notion.so/...",
      "title": "Page Title"
    },
    "validation": {
      "success": true,
      "hasErrors": false,
      "issueCount": 0,
      "warningCount": 1,
      "stats": {
        "totalBlocks": 45,
        "blockTypes": { ... },
        "headingCount": 3,
        "fetchTimeMs": 1234
      }
    }
  }
}
```

## Performance Impact

- **Fetch time**: ~1-3 seconds for typical pages (50-100 blocks)
- **Total overhead**: ~2-5 seconds (includes property update)
- **Recommendation**: Enable only during testing/debugging or for high-value pages

## Advanced Options

### Programmatic Usage

```javascript
const { validateNotionPage } = require('./utils/validate-notion-page.cjs');

const result = await validateNotionPage(
  notionClient,
  pageId,
  {
    expectedMinBlocks: 30,
    expectedMaxBlocks: 100,
    expectedHeadings: ['Overview', 'Prerequisites', 'Procedure']
  },
  console.log // logger function
);

console.log(result.summary);
// Check result.hasErrors, result.issues, result.warnings
```

### Custom Validation Rules

Extend `validate-notion-page.cjs` with custom checks:

```javascript
// Add to validateNotionPage function
// VALIDATION 5: Custom check
const codeBlocks = blockTypes.code || 0;
if (codeBlocks > 10) {
  result.warnings.push(`Many code blocks: ${codeBlocks} found (may slow page load)`);
}
```

## Troubleshooting

### Validation Not Running
- Check `SN2N_VALIDATE_OUTPUT` environment variable is set to `1` or `true`
- Verify server restarted after setting env var
- Check server logs for "Running post-creation validation..." message

### Property Update Failed
- Ensure "Error" property exists in database (type: Checkbox)
- Ensure "Validation" property exists (type: Text or Rich Text)
- Check Notion API permissions (integration must have write access)
- Review server logs for "Failed to update properties" errors

### False Positives
- Adjust block count tolerance by modifying min/max calculation in `w2n.cjs`
- Remove or adjust expected headings list
- Add custom filters for known content patterns

## Future Enhancements

Potential additions to validation:
- [ ] Image verification (check uploaded images are accessible)
- [ ] Link validation (verify external URLs return 200)
- [ ] Table structure validation (verify row/column counts)
- [ ] Code block syntax verification
- [ ] Cross-reference validation (check internal page links)
- [ ] Content diff (compare plain text with source HTML)

## Example Validation Log
## Benefits & Workflow

| Benefit | Description |
|---------|-------------|
| Automatic QA | Every page gets a structural & content sanity check immediately post-create. |
| Fast Triage | Filter database on `Error` checkbox to find pages needing attention. |
| Marker Leak Defense | Detects failed deep nesting orchestration early (critical). |
| Content Comparison | Source vs Notion counts highlight extraction anomalies. |
| Extensible | Add custom rules (e.g. max code blocks) with a few lines. |

### Recommended Workflow
1. Enable validation while developing conversion or orchestration changes.
2. Export a representative set of ServiceNow pages.
3. Filter by `Error` in Notion; inspect `Validation` details.
4. Fix issues (e.g. marker leaks), re-export to confirm.
5. Disable validation for large bulk operations if performance is a concern.

### Moving From Setup Doc
This file now consolidates the prior high-level setup guide (`VALIDATION_SETUP.md`). The root-level setup document can be removed; refer here for both quick start and deep technical details.


```
🔍 [VALIDATION] Starting validation for page abc-123-def
🔍 [VALIDATION] Fetched 45 blocks in 1234ms
✅ [VALIDATION] No marker leaks found
✅ [VALIDATION] Block count within expected range: 45
⚠️ [VALIDATION] Missing 1 expected heading(s): Setup
🔍 [VALIDATION] Complete: PASSED
⚠️ Validation passed with warnings - updating Validation property
✅ Validation complete and properties updated
⚠️ Validation found 1 warning(s):
   1. Missing expected headings: Setup
```
