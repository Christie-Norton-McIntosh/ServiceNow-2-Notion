# PATCH Endpoint for Updating Existing Notion Pages

## Overview

The PATCH endpoint (`/api/W2N/:pageId`) allows you to update existing Notion pages with freshly extracted content from ServiceNow HTML. This is useful for fixing pages that were created with buggy extraction code.

**Strategy**: Delete-all + Re-upload
- Simpler than surgical patching (no complex diffing required)
- Ensures correct block ordering
- No risk of orphaned blocks
- Preserves page ID, URL, and properties

## Endpoint Details

### URL
```
PATCH /api/W2N/:pageId
```

### Request Parameters

**URL Parameter:**
- `pageId` (string, required): The 32-character Notion page ID (without hyphens)

**Body (JSON):**
```json
{
  "title": "Page Title",
  "contentHtml": "<html>...</html>",  // or "content"
  "properties": { ... },               // optional
  "dryRun": true                        // optional, default: false
}
```

### Response

**Success (200):**
```json
{
  "success": true,
  "data": {
    "pageId": "2a8a89fedba5819f878def61ebb4545e",
    "pageUrl": "https://notion.so/2a8a89fedba5819f878def61ebb4545e",
    "blocksDeleted": 25,
    "blocksAdded": 30,
    "hasVideos": false,
    "validation": { ... }  // if SN2N_VALIDATE_OUTPUT=1
  }
}
```

**Dry Run Response:**
```json
{
  "success": true,
  "data": {
    "dryRun": true,
    "pageId": "2a8a89fedba5819f878def61ebb4545e",
    "blocksExtracted": 30,
    "blockTypes": {
      "numbered_list_item": 10,
      "paragraph": 8,
      "heading_3": 2,
      ...
    },
    "children": [ ... ],  // full block array
    "hasVideos": false
  }
}
```

**Error (4xx/5xx):**
```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Error description",
  "details": null
}
```

## How It Works

### Process Flow

1. **Validate Input**
   - Check page ID format (must be 32 characters)
   - Verify HTML content exists

2. **Extract Fresh Content**
   - Use `htmlToNotionBlocks()` to parse ServiceNow HTML
   - Returns `{ blocks, hasVideos }` with all extracted blocks
   - Logs extraction progress and warnings

3. **Dry Run Mode** (if `dryRun: true`)
   - Returns extracted blocks without making any changes
   - Useful for previewing updates before applying

4. **Delete All Existing Blocks**
   - Fetch all blocks from page (paginated, 100 per request)
   - Delete each block with rate limit protection
   - Delays 100ms every 10 deletions
   - Exponential backoff on 429 errors (1s, 2s, 4s, max 5s)

5. **Upload Fresh Content**
   - Strip private `_sn2n_` keys from blocks
   - Deduplicate blocks
   - Collect markers for deep nesting orchestration
   - Normalize rich_text annotations
   - Upload in batches (100 blocks per API call)
   - Rate limit protection between batches

6. **Run Orchestration** (if markers exist)
   - Execute `orchestrateDeepNesting()` for 3+ level nesting
   - Append deeply-nested children to parent blocks
   - Clean up marker tokens

7. **Update Properties** (if provided)
   - Update page properties via `notion.pages.update()`
   - Non-fatal if fails

8. **Validate** (if `SN2N_VALIDATE_OUTPUT=1`)
   - Run `validateNotionPage()` to check content
   - Compare expected vs actual counts (tables, images, headings, etc.)
   - Non-fatal if fails

## Usage Examples

### Using the Test Script

```bash
cd server

# Dry run (preview only, no changes)
node test-patch-endpoint.cjs \
  "../tests/fixtures/validation-failures/add-related-tasks-to-a-change-schedule-2025-11-11T07-02-54.html" \
  "2a8a89fe-dba5-819f-878d-ef61ebb4545e" \
  --dry-run

# Actual update (deletes + re-uploads content)
node test-patch-endpoint.cjs \
  "../tests/fixtures/validation-failures/add-related-tasks-to-a-change-schedule-2025-11-11T07-02-54.html" \
  "2a8a89fe-dba5-819f-878d-ef61ebb4545e"
```

### Using curl

```bash
# Dry run
curl -X PATCH http://localhost:3004/api/W2N/2a8a89fedba5819f878def61ebb4545e \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "title": "Test Page",
  "contentHtml": "<p>Fresh content</p>",
  "dryRun": true
}
EOF

# Actual update
curl -X PATCH http://localhost:3004/api/W2N/2a8a89fedba5819f878def61ebb4545e \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "title": "Test Page",
  "contentHtml": "<p>Fresh content</p>"
}
EOF
```

### Batch Update Script

Create `batch-update-pages.sh`:

```bash
#!/bin/bash

# Update multiple validation failure pages

for file in tests/fixtures/validation-failures/*.html; do
  # Extract page ID from file
  pageId=$(grep -m 1 "Page ID:" "$file" | awk '{print $3}')
  
  if [ -z "$pageId" ]; then
    echo "⚠️ No page ID found in $file, skipping"
    continue
  fi
  
  # Convert to 32-char format (remove hyphens)
  pageId32=$(echo "$pageId" | tr -d '-')
  
  echo "📄 Updating page from: $(basename "$file")"
  echo "   Page ID: $pageId → $pageId32"
  
  # Read HTML content
  html=$(<"$file")
  
  # Extract title from filename
  filename=$(basename "$file" .html)
  title=$(echo "$filename" | sed 's/-[0-9]\{4\}-.*$//' | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2));}1')
  
  # Update page
  curl -X PATCH "http://localhost:3004/api/W2N/$pageId32" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg title "$title" --arg html "$html" '{title: $title, contentHtml: $html}')" \
    -o /dev/null -w "   Status: %{http_code}\n"
  
  # Rate limit protection
  sleep 1
  
  echo ""
done

echo "✅ Batch update complete!"
```

Make it executable:
```bash
chmod +x batch-update-pages.sh
./batch-update-pages.sh
```

## Rate Limit Protection

The endpoint includes comprehensive rate limit handling:

### Block Deletion
- Delays 100ms every 10 deletions
- Exponential backoff on 429 errors (max 5 retries)
- Delays: 1s, 2s, 4s, 8s (max 5s)

### Block Upload
- Uploads in batches of 100 blocks
- 100ms delay between batches
- Exponential backoff on 429 errors (max 5 retries)
- Separate retry counter for rate limits vs other errors

### Deep Nesting Orchestration
- Same exponential backoff pattern
- Per-marker retry logic

## Testing

### Dry Run Testing

Always test with `--dry-run` first:

```bash
node test-patch-endpoint.cjs \
  "../tests/fixtures/validation-failures/YOUR_FILE.html" \
  "YOUR_PAGE_ID" \
  --dry-run
```

**Dry run output:**
- ✅ Extracted block count
- 📊 Block type breakdown (heading, paragraph, list, table, etc.)
- 🎬 Video detection
- ❌ No actual changes to Notion page

### Full Update Testing

After verifying dry run output looks correct:

```bash
node test-patch-endpoint.cjs \
  "../tests/fixtures/validation-failures/YOUR_FILE.html" \
  "YOUR_PAGE_ID"
```

**Update output:**
- 🗑️ Blocks deleted count
- 📤 Blocks added count
- 🔗 Updated page URL
- 🔍 Validation results (if enabled)

### Validation After Update

Enable validation to verify content:

```bash
# Terminal 1: Start server with validation
cd server
SN2N_VALIDATE_OUTPUT=1 node sn2n-proxy.cjs

# Terminal 2: Run update
node test-patch-endpoint.cjs ... (without --dry-run)
```

Validation checks:
- ✅ Table count (expected vs actual)
- ✅ Image count
- ✅ Heading count
- ✅ Callout count
- ⚠️ Marker leaks (should be 0)

## Finding Page IDs

### From Validation Fixture Files

```bash
grep "Page ID:" tests/fixtures/validation-failures/*.html
```

Output:
```
add-related-tasks-to-a-change-schedule-2025-11-11T07-02-54.html:  Page ID: 2a8a89fe-dba5-819f-878d-ef61ebb4545e
configure-ability-to-copy-change-requests-2025-11-11T07-00-33.html:  Page ID: 1234abcd-5678-90ef-ghij-klmnopqrstuv
...
```

### From Notion URL

Notion URL format:
```
https://notion.so/Page-Title-2a8a89fedba5819f878def61ebb4545e
```

Page ID is the last 32 characters (no hyphens needed for API call).

### Convert 36-char to 32-char Format

If you have a hyphenated UUID (36 chars):
```bash
echo "2a8a89fe-dba5-819f-878d-ef61ebb4545e" | tr -d '-'
# Output: 2a8a89fedba5819f878def61ebb4545e
```

## Common Use Cases

### Fix Validation Failures

1. Run validation on all pages:
   ```bash
   npm run test:validation
   ```

2. Identify pages with issues (e.g., missing images, wrong block counts)

3. Fix source HTML or extraction code

4. Re-upload corrected content:
   ```bash
   node test-patch-endpoint.cjs \
     "path/to/fixed-source.html" \
     "failed-page-id"
   ```

### Apply Bug Fixes to Existing Pages

After fixing extraction bugs (e.g., article.nested1 headings, inline images):

1. Find all affected pages (pages created before fix)
2. Re-extract content from original HTML
3. Batch update all pages
4. Validate updated content

### Refresh Stale Content

Re-scrape ServiceNow page, then update Notion:

1. Extract fresh HTML from ServiceNow
2. Update Notion page with `PATCH /api/W2N/:pageId`
3. Page URL remains unchanged (preserves links)

## Troubleshoments

### Error: "INVALID_PAGE_ID"
- Page ID must be 32 characters (no hyphens)
- Convert: `echo "abc-def-ghi" | tr -d '-'`

### Error: "EXTRACTION_FAILED"
- Check HTML content is valid
- Check server logs for extraction errors
- Test extraction with dry run first

### Error: "PAGE_UPDATE_FAILED"
- Check page ID exists in Notion
- Check Notion API token has write permissions
- Check for rate limit errors (429)
- Retry with exponential backoff

### Empty Block Counts
- Check HTML file is not empty
- Check for Cheerio parsing issues
- Enable verbose logging: `SN2N_VERBOSE=1`

### Validation Warnings After Update
- Some discrepancies expected (marker orchestration)
- Check specific issue types (tables, images, headings)
- Re-run validation after orchestration completes

## Implementation Files

- **Endpoint**: `server/routes/w2n.cjs` (lines 1260+)
- **Hot-reload wrapper**: `server/sn2n-proxy.cjs` (lines 1840+)
- **Test script**: `server/test-patch-endpoint.cjs`
- **Extraction**: `server/services/servicenow.cjs`
- **Orchestration**: `server/orchestration/deep-nesting.cjs`
- **Validation**: `server/utils/validate-notion-page.cjs`

## Related Documentation

- [Rate Limit Protection](./RATE_LIMIT_PROTECTION.md)
- [Deep Nesting Orchestration](./html-processing-order.md)
- [Validation Testing](./TESTING_PLAN_v11.0.7.md)
- [Extraction Fixes (v11.0.0)](../RELEASE_NOTES_11.0.0.md)
