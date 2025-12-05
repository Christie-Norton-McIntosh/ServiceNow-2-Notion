# How to Read a Diagnosis JSON File

## Overview
Each failed page gets an auto-generated diagnosis JSON file that reveals **why** content is missing and **what** to fix.

Location: `patch/logs/audit-diagnosis-[PAGE-ID]-[TIMESTAMP].json`

---

## File Structure

### 1. Basic Info (Top Level)
```json
{
  "timestamp": "2025-12-04T22:14:43.921Z",
  "pageTitle": "Predictive Intelligence for Incident Management",
  "coverage": 41.4,
  "passed": false,
  ...
}
```

- `timestamp`: When the diagnosis was created
- `pageTitle`: Name of the page that failed
- `coverage`: Percentage of source content captured (41.4% = 58.6% missing!)
- `passed`: false = page failed AUDIT validation

---

### 2. Source Analysis
Shows what was in the original HTML file:

```json
"sourceAnalysis": {
  "totalElements": 186,
  "elementTypes": {
    "div": 18,
    "table": 3,
    "li": 11,
    "p": 10,
    "span": 31,
    ...
  },
  "totalTextNodes": 167,
  "totalChars": 101252,
  "complexNesting": [...]
}
```

**What it tells you**:
- `totalElements`: 186 = lots of HTML structure
- `elementTypes`: Breakdown of what's in the source
- `totalChars`: 101,252 characters of text in source
- `complexNesting`: List of deeply nested elements (depth 6+)

---

### 3. Gaps (Problems Found)

The most important section - lists **what's missing**:

```json
"gaps": [
  {
    "type": "missing_table_content",
    "count": 18,
    "preview": "Solution DefinitionSolution TypeDescription",
    "severity": "high",
    "fixCode": "Check extractTables() in servicenow.cjs"
  },
  {
    "type": "missing_list_items",
    "count": 11,
    "preview": "Incident Assignment",
    "severity": "high",
    "fixCode": "Check extractLists() in servicenow.cjs"
  },
  ...
]
```

**How to read**:
- `type`: Category of missing content (e.g., `missing_table_content`, `missing_list_items`)
- `count`: How many instances are missing
- `preview`: Sample of what's missing (first 50 chars)
- `severity`: HIGH/MEDIUM/LOW priority to fix
- `fixCode`: Which function to look at in the code

---

### 4. Recommendations (Action Items)

Prioritized list of fixes:

```json
"recommendations": [
  {
    "priority": "HIGH",
    "action": "Fix missing missing_table_content",
    "reason": "18 instances of missing_table_content not extracted",
    "affectedContent": "Solution DefinitionSolution TypeDescription",
    "fixCode": "Check extractTables() in servicenow.cjs",
    "coverage_impact": "+5-15%"
  },
  {
    "priority": "HIGH",
    "action": "Fix missing missing_list_items",
    "reason": "11 instances of missing_list_items not extracted",
    "affectedContent": "Incident Assignment",
    "fixCode": "Check extractLists() in servicenow.cjs",
    "coverage_impact": "+5-15%"
  },
  {
    "priority": "MEDIUM",
    "action": "Improve deep_nesting",
    "reason": "178 instances detected",
    "affectedContent": "Use your instance records to b",
    "fixCode": "Use SN2N_STRICT_ORDER=1 for strict DOM traversal",
    "coverage_impact": "+2-5%"
  }
]
```

**How to prioritize**:
1. Fix HIGH priority items first (biggest impact)
2. Then fix MEDIUM priority items
3. Re-test after each fix
4. Check `coverage_impact` to estimate how much coverage will improve

---

## 🎯 Quick Workflow

### Step 1: Read the File
```bash
jq '.gaps | .[] | .type' patch/logs/audit-diagnosis-*.json
```
Shows: `missing_table_content`, `missing_list_items`, `deep_nesting`

### Step 2: Find the Root Cause
```bash
jq '.recommendations[] | select(.priority == "HIGH")' patch/logs/audit-diagnosis-*.json
```
Shows: HIGH priority fixes to apply

### Step 3: Locate the Code
Go to `server/services/servicenow.cjs` and search for the `fixCode` (e.g., `extractTables`)

### Step 4: Make the Fix
Update the function to handle the missing content type

### Step 5: Re-test
Re-extract the page and check if coverage improves

---

## 📊 Example: Interpreting "Predictive Intelligence" Diagnosis

**Coverage**: 41.4% (missing 58.6%)

**Gaps found**:
1. **Missing table content**: 18 instances = tables not fully extracted
2. **Missing list items**: 11 instances = lists incomplete
3. **Deep nesting**: 178 instances = deeply nested content lost

**If you fix all three**:
- Tables fix: +5-15% coverage
- Lists fix: +5-15% coverage  
- Nesting fix: +2-5% coverage
- **Total potential**: 41.4% → 53-50% to 76%+ ✅

**Priority order**:
1. Fix tables (affects most pages)
2. Fix lists (quick win)
3. Fix nesting (improves edge cases)

---

## 🔗 Related Resources

- **Extracted blocks**: View `extractedBlocks` section in JSON for what WAS captured
- **Source analysis**: Look at `sourceAnalysis.complexNesting` to understand DOM depth
- **Failed page HTML**: Find matching file in `patch/pages/pages-to-update/`
- **Page stats**: See `extractedBlocks` count vs expected source content
