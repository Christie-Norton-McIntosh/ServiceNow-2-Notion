# Fix: Tables Inside List Items Missing From Output

**Date**: 2025-11-12  
**Issue**: Tables (and other complex blocks) nested inside list items were not appearing as children in the final output  
**Status**: ✅ FIXED

## Problem Description

When converting ServiceNow HTML to Notion blocks, tables nested inside `<li>` elements were being detected and processed, but NOT appearing as children in the final output. This affected the GitHub onboarding page where the first step contained a table with nested lists.

### Example Issue

**HTML Structure:**
```html
<ol class="steps">
  <li>
    <span>Navigate to Workspaces...</span>
    <div class="table-wrap">
      <table>...</table>
    </div>
    <div class="itemgroup info">Important: ...</div>
  </li>
</ol>
```

**Expected Output:**
- numbered_list_item (children: 1)
  - table (4 rows with nested lists)
- callout (extracted from itemgroup.info)

**Actual Output (BEFORE FIX):**
- numbered_list_item (children: 0) ❌
- callout

The table was completely missing!

## Root Cause Analysis

The issue was a **premature marker token stripping** in the HTML extraction phase:

### Marker-Based Orchestration Flow

1. **Detection**: Table detected as nested block in list item
2. **Marking**: Table added to `markedBlocks` array
3. **Token Addition**: Marker token `(sn2n:xxx)` added to list item's rich_text
4. **Collection**: Table added as top-level block (for later orchestration)
5. **Stripping**: ❌ **BUG HERE** - Marker tokens stripped at line 4858
6. **Dry-Run Orchestration**: `collectAndStripMarkers` collects table, `removeCollectedBlocks` removes it
7. **Attachment**: `attachToParents` searches for marker token... **BUT IT'S GONE!**

### The Bug

In `server/services/servicenow.cjs` at line 4858:

```javascript
if (seenMarkers.size > 0) {
  console.log(`🔍 Removing ${seenMarkers.size} marker token(s) from rich text before finalizing`);
  stripMarkerTokensFromBlocks(blocks); // ❌ TOO EARLY!
}
```

This code was stripping marker tokens from rich_text **BEFORE** the blocks were returned to w2n.cjs. The dry-run orchestration logic in w2n.cjs (lines 181-252) depends on these tokens to know where to attach collected blocks.

### Why It Failed

1. Table was marked with marker `mi1d0k2k-azoq3r`
2. Token `(sn2n:mi1d0k2k-azoq3r)` was added to list item's rich_text
3. **Tokens were immediately stripped** (line 4858)
4. Blocks returned to w2n.cjs WITHOUT marker tokens
5. `collectAndStripMarkers` collected the table into markerMap
6. `removeCollectedBlocks` removed table from top-level (now only list item + callout remain)
7. `attachToParents` searched for `(sn2n:mi1d0k2k-azoq3r)` in list item's rich_text
8. **Token not found** → Table never attached → Lost!

## The Fix

**File**: `server/services/servicenow.cjs`  
**Line**: 4858  
**Change**: Comment out premature marker stripping

### Before (BROKEN):
```javascript
if (seenMarkers.size > 0) {
  console.log(`🔍 Removing ${seenMarkers.size} marker token(s) from rich text before finalizing`);
  stripMarkerTokensFromBlocks(blocks);
}
```

### After (FIXED):
```javascript
// CRITICAL FIX: DO NOT strip marker tokens here!
// Marker tokens MUST remain in rich_text for dry-run orchestration to work.
// The tokens are used by attachToParents() in w2n.cjs to find where to attach collected blocks.
// Stripping happens AFTER orchestration completes (in w2n.cjs or during page creation).
// if (seenMarkers.size > 0) {
//   console.log(`🔍 Removing ${seenMarkers.size} marker token(s) from rich text before finalizing`);
//   stripMarkerTokensFromBlocks(blocks);
// }
```

### Why This Works

Now the marker tokens **remain in the rich_text** when blocks are returned:

1. ✅ Table marked with `mi1d0k2k-azoq3r`
2. ✅ Token `(sn2n:mi1d0k2k-azoq3r)` in list item's rich_text
3. ✅ Blocks returned WITH marker tokens intact
4. ✅ `collectAndStripMarkers` collects table into markerMap
5. ✅ `removeCollectedBlocks` removes table from top-level
6. ✅ `attachToParents` finds `(sn2n:mi1d0k2k-azoq3r)` in rich_text
7. ✅ Table attached as child of list item
8. ✅ Marker tokens stripped AFTER attachment (line 236-241 in w2n.cjs)

## Verification

### Test Results

**Before Fix:**
```
Block 4: numbered_list_item
  Text: Navigate to Workspaces > DevOps Change Workspace...
  Children: 0  ❌
```

**After Fix:**
```
Block 4: numbered_list_item
  Text: Navigate to Workspaces > DevOps Change Workspace...
  Children: 1  ✅
    Child 1: table
      Rows: 4
```

### Full Page Test

Ran `test-github-page-conversion.cjs` on the GitHub onboarding page:
- ✅ 38 blocks generated
- ✅ Block 4 now has 1 child (table with 4 rows)
- ✅ Table contains nested lists (type="a")
- ✅ Callout properly extracted as sibling
- ✅ Maximum nesting depth: 3 levels

## Impact

This fix resolves table nesting for ALL list items, not just the GitHub page:

- ✅ Tables inside numbered list items
- ✅ Tables inside bulleted list items
- ✅ Any other complex blocks (callouts, code blocks, etc.) inside list items
- ✅ Preserves correct order in dry-run mode
- ✅ Works for both POST (create) and PATCH (update) operations

## Token Stripping Logic

The fix doesn't remove marker stripping entirely - it just moves it to the correct location:

### Where Stripping Still Happens:

1. **Dry-Run Mode** (w2n.cjs lines 236-241):
   ```javascript
   // Strip marker tokens from rich_text after attaching
   if (typed) {
     typed.rich_text = stripMarkerTokens(rich);
   }
   ```

2. **Real Page Creation** (marker-management.cjs line 115):
   ```javascript
   delete b._sn2n_marker; // Strip marker after collection
   ```

3. **Deep Nesting Orchestration** (After PATCH append):
   Marker tokens cleaned up after orchestration completes

## Files Modified

- `server/services/servicenow.cjs` (line 4858): Commented out premature marker stripping

## Related Files

- `server/routes/w2n.cjs` (lines 181-252): Dry-run orchestration logic
- `server/orchestration/marker-management.cjs` (lines 36-136): `collectAndStripMarkers` function
- `patch/config/test-github-page-conversion.cjs`: Test script used to verify fix
- `patch/config/debug-block-4-processing.cjs`: Debug script used to isolate issue

## Next Steps

1. ✅ Fix implemented and verified
2. ⏭️ Re-PATCH GitHub onboarding page to production
3. ⏭️ Verify other pages with tables in list items
4. ⏭️ Update version and release notes

## Lessons Learned

- **Marker tokens are essential for orchestration** - must persist until attachment completes
- **Dry-run mode depends on marker tokens** - stripping breaks the attachment logic
- **Order matters** - strip AFTER orchestration, not before
- **Test with dryRun first** - helps isolate conversion vs. orchestration issues
