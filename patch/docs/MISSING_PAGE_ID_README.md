# Missing Page ID Files

## Issue
These HTML files were extracted from ServiceNow but are missing the `Page ID:` line in their metadata header. This means they were never successfully created as Notion pages or the Page ID was not captured during extraction.

## Files in This Folder

1. **create-a-scripted-audit-2025-11-14T07-43-30.html**
   - Captured: 2025-11-14T07:43:30
   - URL: compliance/task/t_CreateAScriptedAudit_1.html

2. **duplicate-cis-remediation-2025-11-14T07-24-02.html**
   - Captured: 2025-11-14T07:24:02
   - URL: configuration-management/concept/de-duplication-tasks_1.html

3. **explore-cmdb-workspace-2025-11-13T14-31-46.html**
   - Captured: 2025-11-13T14:31:46
   - URL: configuration-management/concept/exploring-cmdb-workspace.html

4. **home-view-in-cmdb-workspace-2025-11-13T14-32-05.html**
   - Captured: 2025-11-13T14:32:05
   - URL: configuration-management/concept/cmdb-workspace-home-view.html

## Why This Happens

Files can be missing Page IDs for several reasons:

1. **Never Created**: HTML was extracted but the initial POST request to create the Notion page failed or was never executed
2. **Extraction Error**: The userscript or extraction process didn't capture the Page ID after creation
3. **Manual Extraction**: Files were manually saved without going through the full creation workflow

## How to Fix

### Option 1: Create Fresh Pages (POST)

Use the W2N POST endpoint to create new Notion pages for these files:

```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/missing-page-id

for file in *.html; do
  echo "Creating page for: $file"
  
  # Extract page title and URL from HTML header
  title=$(grep "Page:" "$file" | sed 's/.*Page: //')
  url=$(grep "URL:" "$file" | sed 's/.*URL: //')
  
  # Create page via POST
  response=$(curl -s -X POST "http://localhost:3004/api/W2N" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"$title\",
      \"databaseId\": \"YOUR_DATABASE_ID\",
      \"contentHtml\": $(cat "$file" | jq -Rs .),
      \"url\": \"$url\"
    }")
  
  # Extract Page ID from response
  page_id=$(echo "$response" | jq -r '.data.id // empty')
  
  if [[ -n "$page_id" ]]; then
    echo "✅ Created page: $page_id"
    
    # Add Page ID to the HTML file header
    # (This would require updating the HTML comment)
    
    # Move to pages-to-update for future PATCH operations
    mv "$file" "../"
  else
    echo "❌ Failed to create page for $file"
    echo "$response" | jq .
  fi
done
```

### Option 2: Search Notion Database

These pages may already exist in your Notion database. Search by title to find existing Page IDs:

```bash
# Use the Notion API or web interface to search for:
# - "Create a scripted audit"
# - "Duplicate CIs remediation"
# - "Explore CMDB Workspace"
# - "Home view in CMDB Workspace"

# If found, manually add the Page ID to the HTML header:
# Page ID: [found-page-id]
```

### Option 3: Re-Extract from ServiceNow

If these pages exist in Notion but the HTML files are outdated, re-extract them using the userscript:

1. Navigate to the page in ServiceNow
2. Use the ServiceNow-2-Notion userscript to extract
3. The userscript should automatically fetch the existing Page ID
4. Save the newly extracted HTML (which will include the Page ID)

## Prevention

To prevent this issue in the future:

1. **Always verify Page ID capture**: After creating a page, check that the Page ID is included in the HTML metadata
2. **Use atomic operations**: Create and capture Page ID in the same operation
3. **Validate before saving**: The extraction workflow should validate that Page ID exists before saving the HTML file
4. **Add Page ID check to batch scripts**: Skip files without Page IDs and log them for manual review

## Related Scripts

- `batch-patch-with-cooldown.sh` - Already checks for Page ID and skips files without one
- Future: Create a `batch-post-new-pages.sh` script specifically for creating initial pages

## Notes

- Files in this folder will be skipped by PATCH operations (which require existing Page IDs)
- They need to go through POST (creation) before they can be PATCHed (updated)
- After successful POST creation, move them back to `pages-to-update/` for future updates
