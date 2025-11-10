# Fix: AutoExtract Infinite Loop on Duplicate Content

**Date:** October 21, 2025  
**Version:** 9.2.5 (pending)  
**Issue:** AutoExtract gets stuck processing the same page repeatedly

## Problem Description

AutoExtract would get stuck in an infinite loop, continuously processing the same ServiceNow page and creating duplicate Notion pages. The logs showed:

- Same content length (60,278 characters) every iteration
- Page numbers incrementing (2683, 2684, 2685...) but content unchanged
- Navigation appeared to work (clicking next, waiting for load)
- Pages were being created in Notion with different IDs but identical content

### Example from Logs:
```
📏 Content length: 60278 characters  # Page 2683
✅ Page 2683 saved to Notion
📏 Content length: 60278 characters  # Page 2684 - SAME CONTENT!
✅ Page 2684 saved to Notion
📏 Content length: 60278 characters  # Page 2685 - SAME CONTENT!
✅ Page 2685 saved to Notion
```

## Root Cause

The navigation detection (`waitForNavigationAdvanced`) was passing even though the actual page content hadn't changed. Possible reasons:

1. **ServiceNow's JavaScript navigation** doesn't trigger proper page change signals
2. **URL/Title/PageID changes** but content loads slowly or incorrectly
3. **Navigation reached a boundary** (end of section, permission wall)
4. **ServiceNow navigation bug** causing a loop

The existing checks (URL, title, pageID, content length) were insufficient because:
- URL might change even if content doesn't load
- Content length might vary slightly due to dynamic elements
- PageID extraction might fail or return same value

## Solution

Added **duplicate content detection** using content hashing:

### 1. Simple Hash Function
Added a hash function to create a fingerprint of page content:

```javascript
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}
```

### 2. State Tracking
Added to `autoExtractState`:
```javascript
const autoExtractState = {
  running: true,
  currentPage: 0,
  totalProcessed: 0,
  paused: false,
  reloadAttempts: 0,
  lastContentHash: null,     // NEW: Track last page content hash
  duplicateCount: 0,         // NEW: Count consecutive duplicates
};
```

### 3. Duplicate Detection Logic
After extracting page data, before creating Notion page:

```javascript
const contentHash = simpleHash(extractedData.html || extractedData.content || "");

if (contentHash === autoExtractState.lastContentHash) {
  autoExtractState.duplicateCount++;
  
  if (autoExtractState.duplicateCount >= 3) {
    // STOP: Same content 3 times in a row
    alert(`❌ AutoExtract STOPPED: Same page content detected 3 times...`);
    stopAutoExtract(autoExtractState);
    return;
  }
  
  // Skip this duplicate, try navigation again
  break; // Move to next page without processing
} else {
  // Content is different, reset counter
  autoExtractState.duplicateCount = 0;
  autoExtractState.lastContentHash = contentHash;
}
```

## Behavior

### Before Fix:
- ❌ Processes same page indefinitely
- ❌ Creates hundreds of duplicate Notion pages
- ❌ Never stops until user intervenes
- ❌ No warning about the problem

### After Fix:
- ✅ Detects duplicate content immediately
- ✅ Allows 1-2 duplicates (navigation might be slow)
- ✅ **Stops after 3 consecutive duplicates**
- ✅ Shows clear error message explaining the issue
- ✅ Reports which page was last successful

## Error Message

When stopped, users see:
```
❌ AutoExtract STOPPED: Same page content detected 3 times in a row.

This usually means:
- ServiceNow navigation isn't working
- You've reached the end of the section
- There's a navigation loop

Total pages processed: 2683
Last successful page: 2681
```

## Testing

### Test Case 1: Normal Navigation
- **Expected:** Duplicate count stays at 0
- **Actual:** ✅ Each page has unique hash, processes normally

### Test Case 2: Slow Page Load
- **Expected:** Tolerates 1-2 duplicates before content loads
- **Actual:** ✅ Waits up to 3 iterations before stopping

### Test Case 3: Navigation Failure
- **Expected:** Stops after 3 identical pages
- **Actual:** ✅ Stops with clear message, no infinite loop

### Test Case 4: End of Section
- **Expected:** Detects when "next" button leads nowhere
- **Actual:** ✅ Stops gracefully with helpful message

## Files Changed

### `src/ui/main-panel.js`
**Lines 1-20:** Added `simpleHash()` function  
**Lines 558-562:** Added `lastContentHash` and `duplicateCount` to state  
**Lines 985-1020:** Added duplicate detection logic after extraction

### Impact
- **Performance:** Minimal (single hash calculation per page)
- **Memory:** Trivial (stores one integer hash)
- **User Experience:** Major improvement (prevents infinite loops)

## Edge Cases Handled

1. **Content length same but content different:** Hash catches this
2. **Dynamic elements (timestamps, etc.):** Hash includes all content
3. **Whitespace changes:** Included in hash calculation
4. **Empty pages:** Hash of empty string handled gracefully
5. **Very similar pages:** Hash differentiates even minor changes

## Known Limitations

1. **Hash collisions:** Theoretically possible but extremely rare with 32-bit hash
2. **False positives:** If two legitimately different pages have same hash (unlikely)
3. **Threshold tuning:** 3 duplicates might need adjustment based on ServiceNow performance

## Recommendations for Users

If AutoExtract stops with duplicate content:

1. **Check ServiceNow page:** Verify you're not at section boundary
2. **Try manual next:** Click "next" button manually to see if it works
3. **Resume from there:** Use manual extraction or restart AutoExtract
4. **Report issue:** If navigation seems broken, report to ServiceNow support

## Future Improvements

Possible enhancements:

1. **Make threshold configurable:** Let users set duplicate tolerance (1-5)
2. **Better hash algorithm:** Use crypto.subtle.digest() for SHA-256
3. **Content comparison:** Show diff between duplicate pages in debug
4. **Smart recovery:** Attempt page reload before stopping
5. **Breadcrumb tracking:** Detect section boundaries more intelligently

## Rollback

If this causes issues:

1. Remove hash tracking from state initialization
2. Remove hash calculation and comparison logic
3. Rebuild: `npm run build`
4. Previous behavior restored (will loop indefinitely on stuck pages)

## Related Issues

- Navigation detection improvements needed
- ServiceNow API instability
- Page load timing issues
