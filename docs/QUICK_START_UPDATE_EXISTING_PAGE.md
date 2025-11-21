# Quick Start: Update Existing Page Feature

**Version**: 11.0.29  
**Time to complete**: 30 seconds per page

## Visual Workflow

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. GET PAGE INFO                                           │
│  ━━━━━━━━━━━━━━━                                           │
│                                                             │
│  Open placeholder file:                                     │
│  patch/pages/pages-to-update/MID_Server_*.html             │
│                                                             │
│  Copy Notion URL:                                           │
│  https://www.notion.so/4ae48c878fb180d0a43bfb80d41bf20a   │
│                                                             │
│  Copy page title:                                           │
│  "MID Server"                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  2. FIND SOURCE PAGE                                        │
│  ━━━━━━━━━━━━━━━━━━                                        │
│                                                             │
│  Search ServiceNow docs for "MID Server"                    │
│  Navigate to: https://docs.servicenow.com/.../mid-server   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  3. CLICK UPDATE BUTTON                                     │
│  ━━━━━━━━━━━━━━━━━━━━━                                     │
│                                                             │
│  ┌──────────────────────────────────────┐                  │
│  │  📚 ServiceNow to Notion             │                  │
│  │                                      │                  │
│  │  Database: CMDB Pages                │                  │
│  │                                      │                  │
│  │  ┌────────────────────────────────┐ │                  │
│  │  │ 📄 Save Current Page           │ │                  │
│  │  └────────────────────────────────┘ │                  │
│  │  ┌────────────────────────────────┐ │                  │
│  │  │ 📖 Download PDF                │ │                  │
│  │  └────────────────────────────────┘ │                  │
│  │  ┌────────────────────────────────┐ │  ← CLICK THIS   │
│  │  │ 🔄 Update Existing Page        │ │                  │
│  │  └────────────────────────────────┘ │                  │
│  │                                      │                  │
│  └──────────────────────────────────────┘                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  4. PASTE NOTION URL                                        │
│  ━━━━━━━━━━━━━━━━━━                                        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🔄 Update Existing Notion Page                        │ │
│  │                                                       │ │
│  │ Paste the Notion page URL or ID:                     │ │
│  │ (e.g., https://notion.so/Page-Title-abc123...        │ │
│  │       or abc123def456...)                            │ │
│  │                                                       │ │
│  │ [https://www.notion.so/4ae48c878fb180d0a43bfb...]   │ │
│  │                                                       │ │
│  │              [Cancel]        [OK]                     │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  5. WATCH PROGRESS                                          │
│  ━━━━━━━━━━━━━━━━━                                         │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                                                       │ │
│  │         📝 Extracting current ServiceNow              │ │
│  │            page content...                            │ │
│  │                                                       │ │
│  │         [▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░] 50%                  │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│                          ↓                                  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                                                       │ │
│  │         📤 Updating Notion page:                      │ │
│  │            MID Server...                              │ │
│  │                                                       │ │
│  │         [▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓] 100%                  │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  6. SUCCESS!                                                │
│  ━━━━━━━━━                                                 │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ ✅ Page Updated Successfully!                         │ │
│  │                                                       │ │
│  │ Title: MID Server                                     │ │
│  │ Page ID: 4ae48c878fb180d0a43bfb80d41bf20a           │ │
│  │                                                       │ │
│  │ The Notion page has been updated with fresh content  │ │
│  │ from this ServiceNow page.                           │ │
│  │                                                       │ │
│  │                        [OK]                           │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## URL Format Examples

You can paste any of these formats:

| What You Have | What to Paste | Works? |
|---------------|---------------|--------|
| Full Notion URL | `https://www.notion.so/workspace/Page-Title-4ae48c87...` | ✅ Yes |
| Short URL | `https://notion.so/4ae48c87...` | ✅ Yes |
| Page ID with hyphens | `4ae48c87-8fb1-80d0-a43b-fb80d41bf20a` | ✅ Yes |
| Page ID without hyphens | `4ae48c878fb180d0a43bfb80d41bf20a` | ✅ Yes |
| Just the ID | `4ae48c878fb180d0a43bfb80d41bf20a` | ✅ Yes |

## Quick Command Reference

### List pages needing updates
```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion
ls -1 patch/pages/pages-to-update/*retroactive-scan*.html
```

### Get page URL from placeholder file
```bash
grep "Notion URL:" patch/pages/pages-to-update/MID_Server_*.html
```

### Get page title
```bash
grep "Page Title:" patch/pages/pages-to-update/MID_Server_*.html
```

### Move completed page
```bash
mv patch/pages/pages-to-update/MID_Server_*retroactive-scan*.html \
   patch/pages/updated-pages/
```

### Count remaining pages
```bash
ls -1 patch/pages/pages-to-update/*retroactive-scan*.html | wc -l
```

## Troubleshooting

### Error: "Could not extract page ID from input"
**Solution**: Make sure you copied the full URL or ID. Check for extra spaces.

### Error: "Failed to extract content from current page"
**Solution**: Make sure you're on the correct ServiceNow documentation page. Check that the page has loaded completely.

### Error: "ServiceNow-2-Notion app not initialized"
**Solution**: Reload the ServiceNow page. Wait for the userscript panel to appear.

### Success but validation still blank
**Solution**: Check server logs. Ensure `SN2N_VALIDATE_OUTPUT=1` is set. May need to restart server.

## Expected Results

After clicking "Update Existing Page":

1. **Extraction**: 2-5 seconds
2. **Upload**: 5-20 seconds (depending on content size)
3. **Validation**: 1-3 seconds
4. **Total**: ~10-30 seconds per page

**What Updates**:
- ✅ All page content (blocks deleted and re-uploaded)
- ✅ Validation property (populated with validation results)
- ✅ Stats property (updated with block counts)
- ✅ Source URL property (updated with current ServiceNow URL)
- ✅ Error checkbox (cleared if validation passes)

**What Stays the Same**:
- ✅ Page ID (same page, not a new one)
- ✅ Database location
- ✅ Created timestamp
- ✅ Page URL
- ✅ Custom properties (unless they failed before)

## Batch Processing Workflow

For all 16 pages (estimated 8-16 minutes total):

```bash
# 1. Get list of pages
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion
cat patch/pages/blank-validation-list.json | jq -r '.[] | "\(.title)|\(.notionUrl)"'

# 2. For each page:
#    - Copy Notion URL
#    - Search ServiceNow docs for title
#    - Navigate to ServiceNow page
#    - Click "🔄 Update Existing Page"
#    - Paste URL
#    - Wait for success
#    - Move to next page

# 3. After all complete, verify:
grep -c "Successfully updated page" logs/latest.log  # Should be 16
ls -1 patch/pages/pages-to-update/*retroactive-scan*.html | wc -l  # Should be 0

# 4. Clean up
mv patch/pages/pages-to-update/*retroactive-scan*.html patch/pages/updated-pages/
```

## Success Checklist

- [ ] Built v11.0.29 userscript
- [ ] Installed in Tampermonkey
- [ ] "🔄 Update Existing Page" button appears in panel
- [ ] Can paste Notion URLs
- [ ] Can paste page IDs
- [ ] Extraction works
- [ ] PATCH updates pages
- [ ] Validation properties populated
- [ ] 16 pages updated
- [ ] All placeholder files moved to `updated-pages/`

---

**Ready to go?** Navigate to your first ServiceNow page and click "🔄 Update Existing Page"!
