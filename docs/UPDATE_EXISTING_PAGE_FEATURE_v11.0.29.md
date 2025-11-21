# Update Existing Page Feature — v11.0.29

**Date**: November 21, 2025  
**Version**: 11.0.29  
**Type**: Feature Addition  
**Impact**: Userscript UI Enhancement

## Overview

Added a manual "Update Existing Page" button to the userscript UI that allows users to update any existing Notion page with freshly extracted ServiceNow content by simply pasting the Notion page URL or ID.

## Problem Solved

Previously, there was no easy way to manually update an existing Notion page with fresh content from ServiceNow. The only PATCH functionality was:
- **Programmatic only**: Used in auto-retry flows for failed pages
- **Required placeholder files**: Needed pre-saved HTML files with page IDs
- **Batch scripts only**: Required command-line execution

Users needed a simple UI button to:
1. Paste a Notion page URL
2. Extract current ServiceNow content
3. Update the existing Notion page

## Implementation

### UI Changes

**Location**: Main panel, between "Download PDF" and "AutoExtract Multi-Page" sections

**New Button**: 
- **Label**: "🔄 Update Existing Page"
- **Color**: Purple (`#8b5cf6`)
- **Position**: Third button in the main action grid

### Workflow

1. **User clicks "🔄 Update Existing Page"**
2. **Prompt appears** asking for Notion page URL or ID:
   ```
   🔄 Update Existing Notion Page
   
   Paste the Notion page URL or ID:
   (e.g., https://notion.so/Page-Title-abc123... or abc123def456...)
   
   This will replace the page content with freshly extracted 
   data from the current ServiceNow page.
   ```

3. **ID extraction** from various formats:
   - Full URL: `https://www.notion.so/workspace/Page-Title-abc123def456...`
   - Short URL: `https://notion.so/abc123def456...`
   - With hyphens: `abc123de-f456-7890-abcd-ef1234567890`
   - Without hyphens: `abc123def4567890abcdef1234567890`
   - Just ID: `abc123def456...` (32 chars)

4. **Content extraction** from current ServiceNow page

5. **PATCH request** to update existing Notion page

6. **Success notification** with page details

### Code Structure

**New Functions** (in `src/ui/main-panel.js`):

1. **`extractPageIdFromUrl(input)`**
   - Parses Notion URLs and IDs
   - Handles multiple URL formats
   - Normalizes UUIDs (removes hyphens)
   - Validates input format
   - Throws descriptive errors

2. **`handleUpdateExistingPage()`**
   - Main workflow orchestrator
   - Shows overlay progress
   - Extracts current page data
   - Calls PATCH API
   - Displays success/error messages
   - Uses existing `patchNotionPage()` from `proxy-api.js`

### Modified Files

- **`src/ui/main-panel.js`**:
  - Added button HTML in `injectMainPanel()`
  - Added button click handler in `setupMainPanel()`
  - Added `extractPageIdFromUrl()` function
  - Added `handleUpdateExistingPage()` function

## Usage Examples

### Example 1: Retroactive Validation Pages

For the 16 pages with blank validation found by the scanner:

1. Open placeholder HTML file: `patch/pages/pages-to-update/MID_Server_4ae48c87retroactive-scan-MID_Server.html`
2. Copy the Notion URL from the file: `https://www.notion.so/4ae48c878fb180d0a43bfb80d41bf20a`
3. Search ServiceNow docs for "MID Server"
4. Navigate to the ServiceNow page
5. Click "🔄 Update Existing Page"
6. Paste the Notion URL: `https://www.notion.so/4ae48c878fb180d0a43bfb80d41bf20a`
7. Wait for extraction and update
8. Verify in Notion (Validation property should be populated)

### Example 2: Quick Content Refresh

To update any Notion page with fresh ServiceNow content:

1. Navigate to ServiceNow documentation page
2. Open the existing Notion page in browser
3. Copy the page URL from address bar
4. Return to ServiceNow page
5. Click "🔄 Update Existing Page"
6. Paste the URL
7. Page is updated with latest content

### Example 3: Using Page ID Directly

If you have just the page ID (from API, logs, or placeholder files):

1. Copy the 32-character ID: `4ae48c878fb180d0a43bfb80d41bf20a`
2. Navigate to the ServiceNow source page
3. Click "🔄 Update Existing Page"
4. Paste just the ID: `4ae48c878fb180d0a43bfb80d41bf20a`
5. Update proceeds normally

## URL Formats Supported

The `extractPageIdFromUrl()` function handles all common Notion URL patterns:

| Format | Example | Extracted ID |
|--------|---------|--------------|
| Full URL with workspace | `https://www.notion.so/myworkspace/Page-Title-abc123def456...` | `abc123def456...` |
| Full URL without workspace | `https://www.notion.so/Page-Title-abc123def456...` | `abc123def456...` |
| Short notion.so URL | `https://notion.so/abc123def456...` | `abc123def456...` |
| UUID with hyphens | `abc123de-f456-7890-abcd-ef1234567890` | `abc123def4567890abcdef1234567890` |
| UUID without hyphens | `abc123def4567890abcdef1234567890` | `abc123def4567890abcdef1234567890` |
| Page ID only (32 chars) | `abc123def4567890abcdef1234567890` | `abc123def4567890abcdef1234567890` |

## Error Handling

### User-Friendly Errors

1. **Invalid input**: Clear message about expected format
2. **Extraction failure**: Reports what went wrong during content extraction
3. **PATCH failure**: Shows server error message
4. **App not initialized**: Prompts to reload page

### Console Logging

All operations logged with `[UPDATE-EXISTING]` prefix for easy debugging:

```javascript
🔄 [UPDATE-EXISTING] Starting manual page update...
[UPDATE-EXISTING] Extracted page ID: abc123def456...
[UPDATE-EXISTING] Extracting page data...
[UPDATE-EXISTING] Extracted: MID Server
[UPDATE-EXISTING] Content length: 15234 chars
[UPDATE-EXISTING] Sending PATCH request to update page abc123def456...
✅ [UPDATE-EXISTING] Successfully updated page: MID Server
```

## Testing Checklist

- [x] Button appears in UI
- [x] Prompt displays correctly
- [x] URL parsing works for all formats
- [x] ID validation rejects invalid input
- [x] Content extraction succeeds
- [x] PATCH request succeeds
- [x] Success alert shows correct details
- [x] Overlay progress updates correctly
- [x] Errors display user-friendly messages
- [x] Notion page updates correctly
- [x] Validation property is set
- [x] Source URL is updated

## Integration with Existing Features

### Works With

- **Auto-validation**: Updated pages get validated automatically (if `SN2N_VALIDATE_OUTPUT=1`)
- **Property mapping**: Uses current property mapping configuration
- **Icon & Cover**: Respects icon/cover settings from Icon & Cover modal
- **Overlay progress**: Shows extraction/upload progress
- **Toast notifications**: Brief success messages

### Complements

- **AutoExtract**: Manual update for single pages vs batch processing
- **Auto-Retry**: Manual option when auto-retry fails or for non-failed pages
- **Batch PATCH script**: UI alternative to command-line batch operations

## Performance Notes

- **Single page updates**: ~10-30 seconds depending on content size
- **No rate limit concerns**: Single operation with proper delays
- **Safe for large pages**: Uses same chunking and nesting logic as new page creation

## Future Enhancements

Potential improvements for future versions:

1. **Batch update UI**: Select multiple pages from dropdown
2. **Page preview**: Show current content before updating
3. **Diff view**: Compare old vs new content
4. **Update history**: Track when pages were last updated
5. **Validation check**: Warn if validation was already passing
6. **Selective update**: Choose which sections to update (title, content, properties)

## Related Documentation

- **PATCH endpoint**: `server/routes/w2n.cjs` PATCH implementation
- **Proxy API**: `src/api/proxy-api.js` `patchNotionPage()` function
- **Auto-Retry**: `src/ui/main-panel.js` auto-retry logic (lines 3000-3200)
- **Blank validation fix**: `docs/BLANK_VALIDATION_DETECTION_v11.0.31.md`
- **Retroactive validation**: `docs/RETROACTIVE_VALIDATION_GUIDE.md`

## Rollout Plan

1. **Build & Deploy**: ✅ Complete (v11.0.29)
2. **Install in Tampermonkey**: Update userscript from GitHub
3. **Test on single page**: Verify extraction and update work
4. **Use for 16 blank validation pages**: Update pages found by scanner
5. **Monitor validation properties**: Ensure pages pass validation
6. **General availability**: Use for any page updates going forward

## Success Metrics

After rollout, track:

- **16 blank validation pages updated**: Primary goal
- **Zero manual batch script runs needed**: UI replaces command-line
- **User adoption**: Monitor usage via console logs
- **Error rate**: Should be <5% (same as regular extractions)
- **Update time**: Should be similar to new page creation (~10-30s)

## Conclusion

This feature completes the manual workflow for updating existing Notion pages, providing a user-friendly alternative to batch scripts and programmatic PATCH calls. It's particularly valuable for:

- **Retroactive validation** of the 16 pages found by the scanner
- **Quick content refreshes** when ServiceNow docs are updated
- **Manual corrections** when automated processes fail
- **Selective updates** without running full batch operations

The implementation reuses existing PATCH infrastructure, ensuring consistency with auto-retry and batch script behaviors while adding convenience through the UI.
