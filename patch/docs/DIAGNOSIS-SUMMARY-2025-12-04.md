# Failed Pages Diagnosis Summary
**Generated**: 2025-12-04  
**Status**: 6 pages analyzed with auto-remediation diagnoses  
**Average Coverage**: 63.7% (FAIL - threshold is 95%)

---

## 📊 Quick Overview

| Page | Coverage | Gap | Status | Priority |
|------|----------|-----|--------|----------|
| Predictive Intelligence for Incident Management | 41.4% | 58.6% | 🔴 CRITICAL | P0 |
| Request PI for Major Incident Management | 67.7% | 32.3% | 🟠 HIGH | P1 |
| IT Service Management | 64.5% | 35.5% | 🟠 HIGH | P1 |
| Request PI for Incident Management | 64.1% | 35.9% | 🟠 HIGH | P1 |
| Machine Learning Solutions for ITSM | 71.9% | 28.1% | 🟡 MEDIUM | P2 |
| Script includes and customization | 72.5% | 27.5% | 🟡 MEDIUM | P2 |

---

## 🔍 Root Cause Analysis

### Issue #1: Missing Table Content (HIGH Priority - 83% of pages affected)
**Severity**: HIGH | **Impact**: +5-15% coverage per fix | **Frequency**: 5/6 pages

**Problem**: Tables in ServiceNow documentation contain complex nested structures with multiple `<tr>`, `<td>` elements. The `extractTables()` function is not capturing all cell content, especially when:
- Tables have `<caption>` elements
- Cells contain inline `<span>` or `<p>` tags
- Multiple tables are nested in the same section
- Table cells contain formatted text with nested elements

**Example**: "Predictive Intelligence" page has 18 instances of missing table content (Solution Definition tables are not fully extracted)

**Fix Code Location**: `server/services/servicenow.cjs` - `extractTables()` function

**Recommended Fix**:
```javascript
// Current: Only extracts basic cell structure
// Needed: Recursively extract all content from nested elements in cells
// Add: Support for inline elements (<span>, <b>, <em>, <a>) within table cells
```

---

### Issue #2: Missing List Items (HIGH Priority - 67% of pages affected)
**Severity**: HIGH | **Impact**: +5-15% coverage per fix | **Frequency**: 4/6 pages

**Problem**: Lists (`<ul>`, `<ol>`) with nested structure or complex content are not being fully extracted:
- Nested lists (lists within lists) are skipped
- List items with child elements (`<p>`, `<span>`) are incomplete
- Mixed bullet and numbered lists in same section

**Example**: "Request PI for Incident Management" has 11 instances of missing list items like "Incident Assignment"

**Fix Code Location**: `server/services/servicenow.cjs` - `extractLists()` function

**Recommended Fix**:
```javascript
// Current: Extracts flat list structure
// Needed: Recursive extraction of nested lists
// Add: Support for list items containing complex content (paragraphs, tables)
```

---

### Issue #3: Deep Nesting (MEDIUM Priority - 50% of pages affected)
**Severity**: MEDIUM | **Impact**: +2-5% coverage per fix | **Frequency**: 3/6 pages

**Problem**: HTML elements nested 10+ levels deep are being lost:
- Complex nesting in `<article>` > `<main>` > `<div>` > `<section>` chains
- Content buried in deeply nested wrapper elements
- Text nodes at depth 15-17 levels are truncated

**Example**: "Predictive Intelligence" page has 178 instances of deep nesting issues

**Fix Code Location**: `server/services/servicenow.cjs` - DOM traversal logic

**Recommended Fix**:
```bash
# Enable strict order traversal to preserve deeply nested content
SN2N_STRICT_ORDER=1
```

---

## 📋 Actionable Recommendations

### Priority 1 (Fix First - impacts 83% of pages):
**Fix missing table extraction** (+5-15% coverage each)

1. Review `server/services/servicenow.cjs` `extractTables()` function
2. Add recursive extraction of cell content
3. Handle nested elements within `<td>` tags
4. Test on "Predictive Intelligence" page (41.4% → ~56-71%)

### Priority 2 (Fix Second - impacts 67% of pages):
**Fix missing list extraction** (+5-15% coverage each)

1. Review `server/services/servicenow.cjs` `extractLists()` function
2. Add recursive extraction for nested lists
3. Handle complex content within `<li>` tags
4. Test on "Request PI for Incident Management" page (64.1% → ~79-94%)

### Priority 3 (Fix Third - impacts 50% of pages):
**Improve deep nesting handling** (+2-5% coverage each)

1. Enable `SN2N_STRICT_ORDER=1` environment variable
2. Review DOM traversal depth limits
3. Test on pages with complex nesting patterns

---

## 🎯 Expected Outcomes

If all three issues are fixed:
- **Worst Case**: Predictive Intelligence: 41.4% → ~60-65% (still needs work)
- **Best Case**: All pages → ~85-100% coverage

**Combined Impact**:
- Missing tables fix: +5-15% × 5 pages = +25-75 percentage points
- Missing lists fix: +5-15% × 4 pages = +20-60 percentage points
- Deep nesting fix: +2-5% × 3 pages = +6-15 percentage points

---

## 📂 Diagnosis Files Location

Detailed JSON reports for each page:
```
patch/logs/audit-diagnosis-*.json
```

Each file contains:
- Complete source HTML analysis
- Element type breakdown
- Complex nesting hierarchy
- List of gaps with severity
- Specific code locations to investigate

---

## ⚠️ Important Notes

1. **Auto-remediation is now working** - Diagnosis files are being generated automatically when pages fail AUDIT validation
2. **No automatic fixes applied** - Diagnoses are for developer review; code changes must be manual
3. **Fix one issue at a time** - Test each fix before moving to the next
4. **Re-test after fixes** - Re-run extractions on these 6 pages to verify improvements

---

## 🔧 Next Steps

1. ✅ Read the diagnosis JSON files for detailed analysis
2. ⏳ Review `server/services/servicenow.cjs` for extraction logic
3. ⏳ Implement fixes for table and list extraction
4. ⏳ Re-run failed page extractions
5. ⏳ Verify coverage improves to 95%+
6. ⏳ Move successful pages from `pages-to-update/` to `updated-pages/`

---

**Generated by**: Auto-remediation diagnostic system (v11.0.113)  
**Fixed bugs**: Auto-remediation variable scope error fixed (html parameter now passed correctly)
