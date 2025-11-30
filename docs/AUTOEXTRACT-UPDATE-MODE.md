# AutoExtract and Update Mode

**Version**: 11.0.83  
**Feature**: Update existing Notion pages during AutoExtract instead of creating new ones

## Overview

The AutoExtract feature now supports an "Update Mode" that searches for existing pages by title and updates them instead of creating duplicates. This is useful for:

- Applying formatting improvements to previously extracted pages
- Re-extracting content after bug fixes
- Refreshing page content without manual PATCH operations

## How It Works

### UI Controls

A new checkbox appears in the AutoExtract section:

```
🔄 Update existing pages (search by title)
   Updates matching pages instead of creating new ones
```

### Behavior

**When checkbox is UNCHECKED (default):**
- Normal AutoExtract behavior
- Creates new pages in the selected database
- Shows: "Created page X"

**When checkbox is CHECKED (Update Mode):**
1. Extracts content from ServiceNow page
2. Searches selected database for page with matching title
3. If found: Updates the page using PATCH endpoint
4. If not found: Creates new page with 🆕 emoji prefix in title
5. Shows: "Updated: [title]" or "🆕 Created: [title]"

## Technical Implementation

### Client-Side Functions

**`searchNotionPageByTitle(databaseId, title)`**
- Queries Notion database with title filter
- Returns first matching page or null
- Uses existing `queryDatabase` API

**`updateNotionPage(pageId, extractedData)`**
- Calls PATCH `/api/W2N/:pageId` endpoint
- Sends title, contentHtml, and url
- Same validation as POST endpoint

### AutoExtract Loop Integration

```javascript
// Check mode
const updateMode = document.getElementById('w2n-autoextract-update-mode')?.checked;

if (updateMode) {
  // Search for existing page
  const existingPage = await searchNotionPageByTitle(config.databaseId, extractedData.title);
  
  if (existingPage) {
    // Update via PATCH
    await updateNotionPage(existingPage.id, extractedData);
    autoExtractState.totalUpdated++;
  } else {
    // Create new with 🆕 prefix
    extractedData.title = `🆕 ${extractedData.title}`;
    await app.processWithProxy(extractedData);
    autoExtractState.totalCreated++;
  }
} else {
  // Normal create via POST
  await app.processWithProxy(extractedData);
  autoExtractState.totalProcessed++;
}
```

### Stats Tracking

New counters added to `autoExtractState`:
- `totalUpdated`: Pages successfully updated
- `totalCreated`: Pages created with 🆕 prefix (not found in database)
- `totalProcessed`: Total successful operations (created + updated + new with 🆕)

### Completion Summary

**With update mode enabled:**
```
✅ AutoExtract complete! Processed 15 page(s) (10 created (5 with 🆕), 5 updated)
```

**Debug logs:**
```
[AUTO-EXTRACT] 📊 Stats: 10 created (5 with 🆕), 5 updated
```

## Error Handling

### Page Not Found
- Logs: `🆕 Page "[title]" not found, creating new page with 🆕 prefix...`
- Toast: `🆕 Created: [title]`
- Creates new page with title: `🆕 [original title]`
- Increments `totalCreated`
- Continues to next page (does NOT stop AutoExtract)

### PATCH Failure
- Treated as capture failure
- Retries up to 3 times (same as POST failures)
- If still failing, adds to `failedPages` list

### Search Failure
- Logs error but continues
- Returns `null` (treated as "not found")
- Page is skipped

## Usage Examples

### Example 1: Refresh Formatting for Existing Pages

1. Enable "Update existing pages" checkbox
2. Select same database used for original extraction
3. Start AutoExtract
4. Existing pages will be updated
5. New pages will be created with 🆕 prefix

### Example 2: Identify New vs Existing Pages

**Use Case**: Apply formatting changes to all pages, but clearly mark which are new

1. Enable update mode
2. AutoExtract all pages
3. Result:
   - Existing pages: Updated with new formatting
   - New pages: Created with 🆕 prefix
4. Search Notion for "🆕" to find all new pages
5. Manually review and remove 🆕 prefix when verified

### Example 3: Incremental Updates

**Use Case**: Regularly sync ServiceNow documentation to Notion

1. First run: Disable update mode, extract all pages normally
2. Subsequent runs: Enable update mode
   - Updates existing pages with latest content
   - Creates new pages with 🆕 prefix for review
3. Periodically review 🆕 pages and clean up prefixes

## API Endpoints Used

### Search: `POST /api/databases/:databaseId/query`
```json
{
  "filter": {
    "property": "title",
    "rich_text": {
      "equals": "exact title"
    }
  },
  "page_size": 1
}
```

### Update: `PATCH /api/W2N/:pageId`
```json
{
  "title": "Page Title",
  "contentHtml": "<div>...</div>",
  "url": "https://servicenow.com/..."
}
```

## Debug Logging

All update-mode operations use the `[AUTOEXTRACT-UPDATE]` prefix for easy filtering:

```
[AUTOEXTRACT-UPDATE] 🔍 Searching for page with title: "..."
[AUTOEXTRACT-UPDATE] ✅ Found existing page: 123-abc-456
[AUTOEXTRACT-UPDATE] 📝 Updating page 123-abc-456...
[AUTO-EXTRACT] 🆕 Page "..." not found, creating new page with 🆕 prefix...
[AUTOEXTRACT-UPDATE] ❌ Error searching for page: ...
```

## Limitations

### Title Matching
- Uses **exact match** only (case-sensitive)
- Does NOT use fuzzy matching or similarity
- Special characters must match exactly

### Performance
- Adds ~1-2 seconds per page (search + PATCH vs just POST)
- Same orchestration and validation as POST
- Deep nesting handled identically

### Not Found Behavior
- **Current**: Creates new page with 🆕 prefix
- **Benefits**:
  - No pages are lost/skipped
  - Easy to identify which pages are new
  - Can review and bulk-edit 🆕 pages later
- **Alternative considered**: Skip entirely (too risky, could lose content)

## Version History

- **v11.0.84**: Changed "not found" behavior to create with 🆕 prefix
  - Pages not found in database are now created (not skipped)
  - New pages automatically prefixed with 🆕 emoji
  - Updated stats to track `totalCreated` (pages with 🆕)
  - Completion messages show breakdown of created vs updated
  - UI description updated to reflect new behavior

- **v11.0.83**: Initial implementation of AutoExtract Update Mode
  - Added checkbox to UI
  - Implemented `searchNotionPageByTitle` and `updateNotionPage`
  - Integrated with AutoExtract loop
  - Added stats tracking
  - Updated completion messages

## Future Enhancements

Possible improvements for future versions:

1. **Configurable Prefix**: Allow user to customize the "🆕" emoji/prefix
2. **Fuzzy Matching**: Use similarity threshold instead of exact match
3. **Batch Search**: Search for all titles upfront, cache results
4. **Update Preview**: Show which pages will be updated before starting
5. **Dry Run**: Preview updates without actually PATCHing
6. **Selective Update**: Checkbox to update only certain properties (e.g., content but not title)
7. **Bulk Remove Prefix**: Tool to find and remove 🆕 from verified pages

## Related Documentation

- **AutoExtract**: See `README.md` for basic AutoExtract usage
- **PATCH Endpoint**: See `server/routes/w2n.cjs` lines 2983-4200
- **Validation**: See `docs/AUTO-VALIDATION.md` for validation details
- **Deep Nesting**: See Copilot instructions for orchestration details
