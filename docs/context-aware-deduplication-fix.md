# Context-Aware Deduplication Fix (v11.0.4)

## Problem

Two validation failures revealed that our deduplication logic was too aggressive for procedural content:

### Issue 1: Image Deduplication in Procedural Steps
**File**: `add-a-document-to-a-contract-2025-11-10T18-11-12.html`
- **Expected**: 2 images (same icon appearing in 2 different procedural steps)
- **Actual**: 1 image (deduplication removed the duplicate URL)
- **Root Cause**: Both images used the same URL (`attachments-icon.png`) but appeared in different list item contexts with different alt text ("Manage Attachments icon." vs "Attachment icon")

### Issue 2: Table Deduplication in Procedural Steps
**File**: `create-a-software-maintenance-contract-example-2025-11-10T18-10-46.html`
- **Expected**: 3 tables (choice tables in 3 different procedural steps)
- **Actual**: 2 tables (deduplication removed duplicate table content)
- **Root Cause**: Tables had identical structure/content but appeared in different procedural contexts (steps 5, 7, and 9)

## Root Cause Analysis

The post-orchestration deduplication in `server/routes/w2n.cjs` was using `computeBlockKey()` to identify duplicates, which:
- Deduplicates images by URL (or file_upload.id)
- Deduplicates tables by structure and content

This works well for:
- Duplicate callouts (same note appearing multiple times)
- True duplicates (extraction errors)

But incorrectly removes:
- **Repeated icons/images in procedural steps** - The same icon legitimately appears in multiple steps to guide users
- **Repeated tables in procedural steps** - Tables with identical structure appear in multiple steps (e.g., form field tables for steps 5, 7, 9)

## Solution: Context-Aware Deduplication

**Don't deduplicate images or tables that are children of list items** (procedural steps).

### Implementation

Modified `server/routes/w2n.cjs` lines ~947-970:

```javascript
// CONTEXT-AWARE DEDUPLICATION:
// For list items (procedural steps), don't deduplicate images or tables
// These often legitimately repeat (e.g., same icon in multiple steps)
const isListItem = blockType === 'numbered_list_item' || blockType === 'bulleted_list_item';

for (const child of children) {
  // Skip deduplication for images and tables inside list items
  if (isListItem && (child.type === 'image' || child.type === 'table')) {
    log(`${indent}  ✓ Preserving ${child.type} in ${blockType} (procedural context)`);
    continue;
  }
  
  const key = dedupeUtil.computeBlockKey(child);
  if (seenKeys.has(key)) {
    duplicateIds.push(child.id);
  } else {
    seenKeys.set(key, child.id);
  }
}
```

### Key Principles

1. **Context Matters**: The parent block type determines whether deduplication is appropriate
2. **Procedural Content**: List items (numbered_list_item, bulleted_list_item) contain step-by-step instructions where repetition is intentional
3. **Preserve Visual Guidance**: Icons and images in procedures provide visual consistency across steps
4. **Preserve Tabular Data**: Tables in procedures often have identical structure but different semantic meaning (e.g., form fields for different steps)

## Deduplication Strategy

| Parent Type | Child Type | Deduplicate? | Reason |
|-------------|------------|--------------|---------|
| List Item | Image | ❌ No | Procedural context - icons repeat across steps |
| List Item | Table | ❌ No | Procedural context - tables repeat across steps |
| List Item | Callout | ✅ Yes | True duplicates should be removed |
| Callout | Image | ✅ Yes | Unlikely to have intentional duplicates |
| Toggle | Image | ✅ Yes | Unlikely to have intentional duplicates |
| Any | Callout | ✅ Yes | Adjacent duplicates (distance ≤ 1) |

## Testing Results

Both validation failures now pass:

```
============================================================
📊 SUMMARY
============================================================
Total files tested: 2
✅ Passed (removed): 2 (100.0%)
❌ Still failing: 0 (0.0%)

Fixed by this change: 2 pages (100.0%)
============================================================
```

### Validation Details

**File 1**: `add-a-document-to-a-contract`
- Before: ❌ Image count mismatch: expected 2, got 1
- After: ✅ No validation errors

**File 2**: `create-a-software-maintenance-contract-example`
- Before: ❌ Table count mismatch: expected 3, got 2
- After: ✅ No validation errors

## Technical Details

### Files Modified
- `server/routes/w2n.cjs` (lines ~947-970): Added context-aware skip logic for images/tables in list items

### Deduplication Flow
1. **Post-orchestration**: After deep nesting orchestration completes
2. **Recursive traversal**: Checks children of all container block types
3. **Context detection**: Identifies parent block type (list item vs other)
4. **Conditional deduplication**: Skips images/tables if parent is list item
5. **Logging**: Records preserved blocks for debugging

### Debug Logging
Use `[DEDUPE]` or similar prefix to filter deduplication logs:
```bash
SN2N_VERBOSE=1 npm start | grep "\[DEDUPE\]\|Preserving"
```

## Benefits

1. **Accurate Content Extraction**: Preserves all intentional repetition in procedural content
2. **User Experience**: Icons and tables guide users through multi-step procedures
3. **Validation Success**: 100% pass rate on previously failing pages
4. **Semantic Correctness**: Respects the authorial intent of repeated elements in different contexts

## Edge Cases

### When Images/Tables SHOULD Be Deduplicated
- **Outside list items**: Top-level duplicates are likely extraction errors
- **In callouts/toggles**: Duplicate images in these contexts are unlikely to be intentional

### When They Should NOT Be Deduplicated
- **Inside list items**: Procedural steps often repeat icons/tables intentionally
- **Different semantic contexts**: Same content in different procedural steps has different meaning

## Future Considerations

If we encounter validation failures where images/tables in list items ARE duplicates:
1. Add proximity detection (only preserve if distance > N steps)
2. Add semantic analysis (check if surrounding text differs)
3. Add user preferences (allow users to control deduplication behavior)

For now, the context-aware approach (preserving all images/tables in list items) achieves 100% validation success.
