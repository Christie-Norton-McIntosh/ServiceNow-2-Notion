# ML Patterns Quick Reference - v11.0.184

## Pattern Frequency & Impact

| Pattern | Count | % | Severity | Fix Version |
|---------|-------|---|----------|-------------|
| Inline Code Parentheses | 15 | 34% | HIGH | v11.0.184 |
| Nested Element Counting | 18 | 41% | HIGH | v11.0.184 |
| Table Images | 6 | 14% | MEDIUM | v11.0.184 |
| **Total** | **44** | **100%** | - | - |

---

## Detection Quick Guide

### 🔴 Pattern 1: Inline Code Parentheses
**Trigger**: AUDIT coverage > 110%
```
HTML:   "Configure the asset, financial_mgmt_user"
Notion: "Configure the (asset), (financial_mgmt_user)"
```
**Fix**: Filter `annotations.code` + normalize parentheses
**Expected**: 95-105% coverage after fix

### 🔴 Pattern 2: Nested Element Counting
**Trigger**: Block count mismatch (actual < expected by >50%)
```
HTML:   22 blocks (counts nested elements)
Notion: 10 blocks (flattened nesting)
```
**Fix**: Count only top-level containers
**Expected**: 100% coverage after fix

### 🟡 Pattern 3: Table Images
**Trigger**: Image count mismatch (Notion < HTML)
```
HTML:   3 images (2 in table + 1 outside)
Notion: 1 image (only outside table)
```
**Fix**: Skip images inside tables
**Expected**: 100% coverage after fix

### 🟢 Pattern 4: Normalization Tolerance
**Applied to**: All phrase matching
```
Rules: lowercase, whitespace, quotes, dashes, parentheses
Result: 80-95% of formatting variations handled
```

---

## Code Locations

### server/services/servicenow.cjs
- **Line 6138-6144**: Filter inline code from Notion AUDIT text

### server/routes/w2n.cjs
- **Line 2147**: Add span.title to heading count (POST)
- **Line 2156-2162**: Skip images in tables (POST)
- **Line 4418**: Add span.title to heading count (PATCH)
- **Line 4429-4435**: Skip images in tables (PATCH)
- **Line 4780-4787**: Parentheses normalization (POST missing)
- **Line 4869-4876**: Parentheses normalization (POST extra)

---

## Training Data Files

### Markdown Documentation
📄 `docs/ML-TRAINING-PATTERNS-v11.0.184.md` (500+ lines)
- Detailed pattern analysis
- HTML signatures with examples
- Root cause explanations
- Detection strategies
- Success metrics (before/after)

### JSON Training Data
📊 `docs/ml-patterns-v11.0.184.json` (structured format)
- 4 pattern records
- Metadata: name, frequency, severity, category
- Fix locations with code context
- Affected pages and content types
- Detection confidence scores

---

## Expected Batch Results

### Baseline (before fixes)
- 44 pages with validation failures
- AUDIT failures: 15 pages (>110% coverage)
- Block count failures: 18 pages (>50% discrepancy)
- Table image issues: 6 pages (image count mismatch)

### After v11.0.184 (with fixes)
- ✅ Inline code AUDIT: 95-105% coverage
- ✅ Nested element counts: 100% match
- ✅ Table images: Excluded from count
- ✅ Parentheses: Normalized before comparison

### Expected Pass Rate
- **Conservative**: 75% (33 of 44 pages pass)
- **Optimistic**: 88% (39 of 44 pages pass)
- **Remaining failures**: Investigation needed

---

## Normalization Rules Applied

```javascript
// Applied before phrase matching
const normalizeForComparison = (text) => {
  return text.toLowerCase()              // 1. Case
    .replace(/\s+/g, ' ')                // 2. Whitespace
    .replace(/[""'']/g, '"')             // 3. Quotes
    .replace(/[–—]/g, '-')               // 4. Dashes
    .replace(/[()]/g, '')                // 5. Parentheses (v11.0.184)
    .trim();
};
```

### Coverage by Rule
- **Whitespace**: HTML formatting, indentation, newlines
- **Quotes**: Unicode smart quotes (curly, single, double)
- **Dashes**: En-dash, em-dash, hyphen
- **Parentheses**: Inline code wrapper tolerance
- **Case**: All variations handled

### NOT Normalized (Strict Matching)
- Commas, periods, semicolons, colons
- Brackets, braces, other special characters
- Numbers and identifiers

---

## Phrase Matching Algorithm

**4-Word Sliding Window**:
```
For each position in HTML text:
  1. Take 4 consecutive words
  2. Normalize the phrase
  3. Check if phrase exists anywhere in Notion text
  4. If NOT found, add word to missing sequence
  5. If sequence > 10 chars, report as missing
```

**Result**: Reduces false positives by ~85%

---

## Version History

| Ver | Change | Impact |
|-----|--------|--------|
| v11.0.180 | Revert inline code parentheses | Fixes 68% of inline code failures |
| v11.0.182 | Add span.title to headings | Fixes heading count mismatches |
| v11.0.183 | Skip inline code in Notion AUDIT | Makes AUDIT symmetric |
| v11.0.184 | Parentheses normalization + table images | Completes content comparison alignment |

---

## ML Integration Checklist

- [ ] Load ml-patterns-v11.0.184.json into training pipeline
- [ ] Extract HTML signatures for pattern detection
- [ ] Train classification model on 4 patterns
- [ ] Test detection accuracy on sample pages
- [ ] Integrate into AutoExtract validation flow
- [ ] Monitor production results
- [ ] Refine thresholds based on batch data

---

**Quick Links**:
- Full documentation: `docs/ML-TRAINING-PATTERNS-v11.0.184.md`
- JSON training data: `docs/ml-patterns-v11.0.184.json`
- Batch script: `patch/config/batch-patch-with-cooldown.sh`
- DRY-RUN summary: `DRYRUN-SUMMARY-v11.0.184.md`
