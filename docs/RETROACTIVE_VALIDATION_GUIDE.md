# Retroactive Validation Guide — Fix v11.0.31

**Date**: November 21, 2025  
**Purpose**: Validate and re-extract pages created before validation was enabled

## Quick Start

### 1. Find Pages with Blank Validation

```bash
cd server
node scan-blank-validation.cjs
```

**Output**: Lists all pages with blank validation + saves list to `blank-validation-list.json`

### 2. Auto-Save Pages for Re-Extraction

```bash
cd server
node scan-blank-validation.cjs --fix
```

**Result**: Creates placeholder HTML files in `patch/pages/pages-to-update/` for each blank validation page

### 3. Current Status (as of 2025-11-21)

- **Total pages**: 1,765
- **Valid validation**: 1,749 (99.1%)
- **Blank validation**: 16 (0.9%)
- **Auto-saved**: 16 pages

## Understanding the Issue

### Why Pages Have Blank Validation

1. **Created before validation enabled** — Pages created when `SN2N_VALIDATE_OUTPUT=1` was not set
2. **Missing Source URL** — All 16 pages have `Source URL: N/A`, indicating they were created early
3. **Property update failures** — Silent failures during property updates (now fixed in v11.0.31)

### Risk Assessment

**Low Risk** (16 pages, 0.9%):
- Small percentage of total pages
- All pages DO have content in Notion (verified by scan)
- Most are MID Server and Knowledge Management pages
- Created Nov 20-21, 2025

**Content exists but unvalidated**: Pages were successfully created but never checked for:
- Block count accuracy
- Content completeness
- Formatting correctness

## Validation Approaches

### Option A: Manual UI Update (Recommended — NEW in v11.0.29)

For 16 pages, use the new "Update Existing Page" button in the userscript UI:

1. **Open the saved list to get page URLs**:
   ```bash
   cat patch/pages/blank-validation-list.json | jq -r '.[] | "\(.title) - \(.notionUrl)"'
   ```

2. **For each page**:
   - **Identify the ServiceNow source** (use title to search ServiceNow docs)
   - **Navigate to the ServiceNow page** in browser
   - **Open the userscript panel** (should appear automatically)
   - **Click "🔄 Update Existing Page"** button
   - **Paste the Notion page URL** from the list (or just the page ID)
   - **Wait for extraction and update** (~10-30 seconds)
   - **Verify success** in the alert message
   - **Check Notion page** to confirm validation is populated

3. **Track progress**:
   ```bash
   # Move completed files to archive
   mv patch/pages/pages-to-update/*retroactive-scan-*.html \
      patch/pages/updated-pages/
   ```

**See detailed instructions**: `docs/UPDATE_EXISTING_PAGE_FEATURE_v11.0.29.md`

### Option B: Batch PATCH Script (For Larger Lists)

For larger numbers of pages, use the automated batch script:

1. **Navigate to patch config**:
   ```bash
   cd patch/config
   ```

2. **Run batch script**:
   ```bash
   bash batch-patch-with-cooldown.sh 2>&1 | tee /tmp/batch-patch-latest.log
   ```

3. **Monitor progress**:
   - Script processes all HTML files in `pages-to-update/`
   - Successful updates moved to `updated-pages/`
   - Failed pages remain for retry

**See detailed guide**: `patch/README.md`

### Option C: Manual Validation Check

For pages where you can't find the source URL, manually validate content:

1. **Open page in Notion**
2. **Check for completeness**:
   - Are all sections present?
   - Are images loaded?
   - Are tables formatted correctly?
   - Are code blocks intact?
   - Are lists properly nested?

3. **If content looks good**, manually set validation property:
   ```bash
   # Use Notion API to set Validation property
   curl -X PATCH https://api.notion.com/v1/pages/<page-id> \
     -H "Authorization: Bearer $NOTION_TOKEN" \
     -H "Notion-Version: 2022-06-28" \
     -H "Content-Type: application/json" \
     -d '{
       "properties": {
         "Validation": {
           "rich_text": [
             {
               "type": "text",
               "text": { "content": "✅ Manual validation: Content verified complete" }
             }
           ]
         }
       }
     }'
   ```

### Option D: Custom Batch Script (Advanced)

For special cases, create a custom batch PATCH script:

```bash
#!/bin/bash
# batch-patch-blank-validation.sh

for file in patch/pages/pages-to-update/*retroactive-scan*.html; do
  # Extract page ID from HTML comment
  page_id=$(grep -o 'Page ID: [a-f0-9-]\+' "$file" | cut -d' ' -f3)
  title=$(grep -o 'Page Title: .*' "$file" | cut -d' ' -f3-)
  
  echo "Processing: $title (ID: $page_id)"
  
  # Option 1: If you have original ServiceNow HTML
  # curl -X PATCH http://localhost:3004/api/W2N/$page_id \
  #   -H "Content-Type: application/json" \
  #   -d @payload.json
  
  # Option 2: Mark as manually verified
  # ... (see manual validation above)
done
```

## The 16 Pages Requiring Validation

### MID Server Pages (7 pages)
1. MID Server parameters
2. MID Server properties
3. Install a MID Server on Windows
4. Attach a script file to a file synchronized MID Server
5. MID Server system requirements
6. Install and uninstall Nmap on a MID Server
7. Exploring Entity View Action Mapper

### Knowledge Management Pages (8 pages)
8. Deploy Knowledge Management - Add-in for Microsoft Word
9. Activate the sitemap configuration and definition records for the Knowledge Portal
10. Integrating a custom search or knowledge article viewer with knowledge blocks
11. Add a knowledge block to a knowledge article in Agent Workspace
12. Comment on a knowledge article
13. Migrate to Knowledge Management v3
14. Create document references from document record
15. Compare two versions of an article

### Service Graph Connector (1 page)
16. CMDB classes targeted in Service Graph Connector for Microsoft Azure

## Verification Checklist

For each re-extracted page, verify:

- [ ] Validation property is populated (not blank)
- [ ] Error checkbox is cleared (not checked)
- [ ] Stats property has block counts
- [ ] Block count matches expected content
- [ ] No validation errors in Validation property
- [ ] Images are loaded (not broken)
- [ ] Tables are formatted correctly
- [ ] Code blocks have proper syntax highlighting
- [ ] Lists are properly nested
- [ ] Callouts have correct icons and colors

## Monitoring Future Pages

With v11.0.31 fix deployed, all future pages will be caught automatically:

### POST Endpoint
```javascript
// After page creation completes
[FINAL-CHECK] Verifying Validation property was set...
✅ [FINAL-CHECK] Validation property confirmed present
// OR
❌ [FINAL-CHECK] CRITICAL: Validation property is BLANK
✅ [FINAL-CHECK] AUTO-SAVED: <filename>
```

### PATCH Endpoint
```javascript
// After PATCH operation completes
[FINAL-CHECK-PATCH] Verifying Validation property was set...
✅ [FINAL-CHECK-PATCH] Validation property confirmed present
// OR
❌ [FINAL-CHECK-PATCH] CRITICAL: Validation property is BLANK
✅ [FINAL-CHECK-PATCH] AUTO-SAVED: <filename>
```

### Log Filtering
```bash
# Check for final check executions
grep '\[FINAL-CHECK\]' logs/latest.log

# Check for auto-saved pages
grep 'AUTO-SAVED:' logs/latest.log | grep -i blank

# Count blank validation detections today
grep -c 'Validation property is BLANK' logs/latest.log
```

## Prevention Measures

### Server Configuration
Always run server with validation enabled:

```bash
# In .env file (server/.env or root .env)
SN2N_VALIDATE_OUTPUT=1
SN2N_VERBOSE=1

# Or in VS Code tasks.json
SN2N_VALIDATE_OUTPUT=1 node sn2n-proxy.cjs
```

### Regular Scans
Schedule periodic scans to catch any missed pages:

```bash
# Add to crontab (daily at 2am)
0 2 * * * cd /path/to/repo/server && node scan-blank-validation.cjs --fix >> /var/log/sn2n-scan.log 2>&1
```

### Health Check
Add to monitoring dashboard:

```bash
# Get current blank validation count
curl -s http://localhost:3004/api/status | jq '.validation.blank_count'
```

## Troubleshooting

### "Could not find database"
- Ensure Notion integration has access to database
- Check `NOTION_TOKEN` in .env
- Verify database is shared with integration

### "Source URL: N/A"
- Page was created before Source URL property was added
- Use page title to search ServiceNow docs manually
- Or mark as manually verified if content looks complete

### "Page has no content blocks"
- Page was created but upload failed
- Delete from Notion and re-create fresh
- Or mark for deletion in tracking sheet

### Rate Limits
The scan script includes rate limit protection:
- 200ms delay between database queries
- 300ms delay between page block checks
- For 1,765 pages: ~9 minutes total scan time

## Success Metrics

- **Baseline**: 16 pages (0.9%) with blank validation
- **Target**: 0 pages with blank validation
- **Current**: Monitoring after fix deployment
- **Weekly Goal**: Re-extract or verify all 16 pages

## Related Documentation

- **Fix documentation**: `docs/BLANK_VALIDATION_DETECTION_v11.0.31.md`
- **Scan script**: `server/scan-blank-validation.cjs`
- **Auto-validation docs**: `docs/AUTO-VALIDATION.md`
- **Batch PATCH guide**: `patch/README.md`

---

**Status**: ✅ 16 pages identified and saved for re-extraction  
**Next Action**: Manually re-extract pages using ServiceNow userscript  
**Timeline**: Complete within 1 week for all 16 pages
