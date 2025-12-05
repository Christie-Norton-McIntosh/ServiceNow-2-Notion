# Quick Fix Guide for Failed Page Extractions

## 📍 Where to Find the Code

### 1. Table Extraction Issues
**File**: `server/services/servicenow.cjs`
**Function**: `extractTables()` (search for this function name)
**Problem**: Not capturing nested content inside `<td>` and `<caption>` elements

**Current behavior**:
- Only gets table structure (rows, columns)
- Misses text in nested `<span>`, `<p>`, `<b>` tags

**What to fix**:
- When processing table cells, recursively extract all text/content
- Handle multiple element types within cells (not just text nodes)

---

### 2. List Extraction Issues
**File**: `server/services/servicenow.cjs`
**Function**: `extractLists()` (search for this function name)
**Problem**: Not capturing nested lists and complex `<li>` content

**Current behavior**:
- Extracts flat lists
- Misses nested lists and formatted content

**What to fix**:
- Recursively process nested `<ul>` and `<ol>` within `<li>` elements
- Extract all content types from list items, not just text

---

### 3. Deep Nesting Issues
**File**: `server/services/servicenow.cjs`
**Function**: DOM traversal logic (look for depth/recursion limits)
**Problem**: Content at depth 10+ levels is truncated

**What to fix**:
- Remove or increase depth limits
- Enable strict DOM traversal: `SN2N_STRICT_ORDER=1`

---

## 🧪 Testing

After making fixes:

1. Copy a failed page HTML to a test directory
2. Extract it manually with your fix
3. Run AUDIT validation to check coverage improvement
4. Compare with diagnosis JSON to verify

---

## 📊 Verification

Check if fix worked:
- **Before fix**: Page shows coverage percentage in diagnosis file
- **After fix**: Re-extract page, check new coverage in server logs
- **Success**: Coverage goes from failing to ≥95%

---

## 🔗 Related Files

- Main extraction logic: `server/services/servicenow.cjs`
- Diagnosis reports: `patch/logs/audit-diagnosis-*.json`
- Failed pages: `patch/pages/pages-to-update/`
- Summary analysis: `patch/docs/DIAGNOSIS-SUMMARY-2025-12-04.md`
