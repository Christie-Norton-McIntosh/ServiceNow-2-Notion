# 🔄 Update Existing Page — User Guide

**New in v11.0.29** — Update any Notion page with fresh ServiceNow content in 3 clicks!

---

## What Does This Do?

Updates an existing Notion page with freshly extracted content from the current ServiceNow page. Perfect for:

- ✅ Fixing pages that failed validation
- ✅ Refreshing outdated content
- ✅ Correcting extraction errors
- ✅ Re-extracting after ServiceNow updates

---

## Where Is It?

The button appears in your **ServiceNow-2-Notion panel** on any ServiceNow docs page:

```
┌────────────────────────────────────┐
│  📚 ServiceNow to Notion           │
│                                    │
│  Database: [Your Database]         │
│                                    │
│  ┌──────────────────────────────┐ │
│  │ 📄 Save Current Page         │ │  ← Create new page
│  └──────────────────────────────┘ │
│  ┌──────────────────────────────┐ │
│  │ 📖 Download PDF              │ │  ← Download as PDF
│  └──────────────────────────────┘ │
│  ┌──────────────────────────────┐ │
│  │ 🔄 Update Existing Page      │ │  ← NEW! Update existing
│  └──────────────────────────────┘ │
│                                    │
│  🤖 AutoExtract Multi-Page         │
│  ...                               │
└────────────────────────────────────┘
```

---

## How to Use It

### Quick Steps

1. **Navigate to the ServiceNow page** you want to extract from
2. **Click "🔄 Update Existing Page"** in the panel
3. **Paste the Notion page URL or ID** (from your browser address bar or saved list)
4. **Wait ~10-30 seconds** for extraction and update
5. **Done!** Success message shows the page was updated

### What to Paste

You can paste any of these:

| Format | Example |
|--------|---------|
| **Full URL** | `https://www.notion.so/workspace/MID-Server-4ae48c878fb180d0a43b...` |
| **Short URL** | `https://notion.so/4ae48c878fb180d0a43bfb80d41bf20a` |
| **Page ID** | `4ae48c878fb180d0a43bfb80d41bf20a` |

---

## Real Example

**Scenario**: You have a Notion page about "MID Server" that needs updated content.

1. **Open ServiceNow**: Navigate to https://docs.servicenow.com/.../mid-server
2. **Click the button**: Find "🔄 Update Existing Page" in the panel
3. **Paste URL**: Enter `https://www.notion.so/4ae48c878fb180d0a43bfb80d41bf20a`
4. **Watch progress**:
   - 📝 Extracting content... (5 seconds)
   - 📤 Updating page... (15 seconds)
   - ✅ Success! (alert appears)
5. **Verify**: Open Notion, confirm content is updated

---

## What Gets Updated?

### ✅ Updated
- **All page content** (blocks deleted and replaced with fresh content)
- **Validation property** (re-validated)
- **Stats property** (new block counts)
- **Source URL** (updated to current ServiceNow URL)
- **Error checkbox** (cleared if validation passes)

### ✅ Preserved
- **Page ID** (same page, not a new one)
- **Page location** (stays in same database)
- **Created date** (original timestamp)
- **Page URL** (same Notion link)
- **Other properties** (custom fields preserved)

---

## Troubleshooting

### "Could not extract page ID from input"
**Fix**: Make sure you copied the full URL or ID. Remove any extra spaces or characters.

### "Failed to extract content from current page"
**Fix**: 
- Ensure you're on a ServiceNow documentation page
- Wait for page to load completely
- Refresh and try again

### "ServiceNow-2-Notion app not initialized"
**Fix**: Reload the ServiceNow page and wait for the panel to appear.

### Success but validation still blank
**Fix**: 
- Check server logs for errors
- Ensure server has `SN2N_VALIDATE_OUTPUT=1` set
- May need to restart server

---

## Tips & Tricks

### Get Page ID from URL
Open the Notion page in your browser. The URL looks like:
```
https://www.notion.so/workspace/Page-Title-4ae48c878fb180d0a43bfb80d41bf20a
                                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                           This is the page ID (last 32 chars)
```

### Update Multiple Pages
For batch updates, see:
- **Batch script**: `patch/config/batch-patch-with-cooldown.sh`
- **Guide**: `docs/RETROACTIVE_VALIDATION_GUIDE.md`

### Find Pages Needing Updates
Check for saved placeholder files:
```bash
ls patch/pages/pages-to-update/*retroactive-scan*.html
```

Each file contains the Notion URL in the comments at the top.

---

## Performance

**Typical timing** per page:
- Extraction: 2-5 seconds
- Upload: 5-20 seconds
- Validation: 1-3 seconds
- **Total: 10-30 seconds**

**Best practices**:
- Update one page at a time
- Wait for success message before starting next
- Allow 30-60 seconds between updates

---

## Safety

### What Could Go Wrong?

**Almost nothing!** The PATCH operation is safe:

1. **Deletes all blocks** from the page (clears old content)
2. **Uploads fresh blocks** from ServiceNow (new content)
3. **Validates results** (checks for errors)
4. **Updates properties** (marks validation status)

**If something fails**:
- Original page ID preserved
- Error logged to console
- Alert message shows what happened
- Page can be retried immediately

### Can I Undo?

**Not built-in**, but Notion has version history:
1. Open the page in Notion
2. Click "•••" menu → "Page history"
3. Restore previous version if needed

---

## Documentation

- **Feature details**: `docs/UPDATE_EXISTING_PAGE_FEATURE_v11.0.29.md`
- **Quick start**: `docs/QUICK_START_UPDATE_EXISTING_PAGE.md`
- **Retroactive guide**: `docs/RETROACTIVE_VALIDATION_GUIDE.md`
- **Implementation**: `docs/UPDATE_EXISTING_PAGE_IMPLEMENTATION_SUMMARY.md`

---

## Need Help?

Check console logs for detailed debug output:
```javascript
// All operations logged with [UPDATE-EXISTING] prefix
[UPDATE-EXISTING] Starting manual page update...
[UPDATE-EXISTING] Extracted page ID: abc123...
[UPDATE-EXISTING] Extracting page data...
[UPDATE-EXISTING] Sending PATCH request...
✅ [UPDATE-EXISTING] Successfully updated page
```

---

**Version**: 11.0.29  
**Status**: Production ready  
**Last updated**: November 21, 2025
