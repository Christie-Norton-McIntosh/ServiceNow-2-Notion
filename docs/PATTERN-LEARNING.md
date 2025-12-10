# Pattern Learning System Documentation

**Version**: 11.0.113  
**Last Updated**: December 4, 2025

---

## Overview

The **Pattern Learning System** is an automatic feedback loop that captures failing HTML patterns when AUDIT validation fails. This creates a growing library of test fixtures that helps:

1. **Detect regressions** - Compare future extractions against known patterns
2. **Analyze trends** - Understand which types of content are most problematic
3. **Improve extraction** - Use patterns as test cases for algorithmic fixes
4. **Validate fixes** - Verify that code changes improve coverage

---

## How It Works

### 1. Automatic Capture (Auto-Remediation)

When AUDIT validation detects low coverage (<95%), the auto-remediation engine:

1. **Analyzes** the source HTML and extracted blocks
2. **Identifies** gaps (missing list items, missing table rows, etc.)
3. **Captures** each gap type with full context
4. **Stores** pattern as JSON in `tests/fixtures/pattern-learning/<type>/`
5. **Deduplicates** using SHA256 hash to prevent duplicate captures

### 2. Pattern Storage

Patterns are organized by **gap type** detected:

```
tests/fixtures/pattern-learning/
├── missing_list_items/          # List items not extracted
├── missing_table_content/       # Table rows/cells missing
├── missing_code/                # Code blocks not extracted
├── deep_nesting/                # Deeply nested content
├── hidden_elements/             # Hidden content that might be important
├── duplicate_text/              # Duplicate content in extraction
└── near_duplicate_text/         # Similar text appearing multiple times
```

### 3. Pattern JSON Format

Each captured pattern contains:

```json
{
  "captured": "2025-12-04T16:17:27.453Z",           // When captured
  "pageTitle": "Test Page - Pattern Capture",       // Source page
  "patternType": "missing_list_items",               // Gap type
  "htmlHash": "f7e16adba0f612d6",                   // SHA256 (dedup)
  
  "htmlLength": 254,                                 // Source size
  "htmlPreview": "<ul>...",                          // First 500 chars
  "fullHtml": "<div>...</div>",                      // Complete HTML
  
  "blocksExtracted": 3,                              // # of blocks
  "blockTypes": { "heading_2": 1, "paragraph": 2 }, // Block breakdown
  
  "coverage": 50,                                    // Coverage %
  "coverageStr": "50%",                              // Formatted
  "sourceNodes": 0,                                  // Source metrics
  "sourceChars": 0,
  "notionBlocks": 3,
  "notionChars": 0,
  "missing": 0,                                      // AUDIT gap metrics
  "extra": 0,
  
  "description": "missing_list_items: 50% coverage on \"Test Page\""
}
```

---

## Usage

### View Captured Patterns

```bash
# List all patterns
node tools/manage-patterns.cjs

# List patterns by type
node tools/manage-patterns.cjs --type missing_list_items

# Show statistics
node tools/manage-patterns.cjs --stats

# Clean old patterns (keep last 5)
node tools/manage-patterns.cjs --clean

# Generate comparison test scripts
node tools/manage-patterns.cjs --gen-tests
```

### Example Output

```
📚 CAPTURED PATTERNS
════════════════════════════════════════════════════════════════════════════════

📂 missing_list_items (1 patterns)
────────────────────────────────────────────────────────────────────────────────
   1. [50%] Test Page - Pattern Capture
      📅 Captured: 12/4/2025, 10:17:27 AM
      📝 Blocks: 3 (heading_2:1, paragraph:2)
      🔍 Hash: f7e16adba0f612d6
      📄 File: pattern-f7e16adb-2025-12-04T16-17-27.json
```

---

## Integration with Auto-Remediation

The pattern learning system is **automatically integrated** into the AUDIT auto-remediation engine:

### When Pattern Capture Triggers

1. **Coverage < 95%** (low extraction quality)
2. **Gap identified** (missing content detected)
3. **After diagnosis** (pattern saved immediately)

### Example Flow

```
AUDIT validation fails (coverage = 50%)
    ↓
diagnoseAndFixAudit() called
    ↓
findContentGaps() detects missing list items
    ↓
captureNewPattern() called with:
  - HTML (full + preview)
  - Blocks extracted
  - patternType = "missing_list_items"
  - AUDIT metrics (coverage, etc.)
  - Page title
    ↓
Pattern stored to tests/fixtures/pattern-learning/missing_list_items/
    ↓
Deduplication check: hash prevents duplicates
    ↓
Log output: "💾 New pattern captured: pattern-f7e16adb-...json"
```

---

## Pattern Types

### 1. **missing_list_items**
- **When**: List items in source HTML not found in extracted blocks
- **Indicates**: Issue with `extractLists()` in servicenow.cjs
- **Fix**: Check DOM traversal for nested lists

### 2. **missing_table_content**
- **When**: Table rows/cells in source not found in extracted blocks
- **Indicates**: Issue with `extractTables()` in servicenow.cjs
- **Fix**: Check table cell content extraction, nested content handling

### 3. **missing_code**
- **When**: Code blocks (`<pre>`, `<code>`) not extracted
- **Indicates**: Issue with code block detection/extraction
- **Fix**: Check code block extraction logic, syntax highlighting handling

### 4. **deep_nesting**
- **When**: Content in complex nested structures not extracted
- **Indicates**: DOM traversal stops at certain depth
- **Fix**: Use `SN2N_STRICT_ORDER=1` for strict DOM traversal

### 5. **hidden_elements**
- **When**: Elements with `display:none` or `visibility:hidden`
- **Indicates**: Potentially important hidden content
- **Fix**: Determine if hidden content should be extracted

### 6. **duplicate_text**
- **When**: Same text appears in multiple extracted blocks
- **Indicates**: Over-extraction or copy-paste content
- **Fix**: Add deduplication logic to extraction or HTML preprocessing

### 7. **near_duplicate_text**
- **When**: Similar text (>90% match) in multiple blocks
- **Indicates**: Variations of same content extracted multiple times
- **Fix**: Improve content deduplication algorithm

---

## Integration Points

### In `server/utils/audit-auto-remediate.cjs`

```javascript
// Line 20: Import pattern learning
const { captureNewPattern } = require('./pattern-learning.cjs');

// Line 83: Pass to findContentGaps()
diagnosis.gaps = findContentGaps(html, blocks, sourceAnalysis, log, {
  pageTitle,
  audit,
  captureNewPattern  // ← Passed as callback
});

// Inside findContentGaps(): After gap detected
if (captureNewPattern) {
  captureNewPattern({
    html,
    blocks,
    patternType: 'missing_list_items',
    audit,
    pageTitle,
    log
  });
}
```

### In `server/utils/pattern-learning.cjs`

Main functions:

```javascript
captureNewPattern(options)          // Save pattern with dedup
loadPatterns(type)                  // Load by type
getPatternStatistics()              // Get stats
generateComparisonScript()          // Auto-gen tests
```

---

## Workflow: From Failure to Fixture

### Step 1: Extraction Fails
- Page extracted with low coverage
- AUDIT validation detects issues

### Step 2: Auto-Diagnosis
```
POST /api/W2N with dryRun=true
  ↓
AUDIT fails (coverage < 95%)
  ↓
diagnoseAndFixAudit() runs
```

### Step 3: Pattern Captured
```
findContentGaps() detects gaps
  ↓
captureNewPattern() called
  ↓
Pattern JSON stored to tests/fixtures/pattern-learning/<type>/
```

### Step 4: Available for Testing
```
Developer runs: node tools/manage-patterns.cjs --stats
  ↓
Sees: "missing_list_items: 1 pattern (50% coverage)"
  ↓
Can review: Full HTML in pattern JSON
  ↓
Can test: Extract same HTML again, verify improvement
```

### Step 5: Fix & Validate
```
Developer fixes extraction logic
  ↓
Runs extraction on captured HTML again
  ↓
Verifies coverage improved
  ↓
Pattern now serves as regression test
```

---

## Statistics & Analysis

### Using `--stats` flag

```bash
node tools/manage-patterns.cjs --stats
```

Shows:
- **Total pattern types** captured
- **Total patterns** collected
- **By type**: Count, avg coverage, coverage range, avg HTML size, avg blocks
- **Trends**: Which gap types are most common

### Example:

```
📈 Overall Stats:
   Total pattern types: 5
   Total patterns captured: 23

📊 By Type:
   missing_list_items
   ├─ Patterns: 8
   ├─ Avg Coverage: 45%
   ├─ Coverage Range: 30% → 60%
   ├─ Avg HTML Size: 2,847 chars
   └─ Avg Blocks: 12

   missing_table_content
   ├─ Patterns: 7
   ├─ Avg Coverage: 42%
   ...
```

This tells you:
- **Most common gap**: missing_list_items (8 patterns)
- **Severity**: List extraction has lowest avg coverage (45%)
- **Scope**: Tables are complex (avg 2.8K HTML, 12 blocks)

---

## Maintenance

### Cleaning Old Patterns

```bash
# Keep only last 5 patterns per type
node tools/manage-patterns.cjs --clean
```

This helps:
- Reduce test directory clutter
- Focus on recent/relevant patterns
- Keep only representative samples

### Generating Test Scripts

```bash
# Auto-generate comparison test scripts
node tools/manage-patterns.cjs --gen-tests
```

Creates:
- `tests/test-pattern-<type>-<hash>.cjs` for each pattern
- Loads pattern from JSON
- Validates data integrity
- Ready for extraction comparison

---

## Best Practices

### 1. Regular Monitoring
- Check `--stats` weekly to identify trends
- Review high-count gap types for patterns
- Prioritize most common gaps

### 2. Cleanup Schedule
- Clean old patterns monthly
- Keep last 5-10 per type for regression testing
- Archive important patterns elsewhere if needed

### 3. Fix Validation
1. Capture failing pattern
2. Review source HTML in pattern JSON
3. Fix extraction logic
4. Re-run extraction on captured HTML
5. Verify coverage improved
6. Keep pattern as regression test

### 4. Pattern Review
- Before fixing: Understand what went wrong
- Look at `htmlPreview` and `fullHtml`
- Check `coverage` % to understand severity
- Review `blockTypes` to see what extracted

---

## Integration with CI/CD

### Future Enhancement: Regression Testing

Once patterns are captured, they can be used in:

```bash
# Run all pattern comparison tests
npm run test:patterns

# Or in CI/CD pipeline:
- Compare new extraction against known patterns
- Alert if coverage drops below baseline
- Block deployment if regression detected
```

### Future Enhancement: Trend Analysis

```bash
# Generate trend report
node tools/analyze-patterns.cjs --trend

# Shows: Coverage improvement over time
# Identifies: Fixes that worked vs. didn't help
# Suggests: Next priorities
```

---

## Troubleshooting

### Patterns Not Being Captured

**Check**:
1. AUDIT coverage is actually < 95%
2. Pattern learning module imported in audit-auto-remediate.cjs
3. captureNewPattern called with correct parameters
4. tests/fixtures/pattern-learning/ directory exists (auto-created)

### Too Many Duplicate Patterns

**Solution**:
1. Hash-based deduplication should prevent duplicates
2. If duplicates exist, check HTML is actually different
3. Can manually delete from tests/fixtures/pattern-learning/<type>/

### Pattern File Format Issues

**Check**:
1. All required fields present in JSON
2. htmlHash is not null/empty
3. fullHtml contains complete original HTML
4. coverage is numeric value (not string)

---

## Summary

The Pattern Learning System provides:

✅ **Automatic capture** of failing patterns  
✅ **Hash-based deduplication** to prevent duplicates  
✅ **Organized storage** by gap type  
✅ **Rich metadata** for analysis  
✅ **Management tools** for viewing and cleanup  
✅ **Foundation** for regression testing  

This creates a **self-learning feedback loop** where each failure becomes a test case for validating future improvements.

---

## See Also

- `server/utils/pattern-learning.cjs` - Core implementation
- `server/utils/audit-auto-remediate.cjs` - Auto-remediation engine
- `tools/manage-patterns.cjs` - Management CLI tool
- `docs/AUTO-VALIDATION.md` - AUDIT validation details
