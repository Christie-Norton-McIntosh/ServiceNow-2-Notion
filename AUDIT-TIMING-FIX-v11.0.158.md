# AUDIT Timing Fix - Menu Cascade Preprocessing (v11.0.158)

## Issue
AUDIT validation was showing false positives with menu cascade content appearing as "missing":

```
⚠️ Missing segments (6):
   1. "__TECH_PLACEHOLDER_0__ div > div > div"
   2. "Self Service" [span.ph.uicontrol]
   3. ">" [abbr]
   4. "System Definition" [span.ph.uicontrol]
```

The menu cascades were being preprocessed to plain text (e.g., "Self Service > System Definition"), but the AUDIT was comparing against the **original HTML structure** with separate `<span>` and `<abbr>` tags.

## Root Cause
**Processing Order Mismatch**:

1. **Line 321**: `sourceAudit = auditTextNodes(html)` - AUDIT ran on **original HTML** with `<span class="menucascade">` structure
2. **Line 406**: `html = preprocessMenuCascades(html)` - Menu cascades converted to plain text **AFTER AUDIT**
3. **Line 450+**: Blocks created from **preprocessed HTML** (plain text cascades)
4. **Validation**: Compared AUDIT (original structure) vs Notion blocks (preprocessed text) → **FALSE MISMATCH**

**Example of the mismatch**:
```html
<!-- AUDIT saw this (original HTML): -->
<span class="menucascade">
  <span class="ph uicontrol">Self Service</span>
  <abbr title="and then"> &gt; </abbr>
  <span class="ph uicontrol">System Definition</span>
</span>

<!-- But blocks contained this (preprocessed): -->
"Self Service > System Definition"
```

AUDIT counted 3 text nodes ("Self Service", ">", "System Definition"), but the final Notion block had 1 text node with the combined string. This caused AUDIT to report the components as "missing".

## Solution
**Move menu cascade preprocessing BEFORE AUDIT** so both use the same HTML version:

### Changes Made

**File**: `server/services/servicenow.cjs`

**Before (v11.0.157)**:
```javascript
// Line 287-328: AUDIT runs on original HTML
let sourceAudit = null;
if (enableAudit) {
  sourceAudit = auditTextNodes(filteredHtml);  // ← ORIGINAL HTML
}

// Line 406-417: THEN preprocess menu cascades
try {
  const menuCascadePreprocessed = preprocessMenuCascades(html);
  if (menuCascadePreprocessed !== html) {
    html = menuCascadePreprocessed;  // ← PREPROCESSED HTML
  }
}
```

**After (v11.0.158)**:
```javascript
// Line 283-295: FIRST preprocess menu cascades
console.log(`🔧 [MENU-CASCADE] Preprocessing menu cascades before AUDIT...`);
try {
  const menuCascadePreprocessed = preprocessMenuCascades(html);
  if (menuCascadePreprocessed !== html) {
    const cascadeCount = (html.match(/<span[^>]*class="[^"]*menucascade[^"]*"/g) || []).length;
    console.log(`✅ [MENU-CASCADE] Preprocessed ${cascadeCount} menu cascades before AUDIT`);
    html = menuCascadePreprocessed;  // ← PREPROCESSED HTML
  }
}

// Line 303-344: THEN run AUDIT on preprocessed HTML
let sourceAudit = null;
if (enableAudit) {
  sourceAudit = auditTextNodes(filteredHtml);  // ← PREPROCESSED HTML
}

// Line 420-424: Note about moved preprocessing
// NOTE: Menu cascade preprocessing moved earlier (before AUDIT) in v11.0.158
// This ensures both AUDIT and extraction use the same preprocessed HTML
```

### Processing Order (After Fix)

1. **Line 283**: Preprocess menu cascades → Plain text
2. **Line 303**: Run AUDIT on **preprocessed HTML**
3. **Line 450+**: Create blocks from **same preprocessed HTML**
4. **Validation**: Both AUDIT and blocks use identical text → **NO MISMATCH** ✅

## Impact

### Fixed
- ✅ AUDIT no longer reports menu cascade components as "missing"
- ✅ MissingText property won't show `__TECH_PLACEHOLDER_0__` or menu separators
- ✅ Validation coverage accurate for pages with menu cascades
- ✅ Both AUDIT and extraction use identical HTML preprocessing

### Example Result (After Fix)
```
AUDIT Source: "Self Service > System Definition"  (1 text node)
Notion Block: "Self Service > System Definition"  (1 text node)
Result: ✅ MATCH (no missing segments)
```

## Testing Recommendations

1. **Extract page with menu cascades**:
   - Test with "Script includes and customization" page
   - Should see preprocessing logs:
     ```
     🔧 [MENU-CASCADE] Preprocessing menu cascades before AUDIT...
     ✅ [MENU-CASCADE] Preprocessed 2 menu cascades before AUDIT
     ```

2. **Check AUDIT results**:
   - MissingText property should NOT contain:
     - `__TECH_PLACEHOLDER_0__`
     - Individual menu cascade components (`"Self Service"`, `">"`, etc.)
   - Coverage should be ~100% for menu cascade pages

3. **Verify processing order**:
   - Server logs should show:
     1. Menu cascade preprocessing message
     2. AUDIT start message
     3. Block extraction
   - No duplicate preprocessing messages

## Related Issues

### v11.0.117 (Original Menu Cascade Fix)
- Added `preprocessMenuCascades()` function
- Fixed semantic mismatch (structure → plain text)
- BUT: Preprocessing happened AFTER AUDIT

### v11.0.158 (This Fix)
- Moved preprocessing BEFORE AUDIT
- Fixed AUDIT false positives
- Ensures both AUDIT and blocks use same HTML

## Version History
- **v11.0.117**: Menu cascade preprocessing added (after AUDIT)
- **v11.0.158**: Menu cascade preprocessing moved before AUDIT (this fix)

## Files Changed
- `server/services/servicenow.cjs`:
  - Lines 283-295: Added preprocessing before AUDIT
  - Lines 420-424: Removed duplicate preprocessing, added note
  - Net result: Same preprocessing, better timing

## Notes
- This is a **timing fix only** - no changes to preprocessing logic
- The `preprocessMenuCascades()` function works identically
- Only the **execution order** changed (before AUDIT instead of after)
- Fixes false positive validation failures for menu cascade content
- Critical for accurate AUDIT coverage metrics
