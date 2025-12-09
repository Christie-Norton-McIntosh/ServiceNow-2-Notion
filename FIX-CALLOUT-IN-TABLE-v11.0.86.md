# Fix: Exclude Callouts Inside Tables from Expected Count

## Problem
**User Report**: "callouts in tables are being counted again"

**Symptom**:
```
❌ Content Comparison: FAIL
📊 (Source → Notion):
• Callouts: 2 → 1
```

When HTML contains a callout inside a table cell and a callout outside:
- HTML count: 2 callouts (1 outside table, 1 inside)
- Notion count: 1 callout (inside-table callout becomes text in table cell)
- AUDIT Expected: 2 callouts (WRONG - didn't account for table constraint)
- **Result**: FAIL because 2 ≠ 1

## Root Cause
The `expectedCallouts` calculation in `server/routes/w2n.cjs` (lines 357-410) was detecting all callouts in the HTML (div.note, section.prereq, role="note") but only filtering out:
1. Nested callouts (callouts inside other callouts)

It was NOT filtering out:
2. **Callouts inside tables** ← This was the bug

## The Fix
Modified `server/routes/w2n.cjs` lines 376-425 to add a check for callouts inside tables:

```javascript
if (isDivNote || isPrereq || hasNoteRole) {
  // NEW: Skip callouts inside tables - they can't be rendered as callouts in Notion
  let isInTable = false;
  const parents = $el.parents().toArray();
  for (const parent of parents) {
    const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
    if (parentTag === 'table' || parentTag === 'thead' || parentTag === 'tbody' || 
        parentTag === 'tr' || parentTag === 'td' || parentTag === 'th') {
      isInTable = true;
      break;
    }
  }
  
  if (isInTable) {
    // Skip - this callout is inside a table and won't be converted to a callout block
    return;
  }
  
  // ... rest of nested callout check ...
}
```

## Why This Works
1. **Extraction Pipeline** (servicenow.cjs line 287): Removes callouts from tables because Notion table cells can't contain callout blocks
   - Callout inside table → becomes plain text or other block types
   - This is correct behavior

2. **AUDIT Validation** (servicenow.cjs line 287): Also removes callouts from tables when extracting HTML for text comparison
   - Both HTML and Notion must exclude table callouts

3. **Expected Callout Count** (w2n.cjs): Now also excludes table callouts
   - Before FIX: HTML count = 2, Notion count = 1 → MISMATCH ❌
   - After FIX: expectedCallouts = 1, Notion count = 1 → MATCH ✅

## Verification
Test with HTML containing:
- 1 Callout OUTSIDE table → should be counted ✅
- 1 Callout INSIDE table → should NOT be counted ✅

Results:
```
✅ Counted callout 1: <div class="note note_note...">
⏭️  Skipping callout in <div> (inside table)
📊 Total expected callouts: 1 (CORRECT!)
```

## Related Code
- **Extraction pipeline**: `server/services/servicenow.cjs` lines 287-289
  - Removes callouts in tables: `$audit('table div.note, ...')`
  
- **Diff extraction**: `server/services/servicenow.cjs` lines 6487
  - Removes callouts in tables: `$html('table div.note, ...')`
  
- **Expected count calculation**: `server/routes/w2n.cjs` lines 376-425
  - NOW FIXED: Excludes table callouts from count

## Impact
- ✅ Fixes AUDIT failures for pages with callouts in tables
- ✅ Correct expected callout count matches Notion output
- ✅ No impact on other callouts (outside tables still counted)
- ✅ Consistent with extraction pipeline behavior
