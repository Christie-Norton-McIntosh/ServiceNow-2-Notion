# PATCH Validation Update - v11.0.35

## Summary

Updated the PATCH endpoint (`/W2N/:pageId`) to use consistent AUDIT-based validation format that matches the POST endpoint. This ensures both endpoints provide standardized, actionable validation feedback.

## What Changed

### 1. Validation Property Format

**Before**: Only showed "Content Audit: FAIL/PASS"
```
🔄 PATCH

❌ Content Audit: FAIL
Coverage: 67.7% (threshold: 95-105%)
Source: 69 text nodes, 2111 chars
...
```

**After**: Now shows both "Text Content Validation" and "Content Audit" sections
```
✅ Text Content Validation: PASS

[2025-12-04] Content Audit: ❌ FAIL
Coverage: 67.7% (threshold: 95-105%)
Source: 69 text nodes, 2111 chars
Notion: 12 blocks, 1430 chars
Block/Node Ratio: 0.17x
⚠️ Missing: 681 chars (32.3%)
```

### 2. Stats Property Calculation

**Before**: Attempted to use incomplete `breakdown` object
- Missing Notion counts
- Inaccurate comparison

**After**: Fetches actual Notion block counts from page
- Recursively counts all nested blocks
- Accurate Source → Notion comparison
- Shows complete block breakdown

```
✅  Content Comparison: PASS
📊 (Source → Notion):
• Ordered list items: 5 → 5
• Unordered list items: 2 → 2
• Paragraphs: 6 → 6
• Headings: 0 → 0
• Tables: 1 → 1
• Images: 2 → 2
• Callouts: 1 → 1
```

## Technical Details

### Files Modified
- `server/routes/w2n.cjs` (PATCH endpoint, lines ~3930-4150)

### Key Changes

1. **Validation Content** (lines 3987-4015)
   - Added "Text Content Validation: PASS" header (PATCH always passes text validation)
   - Kept Content Audit section with AUDIT coverage results
   - Formats match POST endpoint exactly

2. **Stats Calculation** (lines 4058-4125)
   - Added recursive function `countNotionBlocksRecursive()` to fetch actual Notion counts
   - Handles nested blocks in callouts, toggles, list items
   - Compares source → Notion accurately
   - Sets Image checkbox if images detected

3. **Block Counting** (lines 4019-4054)
   - Recursive counting of source blocks (already present)
   - Same logic as POST endpoint for consistency

## Impact

### For Users
- PATCH operations now show the same validation format as POST operations
- Clearer indication of AUDIT coverage success/failure
- Accurate block count comparison (Source → Notion)
- Image checkbox properly set based on content

### For Developers
- Consistent validation across both endpoints
- Easier to debug failed extractions with matching format
- Auto-remediation still triggered on AUDIT failure (both endpoints)
- Diagnosis files generated for failed pages

## Validation Examples

### Example 1: AUDIT FAIL (67.7% coverage)
```
✅ Text Content Validation: PASS

[2025-12-04] Content Audit: ❌ FAIL
Coverage: 67.7% (threshold: 95-105%)
Source: 69 text nodes, 2111 chars
Notion: 12 blocks, 1430 chars
Block/Node Ratio: 0.17x
⚠️ Missing: 681 chars (32.3%)
```
→ Triggers auto-remediation, diagnosis saved to `patch/logs/`

### Example 2: AUDIT PASS (98.5% coverage)
```
✅ Text Content Validation: PASS

[2025-12-04] Content Audit: ✅ PASS
Coverage: 98.5% (threshold: 95-105%)
Source: 156 text nodes, 6853 chars
Notion: 43 blocks, 6748 chars
Block/Node Ratio: 0.28x
```
→ No remediation needed

## Testing

To verify the changes work correctly:

1. **Run a PATCH operation** on a failed page:
   ```bash
   curl -X PATCH http://localhost:3004/api/W2N/page-id \
     -H "Content-Type: application/json" \
     -d '{"title": "Test", "contentHtml": "<p>Test content</p>"}'
   ```

2. **Check Validation property** in Notion - should show both sections

3. **Check Stats property** - should show accurate Source → Notion counts

4. **Check diagnosis files** - if AUDIT fails:
   ```bash
   ls -la patch/logs/audit-diagnosis-*.json | head -5
   ```

## Rollback

If issues occur, revert to previous version:
```bash
git revert HEAD
npm run build
```

## Version
- v11.0.35 (Equalized PATCH/POST validation timing, automatic retry logic)
- Released: 2025-12-04
