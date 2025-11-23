# Failed Validation Folder

## Purpose

This folder contains pages where validation property updates failed after page creation.

## What Pages Are Here

Pages are automatically saved to this folder when:
1. ✅ Page creation in Notion succeeds
2. ✅ Content and blocks are uploaded successfully
3. ❌ But the validation property update fails after multiple retries (5 attempts)

## Why This Happens

Validation property updates can fail due to:
- Transient Notion API issues
- Rate limiting during bulk operations
- Network connectivity problems
- API timeout during complex page creation

## What To Do

These pages need to be **revalidated** (not re-created):

1. **Check the validation-property-failures.log**:
   ```
   tail -f ../logs/validation-property-failures.log
   ```

2. **Run manual revalidation** on specific pages:
   ```bash
   node server/revalidate-pages.cjs
   ```

3. **Or use the PATCH endpoint** to update validation properties:
   ```bash
   curl -X PATCH http://localhost:3004/api/W2N/{PAGE_ID} \
     -H "Content-Type: application/json" \
     -d @path/to/page.html
   ```

## File Format

Each HTML file includes metadata in HTML comments:
- Page ID (for revalidation)
- Page URL (Notion link)
- Original validation result
- Error details from property update failure

## Workflow Integration

After fixing issues:
1. Pages can be revalidated using the revalidation script
2. Successfully revalidated pages should be moved to `updated-pages/`
3. Or deleted if no longer needed

## Note

These pages **already exist in Notion** with content. They just need their validation properties updated.
