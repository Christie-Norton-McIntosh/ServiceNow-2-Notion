# Inline Code AUDIT Comparison Fix - v11.0.183

## Issue
Notion inline code was being counted in AUDIT text length comparisons, but HTML inline code (`<code>` tags) were excluded. This caused mismatches where:
- HTML source: `<code>` tags removed → text length lower
- Notion blocks: inline code text included → text length higher
- Result: AUDIT coverage > 105%, showing as FAIL

## Root Cause
The `extractFromRichText()` function in `servicenow.cjs` extracted ALL rich_text content, including inline code elements with `annotations.code = true`.

HTML AUDIT logic (line 280) removes `<code>` tags:
```javascript
$audit('pre, code').remove(); // Code not counted in text validation
```

But Notion extraction included inline code:
```javascript
function extractFromRichText(richTextArray) {
  return richTextArray.map(rt => rt?.text?.content || '').join('');
  // ↑ Includes inline code!
}
```

## Solution
Filter out rich_text elements with `annotations.code = true` to match HTML AUDIT behavior.

### Code Change
**File**: `server/services/servicenow.cjs` (line 6138)

**Before**:
```javascript
function extractFromRichText(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray.map(rt => rt?.text?.content || '').join('');
}
```

**After**:
```javascript
function extractFromRichText(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  // FIX v11.0.183: Skip inline code (annotations.code = true) to match HTML AUDIT behavior
  // HTML AUDIT removes <code> tags, so Notion comparison should skip inline code too
  return richTextArray
    .filter(rt => !rt?.annotations?.code) // Skip inline code elements
    .map(rt => rt?.text?.content || '')
    .join('');
}
```

## Impact

### Before Fix:
HTML: `"Click the Save button"`
- `<code>` tags removed → "Click the  button" (13 chars)

Notion: `"Click the Save button"` (Save has annotations.code = true)
- All text extracted → "Click the Save button" (22 chars)
- Coverage: 22/13 = 169% ❌ FAIL

### After Fix:
HTML: `"Click the Save button"`
- `<code>` tags removed → "Click the  button" (13 chars)

Notion: `"Click the Save button"`
- Inline code filtered → "Click the  button" (13 chars)
- Coverage: 13/13 = 100% ✅ PASS

### Expected Results:
- **Reduced AUDIT failures**: Pages with inline code will show accurate coverage
- **Symmetrical comparison**: Both HTML and Notion exclude code from text length
- **95-105% coverage range**: Pages should pass validation more consistently

## Testing

### Test with Known Failing Page:
1. Find a page with inline code that shows AUDIT > 105%
2. Re-extract or PATCH the page
3. Check Audit property in Notion
4. Expected: Coverage should be within 95-105% range

### Example Pages to Test:
- `add-a-user-or-asset-to-a-contract` (has inline code: asset, financial_mgmt_user)
- Any page with technical documentation containing inline code snippets

## Related Fixes

This completes the inline code handling trilogy:

1. **v11.0.160**: Removed `<code>` tags from HTML AUDIT
   - Fixed: HTML source text length calculation
   
2. **v11.0.180**: Reverted inline code parentheses addition
   - Fixed: Removed extra `( )` characters around inline code
   
3. **v11.0.183**: Skip inline code in Notion AUDIT (this fix)
   - Fixed: Notion text length calculation now matches HTML

## Files Modified
- `server/services/servicenow.cjs` (line 6138-6144): Updated `extractFromRichText()` function

## Next Steps
1. Re-PATCH pages in `pages-to-update/` directory
2. Monitor AUDIT coverage percentages in logs
3. Verify pages with inline code now show 95-105% coverage
4. Check Audit property in Notion for validation status
