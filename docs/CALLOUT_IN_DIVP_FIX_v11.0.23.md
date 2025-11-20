# Fix: Missing Callouts in List Items (v11.0.23)

**Date**: 2025-11-19  
**Issue**: Callouts inside `div.p` elements within list items were not being extracted  
**Status**: ✅ FIXED

## Problem Description

Two pages were failing validation due to missing callouts:
- `cloud-vs-non-cloud-resources`: Expected 1 callout, got 0
- `home-view-in-cmdb-workspace`: Expected 2 callouts, got 1

### Root Cause

Callouts were nested inside `div.p` elements within list items:

```html
<ul>
  <li>
    <div class="p">
      Text content...
      <ul>...</ul>  <!-- Nested list -->
      <div class="note note note_note">  <!-- Callout here -->
        <span class="note__title">Note:</span>
        Callout content...
      </div>
    </div>
  </li>
</ul>
```

The existing code searched for immediate block children of `<li>` elements, including `> div.p`, but **did not search inside `div.p`** for nested callouts. The code explicitly excluded `div.p` from wrapper searches because `div.p` was already being handled as an immediate block.

However, when `div.p` contains **mixed content** (text + lists + callouts), the callouts inside it were not being extracted.

## Solution

Added explicit search inside `div.p` elements for nested callouts:

```javascript
// FIX v11.0.23: Search inside div.p for nested callouts
// div.p often contains mixed content (text + lists + callouts)
// The callouts inside div.p need to be extracted as nested blocks
$li.find('> div.p').each((i, divP) => {
  const innerCallouts = $(divP).find('> div.note').toArray();
  if (innerCallouts.length > 0) {
    innerCallouts.forEach(callout => {
      if (!nestedBlocks.includes(callout)) {
        nestedBlocks.push(callout);
      }
    });
  }
});
```

**Location**: `server/services/servicenow.cjs`, line ~2026

## Testing

Tested both failing pages with dry-run extractions:

### cloud-vs-non-cloud-resources
```bash
# Before fix: 0 callouts
# After fix: 1 callout ✅
```

### home-view-in-cmdb-workspace
```bash
# Before fix: 1 callout (missing 1)
# After fix: 2 callouts ✅
```

## Callout Structure in Notion

**Important**: Callouts are correctly nested as **children** of the list item, not as top-level blocks:

```json
{
  "type": "bulleted_list_item",
  "bulleted_list_item": {
    "rich_text": [...],
    "children": [
      {
        "type": "bulleted_list_item",  // Nested list items
        ...
      },
      {
        "type": "callout",  // Callout as child
        "callout": {
          "rich_text": [...],
          "icon": {"type": "emoji", "emoji": "ℹ️"},
          "color": "blue_background"
        }
      }
    ]
  }
}
```

This matches Notion's block hierarchy where list items can have nested blocks as children.

## Files Modified

- `server/services/servicenow.cjs`: Added div.p callout search logic

## Commits

- `81142ac`: Fix: Search inside div.p for nested callouts in list items (v11.0.23)
- `3e321f8`: Version bump to v11.0.23

## Next Steps

1. **Re-extract failing pages**:
   - cloud-vs-non-cloud-resources-2025-11-19T04-52-31.html
   - home-view-in-cmdb-workspace-2025-11-19T04-52-25.html

2. **Validate POST/PATCH with new extraction**:
   - Verify callouts appear correctly in Notion
   - Verify validation passes (callout count matches expected)

3. **Test marker leak fixes (v11.0.23 POST sweep)**:
   - Re-POST the 4 marker leak pages
   - Verify no marker tokens remain
   - Verify block counts normalize

## Related Issues

- **v11.0.23 Marker Leak Fix**: POST now always sweeps markers with 1s delay
- **v11.0.22 zDocsSideBoxes Fix**: Selective removal of navigation chrome

## Documentation

- Added `docs/CALLOUT_IN_DIVP_FIX_v11.0.23.md` (this file)
- See also: `docs/MARKER_LEAK_FIX_v11.0.23.md`
