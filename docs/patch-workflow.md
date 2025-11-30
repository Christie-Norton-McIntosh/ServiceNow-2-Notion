# PATCH Workflow Documentation

## Overview

The PATCH workflow allows updating existing Notion pages with corrected content after validation fixes. This is essential for re-processing pages that initially had validation errors.

## API Endpoint

**PATCH** `/api/W2N/:pageId`

### Request Format
```json
{
  "title": "Page Title",
  "contentHtml": "<html>...</html>",
  "url": "https://docs.servicenow.com/..."
}
```

### UUID Format
- Accepts both 32-character (no hyphens) and 36-character (with hyphens) UUIDs
- Internally normalizes by stripping hyphens: `pageId.replace(/-/g, '')`
- Example: `2a8a89fedba581cfa826cd57223ce113` or `2a8a89fe-dba5-81cf-a826-cd57223ce113`

### Response
Same structure as POST endpoint, includes `validationResult` when `SN2N_VALIDATE_OUTPUT=1`.

## Batch Processing Script

**Location**: `patch/config/batch-patch-validated.sh`

### Workflow Steps
1. **Extract Page ID** from HTML metadata comment
2. **Dry-run Validation** (POST with `dryRun:true`, 60s timeout)
   - Validates content before PATCH
   - Skips file if validation fails
3. **Execute PATCH** (PATCH endpoint, 120s timeout)
   - Deletes all existing blocks
   - Re-uploads corrected content
4. **Verify Post-PATCH Validation**
   - Checks `validationResult.hasErrors` in response
   - File stays in `pages-to-update` if errors detected
5. **Move to `updated-pages/`** only if all validations pass

### Directory Structure
```
patch/
  pages-to-update/           # Source files to PATCH
    *.html                   # Pages with embedded Page ID metadata
    updated-pages/           # Successfully patched files
    log/                     # PATCH operation logs
      batch-patch-YYYYMMDD-HHMMSS.log
```

### Usage
```bash
cd /path/to/ServiceNow-2-Notion
bash patch/config/batch-patch-validated.sh

# Monitor progress
tail -f patch/pages-to-update/log/batch-patch-*.log

# Check status
ls patch/pages-to-update/*.html | wc -l      # Remaining
ls patch/pages-to-update/updated-pages/*.html | wc -l  # Completed
```

## Timeout Configuration

### Current Settings
- **Validation (dry-run)**: 60 seconds (`curl -m 60`)
- **PATCH operation**: 120 seconds (`curl -m 120`)

### Why Timeouts Matter
- Large HTML payloads can cause curl to hang indefinitely
- Complex pages with many images/tables take longer to process
- Network/API latency varies
- Without timeouts, batch processes stall on single files

### Known Issues
**Symptom**: Batch process stops after processing only a few files, curl appears hung.

**Causes**:
1. curl hanging beyond timeout on very large payloads
2. Notion API rate limiting (429 responses)
3. Server processing delays on complex HTML

**Solutions**:
1. Monitor process: `ps aux | grep batch-patch-validated`
2. Check logs: `tail -f patch/pages-to-update/log/batch-patch-*.log`
3. Manually restart batch script to resume remaining files
4. For persistent hangs, increase timeout or split into smaller batches

## Validation Integration

The PATCH endpoint respects the `SN2N_VALIDATE_OUTPUT=1` environment variable:

1. **Pre-PATCH**: Script validates with dry-run
2. **During PATCH**: Server performs full conversion
3. **Post-PATCH**: Server validates output and writes to Notion Validation property
4. **Verification**: Script checks `validationResult.hasErrors` in response

### Validation Property
Pages include a `🔄 PATCH` indicator in the Validation property to distinguish patched pages from originals.

## Troubleshooting

### Process Stops Prematurely
```bash
# Check if still running
ps aux | grep batch-patch-validated

# Check last log entry
tail -20 patch/pages-to-update/log/batch-patch-*.log

# Count files
ls patch/pages-to-update/*.html | wc -l
ls patch/pages-to-update/updated-pages/*.html | wc -l

# Restart to process remaining
bash patch/config/batch-patch-validated.sh
```

### PATCH Fails with HTTP 400
- Verify Page ID format (32 or 36 characters)
- Check server logs for detailed error
- Ensure server is running on port 3004

### Validation Errors After PATCH
- Check `validationResult.errors` in response
- File remains in `pages-to-update` for retry
- Review server conversion logic for edge cases

### curl Hangs
- Verify timeout flags present: `-m 60` or `-m 120`
- Check file size (very large HTML may need higher timeout)
- Monitor server CPU/memory during processing

## Best Practices

1. **Always validate before PATCH**: Use dry-run to catch issues early
2. **Monitor logs**: Tail log file during batch operations
3. **Verify counts**: Compare remaining + updated = total files
4. **Restart if stuck**: Process resumable by re-running script
5. **Test single file first**: Validate workflow before batch processing
6. **Keep backups**: Archive original HTML before PATCH operations

## Related Documentation
- [Validation Logic](./deduplication-logic.md)
- [Rate Limit Protection](./RATE_LIMIT_PROTECTION.md)
- [Testing Scenarios](./TESTING_SCENARIOS.md)
