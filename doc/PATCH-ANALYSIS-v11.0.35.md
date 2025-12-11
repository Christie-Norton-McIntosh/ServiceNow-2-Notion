# PATCH Validation Failure Analysis — v11.0.35
**Generated**: 2025-12-06  
**Status**: Analysis phase — Root causes identified, fixes pending implementation

---

## Executive Summary

### Pages Analyzed
- **Total Pages in `pages-to-update/`**: 39
- **Content Validation Failures**: 22 pages
- **PATCH Validation Failures**: 2 pages (same page, duplicate attempts)
- **Other Validation Errors**: 14 pages (early warnings before official failure)
- **Failure Type**: 56% CONTENT VALIDATION, 5% PATCH VALIDATION, 36% OTHER

### Key Metrics
- **Average Coverage** (content validation failures): 92.4% (targeting 95-105% for simple content)
- **Critical Low Coverage** (< 65%): 3 pages (47%, 57%, 0%)
- **Critical High Coverage** (> 110%): 5 pages (110.2%-124.7%)
- **Most Common Issue**: JUST_OUTSIDE threshold (14 pages within 1-3% of limits)

---

## Failure Pattern Breakdown

### Pattern 1: JUST_OUTSIDE Threshold (14 pages)
**Pages**: 
- Benchmarks KPI performance trend (93.7%)
- Change Management considerations (94.9%)
- Change Management plugins (92.2%)
- Change types (83.1%)
- Domain separation and Benchmarks (94.5%)
- Domain separation and Contract Management (94.3%)
- Domain separation and Procurement (93.9%)
- Domain separation and Product Catalog (94.6%)
- Get started with Software Asset Management (88.6%)
- Procurement workflows (83.6%)
- Purchase order expected delivery date (91.1%)
- Receive a purchase order for contract assets (87.6%)
- Script includes and customization (72.5%)
- Supply contract renewal information (86.8%)

**Coverage Range**: 72.5% - 94.9%  
**Expected Range**: 95-105% (or 75-108%, 65-110% depending on complexity)  
**Issue**: Content coverage just below (or significantly below) threshold

**Root Cause Hypothesis**:
- Small content segments missing (1-5% of text)
- Text filtering or normalization removing legitimate content
- Nested list items not counted correctly
- Placeholder characters (dots, dashes) being removed

**Example AUDIT Analysis** (from one page):
```
Missing segments detected:
- "." (empty/placeholder list items)
- "In the" (partial text)
- "Assets Covered", "Users Covered" (UI control labels)
- "New", "related list, click" (text fragments)

Extra segments detected:
- Merged sentences: "In the Assets Covered or Users Covered related list, click New ."
- Callout content preserved as single block
```

**Fix Approach**:
1. Investigate list item choice handling (class="choice" items with dots)
2. Preserve placeholder characters or document filtering rationale
3. Ensure text segments keep structural integrity through processing
4. Review text normalization for aggressive filtering

---

### Pattern 2: TOO_HIGH Coverage (5 pages)
**Pages**:
- Add a user or asset to a contract (110.2%)
- Add terms and conditions to a contract (121.6%)
- Modify or retire a standard change template (118.2%)
- Success score indicators (124.7%)
- View benchmark KPI data (deprecated) (111.3%)

**Coverage Range**: 110.2% - 124.7%  
**Expected Range**: 65-110% (threshold varies by complexity)  
**Issue**: Notion has more content/blocks than expected

**Root Cause Hypothesis**:
- Callout elements being duplicated or split incorrectly
- Nested list items expanding into separate list items
- Table cells being expanded into paragraph blocks
- Text deduplication not working (merged text that should stay separate)

**Validation Metadata Sample** (from "Add a user or asset" page):
```
contentAnalysis: {
  tableCount: 0,
  calloutCount: 3,           ← 3 callouts detected
  deepNestingCount: 9,
  listItemCount: 16,
  nestedListCount: 4,
  maxNestingDepth: 3
}

notionBlocks: 6
notionTextLength: 1543 (vs source 1400)
extraPercent: 10.2%
```

**Fix Approach**:
1. Check for callout duplication/splitting logic
2. Verify table cell expansion not creating extra blocks
3. Review deduplication for text merging
4. Ensure list nesting limit (2 levels) not causing expansion

---

### Pattern 3: TOO_LOW Coverage (3 pages)
**Pages**:
- Update change request states (47%)
- View IBM PVU mappings (57%)
- We'll be back soon! (0%)

**Coverage**: 0% - 57%  
**Expected**: 65-110%  
**Issue**: Critical content missing

**Root Cause Hypothesis**:
- Entire sections not being extracted
- Complex structure (tables, code) not parsed
- Content behind navigation/conditional elements
- Empty page error (we'll be back soon = server error page)

**Example** (Update change request states):
```
Coverage: 47%
Threshold: 65-110% (with tables/callouts)
Missing: Significant sections not extracted
```

**Fix Approach**:
1. Check if pages have tables that aren't being detected
2. Review code block extraction
3. Verify callout processing not skipping content
4. For empty page: investigate if it's a known placeholder

---

### Pattern 4: Early Validation Warnings (14 pages)
**Primary Issues**:
- **Excess callouts** (9 pages): Expected 1-4, got 3-9 (2-5 extra)
  - Pages: Most of the "other" category
  - Root cause: Over-detection or split/duplication of callout elements
  
- **Table mismatches** (4 pages): Expected vs actual table count mismatch
  
- **Missing images** (1 page): Expected images not extracted
  
- **Block count too low** (3 pages): Major content not being captured

**Root Cause**: These pages failed BEFORE content validation ran, suggesting structural extraction issues.

---

### Pattern 5: PATCH Validation Failures (2 attempts, same page)
**Page**: Predictive Intelligence for Incident Management (ID: 2c1a89fe-dba5-81ba-a18f-ebb595225a79)

**Issue**:
```
❌ CRITICAL ERROR:
Heading count too low: expected ~3 (±20%), got 1

⚠️ WARNING:
Unordered list item count differs: expected 11, got 3 (8 fewer)

Status: PATCH validation retried 2 times but still failed
```

**Root Cause**:
- Headings not being extracted (expected 3, got 1)
- Nested list items losing count (expected 11, got 3)
- PATCH used different validation logic or conversion logic than POST

**Fix Approach**:
1. Ensure PATCH uses identical conversion logic as POST
2. Verify heading extraction (h1-h6) in both POST and PATCH
3. Check list item counting methodology matches between POST and PATCH
4. Review validation retry logic (should be identical on retry)

---

## Server Code Root Cause Analysis

### File: `server/services/servicenow.cjs`

#### 1. Callout Detection (Line ~1499)
**Current Logic**:
```javascript
if (tagName === 'div' && $elem.attr('class') && $elem.attr('class').includes('note')) {
  // ... process as callout
}
```

**Issue**: Uses `.includes('note')` which is broad. Could match:
- `class="note note note_note"` ✓ (correct)
- `class="sidenote"` ? (might not be intended)
- Any class with "note" substring

**Risk**: Over-detection may cause duplicates or extra callouts

---

#### 2. List Item Choice Handling (Line ~2660)
**Current Logic**:
```javascript
// Find nested blocks in list items
const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note, > div.itemgroup, > div.info').toArray();

// Extract text content without nested blocks
const textOnlyHtml = $textOnly.html();
```

**Issue**: List items with `class="choice"` containing dots (`.`) are:
1. Found in nested block detection
2. Text extracted without the dots
3. Dots filtered as "empty" content during text parsing

**Evidence** (from validation):
```
Missing segment: "."
Context: div > div > div > div > li > li (nested deeply)
Class: "li choice"
Length: 1, normalized: ""
```

**Root Cause**: Dots in choice items are structural but being filtered as meaningless

---

#### 3. Text Normalization and Filtering
**Pipeline**:
1. HTML extracted from page
2. Rich text parsing: `parseRichText(html)` → converts HTML tags to Notion annotations
3. Text cleaning: `cleanHtmlText()` → removes HTML tags, normalizes whitespace
4. Segment extraction: Content split into semantic segments for validation

**Issue**: Dots and minimal text likely filtered during cleaning phase

---

## Immediate Action Items

### High Priority (Blocking multiple pages)

1. **Investigate Choice Item Filtering** (affects 9+ pages)
   - [ ] Examine source HTML: are `<li class="choice">.</li>` legitimate content or placeholders?
   - [ ] Check if dots should be preserved or documented as filtered
   - [ ] Verify nested list structure preserved 1:1 or flattened intentionally
   - [ ] Impact: Could fix 9-14 pages if solved

2. **Review Callout Duplication** (affects 5+ pages)
   - [ ] Verify callout detection not creating duplicates
   - [ ] Check if callout splitting causing extra blocks
   - [ ] Impact: Could fix 5 pages with TOO_HIGH coverage

3. **Heading Extraction Fix** (affects 2+ pages)
   - [ ] Ensure h1-h6 tags detected and converted to headings blocks
   - [ ] Verify same logic used in POST and PATCH
   - [ ] Add heading count validation
   - [ ] Impact: Fixes PATCH validation failures

---

## Recommended Fixes (Priority Order)

### Fix 1: Choice Item Preservation
**File**: `server/services/servicenow.cjs` (list handling)

**Change**:
- Determine if dots in choice items should be preserved
- If yes: ensure not filtered during text cleaning
- If no: document in comments and validation warnings

**Expected Impact**: +4-8 pages fixed (JUST_OUTSIDE threshold pages)

---

### Fix 2: Callout Deduplication
**File**: `server/services/servicenow.cjs` (callout detection)

**Change**:
- Add deduplication logic for identical callout text
- Verify callout class detection specific enough (not over-broad)
- Ensure nested callouts handled correctly

**Expected Impact**: +3-5 pages fixed (TOO_HIGH coverage pages)

---

### Fix 3: List Item Count Accuracy
**File**: `server/services/servicenow.cjs` (list processing) + `server/routes/w2n.cjs` (validation)

**Change**:
- Ensure list item counting matches between extraction and validation
- Verify nested list flattening doesn't lose count
- Add debug logging for list structure

**Expected Impact**: +2-3 pages fixed (heading/list count mismatches)

---

### Fix 4: Ensure PATCH Uses Identical Logic
**File**: `server/routes/w2n.cjs`

**Change**:
- Verify POST and PATCH use same conversion function
- Ensure validation logic identical
- Add test cases for PATCH

**Expected Impact**: Fixes PATCH-specific failures (2 pages)

---

## Testing Strategy

### Test Case 1: Choice Item Preservation
**Input**: HTML with `<li class="choice">.</li>` elements

**Expected**:
- Dots preserved or documented as filtered
- Validation AUDIT reports expected count
- Coverage within threshold

---

### Test Case 2: Callout Deduplication  
**Input**: HTML with multiple identical callout blocks

**Expected**:
- No duplicate callouts in output
- Coverage matches expected

---

### Test Case 3: Heading Extraction
**Input**: HTML with h1-h6 tags

**Expected**:
- Heading blocks created correctly
- Count matches source
- Works in both POST and PATCH

---

## Pattern Learning Data

```json
{
  "pattern_1_just_outside": {
    "pattern_id": "just_outside_95_105",
    "failure_type": "content_validation",
    "frequency": 14,
    "pages_affected": [
      "Benchmarks KPI performance trend",
      "Change Management considerations",
      "Change Management plugins",
      "Change types",
      "Domain separation and Benchmarks",
      "Domain separation and Contract Management",
      "Domain separation and Procurement",
      "Domain separation and Product Catalog",
      "Get started with Software Asset Management",
      "Procurement workflows",
      "Purchase order expected delivery date",
      "Receive a purchase order for contract assets",
      "Script includes and customization",
      "Supply contract renewal information"
    ],
    "coverage_range": "72.5%-94.9%",
    "threshold": "95-105%",
    "root_cause": "Small content segments missing (1-5%)",
    "audit_characteristics": {
      "common_missing_contexts": [
        "Single dot character",
        "Partial list item text",
        "UI control labels",
        "Nested list item fragments"
      ],
      "common_extra_contexts": [
        "Merged list item sentences",
        "Callout preserved as single block"
      ]
    }
  },
  
  "pattern_2_too_high": {
    "pattern_id": "too_high_110_plus",
    "failure_type": "content_validation",
    "frequency": 5,
    "pages_affected": [
      "Add a user or asset to a contract",
      "Add terms and conditions to a contract",
      "Modify or retire a standard change template",
      "Success score indicators",
      "View benchmark KPI data (deprecated)"
    ],
    "coverage_range": "110.2%-124.7%",
    "expected_threshold": "65-110%",
    "root_cause": "Extra callouts, nested lists, or table expansion",
    "audit_characteristics": {
      "high_callout_count": true,
      "nested_structures": true,
      "avg_extra_percent": 12.5
    }
  },

  "pattern_3_too_low": {
    "pattern_id": "too_low_under_65",
    "failure_type": "content_validation",
    "frequency": 3,
    "pages_affected": [
      "Update change request states (47%)",
      "View IBM PVU mappings (57%)",
      "We'll be back soon! (0%)"
    ],
    "coverage_range": "0%-57%",
    "expected_threshold": "65-110%",
    "root_cause": "Major content not extracted or page error"
  },

  "pattern_4_excess_callouts": {
    "pattern_id": "excess_callouts",
    "failure_type": "early_validation_warning",
    "frequency": 9,
    "pages_affected": [
      "Add a user or asset to a contract",
      "Add terms and conditions to a contract",
      "Configure ability to copy a change request",
      "Configure state model transitions",
      "Create a change request",
      "Create a contract renewal request",
      "Create approval definitions",
      "Modify or retire a standard change template",
      "Multiple others"
    ],
    "common_error": "Excess callouts: expected 1-4, got 3-9",
    "root_cause": "Callout detection over-broad or splitting logic broken"
  },

  "pattern_5_patch_heading_list_mismatch": {
    "pattern_id": "patch_heading_list_count",
    "failure_type": "patch_validation",
    "frequency": 2,
    "pages_affected": [
      "Predictive Intelligence for Incident Management (2 attempts)"
    ],
    "issues": [
      "Heading count: expected 3, got 1",
      "List count: expected 11, got 3"
    ],
    "root_cause": "PATCH conversion or validation logic differs from POST"
  }
}
```

---

## Success Criteria

- [ ] All pages analyzed and categorized
- [ ] Root causes identified for each pattern (DONE)
- [ ] Fixes implemented in POST endpoint
- [ ] PATCH consistency verified
- [ ] All fixable pages pass validation after PATCH
- [ ] Test cases added for regression prevention
- [ ] Pattern learning data exported

---

## Next Steps

1. **Confirm Choice Item Handling** — Determine if dots should be preserved
2. **Implement Fix 1** — Choice item filtering
3. **Implement Fix 2** — Callout deduplication
4. **Verify PATCH Logic** — Ensure consistency
5. **Run Batch PATCH** — Apply fixes to all pages
6. **Validate** — Confirm pages move to updated-pages/

---

## References

- **Prompt**: `.github/prompts/Evaluate for PATCH.prompt.md`
- **Input Pages**: `patch/pages/pages-to-update/` (39 files)
- **Server Code**: `server/services/servicenow.cjs`, `server/routes/w2n.cjs`
- **Validation**: AUDIT coverage tracking, content similarity analysis
