# AUDIT Auto-Remediation System

**Version:** 11.0.113  
**Status:** ✅ Automatic Diagnosis & Fix Suggestions  
**Enabled:** When `SN2N_AUDIT_CONTENT=1` and AUDIT validation fails (coverage <95% or >105%)

## Overview

The Auto-Remediation System automatically diagnoses AUDIT validation failures and provides actionable recommendations to fix them. When a page extraction fails AUDIT validation, the system:

1. **Analyzes** the source HTML structure
2. **Compares** with extracted Notion blocks
3. **Identifies** content gaps or duplicates
4. **Generates** prioritized fix recommendations
5. **Saves** diagnosis to file for manual review or auto-application

## Architecture

### Components

**File:** `server/utils/audit-auto-remediate.cjs`

```
diagnoseAndFixAudit()
├── analyzeSourceHTML()           [Scan HTML structure]
├── analyzeExtractedBlocks()      [Scan extracted blocks]
├── findContentGaps()             [Identify missing content]
├── findDuplicates()              [Identify duplicates]
├── generateRecommendations()     [Create fix suggestions]
└── saveDiagnosisToFile()         [Persist findings]
```

### Integration Points

**File:** `server/routes/w2n.cjs`

- **Line 42:** Import remediation module
- **Line 2604-2628:** POST endpoint - trigger on AUDIT fail
- **Line 3934-3956:** PATCH endpoint - trigger on AUDIT fail

## How It Works

### Detection

AUDIT fails when:
- **Coverage < 95%** → Missing content (incomplete extraction)
- **Coverage > 105%** → Extra content (duplicates or over-extraction)
- **Marker leaks** → Unresolved deep nesting markers remain

### Automatic Workflow

```
Page Extraction
    ↓
AUDIT Validation
    ↓
    ├─ Coverage 95-105% → ✅ PASS (no action)
    │
    └─ Coverage <95% or >105% → ❌ FAIL
        ↓
        Auto-Remediation Triggered
        ├─ Step 1: Analyze Source HTML
        ├─ Step 2: Analyze Extracted Blocks
        ├─ Step 3: Find Content Gaps/Duplicates
        ├─ Step 4: Generate Recommendations
        └─ Step 5: Save Diagnosis to File
        ↓
        ✅ Page auto-saved to patch/pages/pages-to-update/
        ✅ Diagnosis saved to patch/logs/audit-diagnosis-*.json
        ✅ Recommendations logged to server console
```

## Diagnosis Output

### Server Log Example

When AUDIT fails on a POST request:

```
🔧 ========== TRIGGERING AUTO-REMEDIATION ==========

🔍 ========== AUDIT AUTO-REMEDIATION ==========
📄 Page: Predictive Intelligence Basics
📊 Coverage: 64.1%
🎯 Threshold: 95-105%

[STEP 1] Analyzing source HTML...
  ✅ Found 127 elements
  ✅ Found 63 text nodes
  ✅ Found 1800 total characters

[STEP 2] Analyzing extracted blocks...
  ✅ Extracted 8 blocks
  ✅ 3 different types
  ✅ 1154 characters

[STEP 3] Identifying content gaps...
  ⚠️ Found 2 missing content patterns
     Gap 1: missing_list_items - "Step 1: Enable prediction in..."
     Gap 2: missing_table_content - "Type    | Count | Status"

[STEP 4] Checking for duplicate content...

[STEP 5] Generating recommendations...
  📝 2 recommendations:
     1. [HIGH] Fix missing missing_list_items
        Reason: 4 instances of missing_list_items not extracted
        Fix: Check extractLists() in servicenow.cjs
     2. [HIGH] Fix missing missing_table_content
        Reason: 1 instances of missing_table_content not extracted
        Fix: Check extractTables() in servicenow.cjs

[SUMMARY]
  Coverage: 64.1%
  Status: ❌ FAIL
  Gaps found: 2
  Duplicates found: 0
  Recommendations: 2
  🎯 Top priority: Fix missing missing_list_items

=========================================
💾 Diagnosis saved: /Users/.../patch/logs/audit-diagnosis-abc123def-2025-12-04.json

🔧 =========================================
```

### Diagnosis File Example

**File:** `patch/logs/audit-diagnosis-<pageId>-YYYY-MM-DD.json`

```json
{
  "timestamp": "2025-12-04T15:42:05.150Z",
  "pageTitle": "Predictive Intelligence Basics",
  "coverage": 64.1,
  "passed": false,
  "sourceAnalysis": {
    "totalElements": 127,
    "elementTypes": {
      "div": 45,
      "p": 18,
      "li": 12,
      "td": 8,
      "span": 25
    },
    "totalTextNodes": 63,
    "totalChars": 1800,
    "listItems": 12,
    "tables": 2,
    "codeBlocks": 0,
    "callouts": 2,
    "complexNesting": [
      {
        "tag": "div",
        "depth": 8,
        "text": "Nested content block"
      }
    ]
  },
  "blockAnalysis": {
    "totalBlocks": 8,
    "blockTypes": [
      { "type": "paragraph", "count": 5 },
      { "type": "bulleted_list_item", "count": 2 },
      { "type": "callout", "count": 1 }
    ],
    "totalChars": 1154,
    "emptyBlocks": []
  },
  "gaps": [
    {
      "type": "missing_list_items",
      "count": 4,
      "preview": "Step 1: Enable prediction in...",
      "severity": "high",
      "fixCode": "Check extractLists() in servicenow.cjs"
    },
    {
      "type": "missing_table_content",
      "count": 1,
      "preview": "Type | Count | Status",
      "severity": "high",
      "fixCode": "Check extractTables() in servicenow.cjs"
    }
  ],
  "duplicates": [],
  "recommendations": [
    {
      "priority": "HIGH",
      "action": "Fix missing missing_list_items",
      "reason": "4 instances of missing_list_items not extracted",
      "affectedContent": "Step 1: Enable prediction in...",
      "fixCode": "Check extractLists() in servicenow.cjs",
      "coverage_impact": "+5-15%"
    },
    {
      "priority": "HIGH",
      "action": "Fix missing missing_table_content",
      "reason": "1 instances of missing_table_content not extracted",
      "affectedContent": "Type | Count | Status",
      "fixCode": "Check extractTables() in servicenow.cjs",
      "coverage_impact": "+10-20%"
    }
  ]
}
```

## Gap Analysis

### Gap Types

**Type:** `missing_list_items`
- **Cause:** List items (`<li>`) not extracted
- **Severity:** HIGH
- **Fix:** Check `extractLists()` function in servicenow.cjs
- **Impact:** +5-15% coverage

**Type:** `missing_table_content`
- **Cause:** Table rows/cells not extracted
- **Severity:** HIGH
- **Fix:** Check `extractTables()` in servicenow.cjs + table.cjs
- **Impact:** +10-20% coverage

**Type:** `missing_code`
- **Cause:** Code blocks (`<pre>`, `<code>`) not extracted
- **Severity:** HIGH
- **Fix:** Check code block extraction logic
- **Impact:** +5-10% coverage

**Type:** `deep_nesting`
- **Cause:** Deeply nested content (>5 levels) lost during traversal
- **Severity:** MEDIUM
- **Fix:** Enable `SN2N_STRICT_ORDER=1` for strict DOM traversal
- **Impact:** +2-5% coverage

**Type:** `hidden_elements`
- **Cause:** Elements with `display: none` or `visibility: hidden` not extracted
- **Severity:** LOW
- **Fix:** Review CSS visibility, may be intentional
- **Impact:** Variable

### Duplicate Detection

**Type:** `duplicate_text`
- **Cause:** Same text extracted twice (exact match)
- **Severity:** HIGH
- **Fix:** Enable deduplication in w2n.cjs
- **Impact:** -5-10% coverage

**Type:** `near_duplicate`
- **Cause:** Similar text (>90% similarity) extracted twice
- **Severity:** MEDIUM
- **Fix:** Improve deduplication logic, check rich-text extraction
- **Impact:** Variable

## Fix Recommendations

### Recommendation Structure

```javascript
{
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'DEBUG',
  action: 'Brief action description',
  reason: 'Why this recommendation',
  affectedContent: 'Preview of affected content',
  fixCode: 'Code location to review',
  coverage_impact: 'Expected coverage change'
}
```

### Priority Levels

- **HIGH:** >20% coverage impact, blocks extraction completeness
- **MEDIUM:** 5-20% coverage impact, affects subset of content
- **LOW:** <5% coverage impact, nice-to-have improvements
- **DEBUG:** Information-only, may not affect coverage

## Usage Workflow

### 1. View Auto-Remediation in Server Logs

When extraction fails with AUDIT:

```bash
# In server terminal output:
🔧 ========== TRIGGERING AUTO-REMEDIATION ==========
[STEP 1] Analyzing source HTML...
[STEP 2] Analyzing extracted blocks...
[STEP 3] Identifying content gaps...
[STEP 4] Checking for duplicate content...
[STEP 5] Generating recommendations...
[SUMMARY]
💾 Diagnosis saved: patch/logs/audit-diagnosis-*.json
```

### 2. Review Diagnosis File

```bash
# List recent diagnoses
ls -lt patch/logs/audit-diagnosis-*.json | head -5

# View diagnosis
cat patch/logs/audit-diagnosis-<pageId>-YYYY-MM-DD.json | jq '.recommendations'
```

### 3. Apply Recommended Fix

Based on recommendations, update servicenow.cjs or converters:

```javascript
// Example: Add missing list extraction
// File: server/services/servicenow.cjs

// Check: Does extractLists() detect all <li> elements?
// Fix: Add more specific selectors or class patterns
// Test: node test-auto-remediation.cjs

// After fix:
// 1. Rebuild if client-side change: npm run build
// 2. Restart server
// 3. Re-extract page
// 4. Check new AUDIT coverage - should be >95%
```

### 4. Re-Extract Page

```bash
# Use PATCH dry-run to test without creating page
curl -X PATCH http://localhost:3004/api/W2N/<pageId> \
  -H "Content-Type: application/json" \
  -d '{
    "contentHtml": "<updated-html>",
    "dryRun": true
  }'

# Should show improved coverage % in response
```

### 5. Verify Fix

Once coverage is 95-105%, batch patch all affected pages:

```bash
cd patch/config
bash batch-patch-with-cooldown.sh
```

## Testing Auto-Remediation

Run test suite with multiple failure scenarios:

```bash
node test-auto-remediation.cjs
```

**Test Cases:**
1. **Missing List Items (40% coverage)** - Gap detection for lists
2. **Duplicate Content (125% coverage)** - Duplicate detection
3. **Complex Nesting (33% coverage)** - Deep nesting gap detection

## Configuration

### Environment Variables

**Enable Auto-Remediation:**
```bash
SN2N_AUDIT_CONTENT=1       # Enable AUDIT tracking
SN2N_VALIDATE_OUTPUT=1     # Enable validation property updates
SN2N_VERBOSE=1             # Show detailed logs
```

**Debug Flags:**
```bash
SN2N_DEBUG_ORDER=1         # Track traversal order
SN2N_STRICT_ORDER=1        # Use strict DOM traversal (helps with nesting)
SN2N_PRESERVE_STRUCTURE=1  # Keep original structure (captions, UIControl)
```

### Starting Server with Full Diagnostics

```bash
# Terminal
SN2N_AUDIT_CONTENT=1 \
SN2N_VALIDATE_OUTPUT=1 \
SN2N_DEBUG_ORDER=1 \
SN2N_STRICT_ORDER=1 \
SN2N_PRESERVE_STRUCTURE=1 \
SN2N_VERBOSE=1 \
npm start
```

Or use VS Code task:
```
🎯 Start Server (Accuracy Debug)
```

## Limitations & Future Improvements

### Current Limitations

- **Manual fix application:** Recommendations point to code locations, but don't auto-apply changes
- **HTML pattern specificity:** Gap detection uses common patterns (lists, tables, code blocks)
- **Performance:** Analysis on large pages might be slow (analyze on demand, not blocking)
- **Deduplication:** Can't distinguish between intentional and accidental duplicates

### Future Enhancements

1. **Auto-Fix Application:**
   - Automatically enable `SN2N_STRICT_ORDER=1` for nesting issues
   - Automatically improve deduplication logic
   - Generate servicenow.cjs patches automatically

2. **ML-Based Detection:**
   - Learn patterns from successful extractions
   - Predict failure types before full analysis
   - Suggest fixes with confidence scores

3. **Interactive Workflow:**
   - Web UI to browse diagnoses
   - One-click fix application
   - Feedback loop to improve recommendations

4. **Performance Optimization:**
   - Cache HTML analysis results
   - Parallel gap/duplicate detection
   - Sampling for large pages

## Related Documentation

- **AUDIT System:** See `docs/CONTENT-ACCURACY-IMPROVEMENTS.md`
- **AUDIT Validation:** See `docs/AUDIT-VALIDATION-REPLACEMENT.md`
- **Extraction Logic:** See `server/services/servicenow.cjs` (block detection)
- **Table Extraction:** See `server/converters/table.cjs`
- **Rich Text Extraction:** See `server/converters/rich-text.cjs`

## Troubleshooting

### Issue: Auto-Remediation doesn't run

**Check:**
```bash
# Is AUDIT enabled?
ps eww $(lsof -ti:3004) | grep SN2N_AUDIT_CONTENT

# Is AUDIT validation enabled?
ps eww $(lsof -ti:3004) | grep SN2N_VALIDATE_OUTPUT
```

**Fix:**
```bash
# Kill server and restart with flags
npm run build
killall node 2>/dev/null || true
sleep 2
SN2N_AUDIT_CONTENT=1 SN2N_VALIDATE_OUTPUT=1 npm start
```

### Issue: Diagnosis file not created

**Check:**
- Does `patch/logs/` directory exist?
- Are there write permissions?

**Fix:**
```bash
mkdir -p patch/logs
chmod 755 patch/logs
```

### Issue: Recommendations are not accurate

**Feedback:**
- Review the diagnosis JSON file
- Cross-check with actual source HTML
- Report specific case to improve detection patterns

## Summary

The AUDIT Auto-Remediation System transforms failed extractions from dead ends into actionable feedback loops. When AUDIT validation fails, the system automatically:

✅ Analyzes what went wrong  
✅ Identifies root causes (missing lists, duplicates, nesting)  
✅ Generates prioritized fix recommendations  
✅ Saves findings for manual review or auto-application  
✅ Logs everything for transparency and debugging  

This enables rapid iteration on content extraction improvements without manual detective work.
