# Automatic Validation on Extraction

Automatic validation is integrated into the userscript extraction workflow to catch conversion issues early and flag pages that need re-extraction.

## Overview

When enabled, the proxy server automatically validates each page after creation by:
1. **Comparing block counts** - Ensures all content was converted
2. **Checking structure** - Validates headings, lists, tables, images, callouts, code blocks
3. **Using lenient thresholds** - Allows for expected differences (deduplication, flattening)
4. **Auto-flagging failures** - Updates Notion properties and saves HTML for re-extraction

## How It Works

### 1. Enable Validation

Set the environment variable in your `server/.env` file:

```bash
SN2N_VALIDATE_OUTPUT=1
```

Restart the proxy server for changes to take effect:

```bash
npm start
```

### 2. Extraction Flow

When you extract a page using the userscript:

```
1. Extract HTML from ServiceNow page
   ↓
2. Send to proxy server
   ↓
3. Convert HTML to Notion blocks
   ↓
4. Create Notion page
   ↓
5. **[AUTO-VALIDATION]** Compare HTML vs Notion
   ↓
6. Update Notion properties (Validation, Error, Stats)
   ↓
7. If validation fails → Save HTML to pages-to-update/
```

### 3. Validation Thresholds (Lenient)

The validation uses **±30% tolerance** (same as existing validateNotionPage) to avoid excessive false positives:

**Overall Block Count:**
- Minimum: 70% of expected (0.7x)
- Maximum: 150% of expected (1.5x)
- Example: 100 expected blocks → valid range is 70-150 blocks

**Why ±30%?**
- Notion flattens nested lists into individual list items
- Deduplication removes identical images/callouts
- Gray info callouts are filtered
- Empty paragraphs are removed
- Long content splits into multiple blocks (100 rich_text limit)

### 4. Notion Property Updates

After validation, three properties are updated:

**Error (Checkbox)**
- `☑️ Checked` = Validation found critical issues
- `☐ Unchecked` = Validation passed

**Validation (Text)**
- Summary of validation results
- Lists errors and warnings
- Example:
  ```
  ✅ Validation PASSED
  Total blocks: 38 (expected 38-57)
  Warnings:
  - Image count differs: HTML=15, Notion=10 (33% diff, deduplication expected)
  ```

**Stats (Text)**
- Detailed JSON statistics
- HTML vs Notion comparison
- Block counts by type

### 5. Auto-Save Failed Pages

When validation fails, the HTML is automatically saved to:

```
patch/pages-to-update/<page-title>-<timestamp>.html
```

The HTML file includes metadata comments:

```html
<!--
  Page: Onboard GitHub to DevOps Change Velocity workspace
  URL: https://docs.servicenow.com/...
  Captured: 2025-11-16T12:00:00.000Z
  Validation Errors: Table count mismatch: HTML=2, Notion=0 (100% diff)
  Page ID: 2a8a89fe-dba5-816d-9940-c30180a3bb16
  Block Count (expected): 38
  Block Count (actual): 25
-->
<div class="body">
  ...content...
</div>
```

## Workflow Integration

### Manual Re-extraction

If a page fails validation:

1. **Check the Notion page** - Look for the `Error` checkbox
2. **Review validation summary** - Read the `Validation` property
3. **Find the HTML file** - Check `patch/pages-to-update/`
4. **Re-extract the page** - Use userscript to extract again
5. **PATCH the page** - Run batch PATCH script to update

### Batch PATCH Workflow

The batch PATCH scripts automatically handle validation:

```bash
cd patch/config
bash batch-patch-with-cooldown.sh
```

This script:
- Validates each page before PATCH (dry-run)
- Skips pages that fail validation
- PATCHes pages that pass validation
- Re-validates after PATCH
- Moves successful pages to `updated-pages/`
- Keeps failed pages in `pages-to-update/`

### AutoExtract Integration

When using AutoExtract mode:

1. Each page is extracted and sent to the proxy
2. Validation runs automatically after page creation
3. Failed pages are flagged in Notion (Error checkbox)
4. HTML is saved to `pages-to-update/` for later re-extraction
5. AutoExtract continues with the next page

## Debugging Validation Issues

### Check Validation Logs

The proxy server logs validation results:

```bash
# Start server with verbose logging
SN2N_VERBOSE=1 npm start

# Watch for validation messages
tail -f server/logs/sn2n-proxy.log | grep -E "Validation|Error|Warning"
```

### Common Validation Failures

**Table count mismatch (100% diff)**
- Cause: Tables not converted (possible HTML structure issue)
- Fix: Check HTML structure, ensure tables have `<table>` tags
- Action: Re-extract page, check ServiceNow page for dynamic content

**Image count differs significantly**
- Cause: Images failed to download or URL invalid
- Fix: Check image URLs, ensure ServiceNow images are accessible
- Action: Re-extract with better network connection

**Block count too low**
- Cause: Content elements skipped during conversion
- Fix: Check for unsupported HTML elements
- Action: Review HTML, add support for missing elements

### Disable Validation

To disable automatic validation:

```bash
# In server/.env, set to 0 or remove the variable
SN2N_VALIDATE_OUTPUT=0
```

Or disable auto-save of failed pages:

```bash
# Keep validation enabled but don't save HTML files
SN2N_SAVE_VALIDATION_FAILURES=false
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SN2N_VALIDATE_OUTPUT` | `0` | Enable automatic validation (`1` = enabled) |
| `SN2N_SAVE_VALIDATION_FAILURES` | `true` | Auto-save failed HTML to `pages-to-update/` |
| `SN2N_FIXTURES_DIR` | `patch/pages-to-update` | Directory for saved HTML files |
| `SN2N_VERBOSE` | `0` | Enable verbose logging for debugging |

## Performance Impact

Validation adds minimal overhead:

- **Delay**: 2 seconds (wait for Notion API consistency)
- **API calls**: +2 per page (fetch blocks, update properties)
- **Network**: Negligible (validation runs server-side)
- **Storage**: ~50KB per failed page (HTML file)

## Best Practices

1. **Enable validation during initial extraction** - Catch issues early
2. **Review failed pages periodically** - Check `Error` checkbox in Notion
3. **Re-extract problematic pages** - Use saved HTML to identify patterns
4. **Adjust thresholds if needed** - Modify `server/routes/validation.cjs`
5. **Monitor logs** - Use `SN2N_VERBOSE=1` for detailed validation output

## See Also

- [VALIDATION_SCRIPTS.md](./VALIDATION_SCRIPTS.md) - Manual validation scripts
- [VALIDATION_QUICK_REFERENCE.md](./VALIDATION_QUICK_REFERENCE.md) - Command reference
- [PATCH_ENDPOINT_UPDATE_PAGES.md](./PATCH_ENDPOINT_UPDATE_PAGES.md) - Batch PATCH workflow
- [patch-workflow.md](./patch-workflow.md) - Complete PATCH workflow guide
