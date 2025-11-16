# HTML to Notion Conversion Validation

Validation scripts for comparing original ServiceNow HTML with generated Notion blocks to ensure content completeness and structural accuracy.

## Overview

These scripts validate that HTML-to-Notion conversions preserve:
- ✅ Content completeness (all elements present)
- ✅ Block type counts (headings, lists, tables, images, etc.)
- ✅ Structural order (blocks in correct sequence)
- ✅ Nesting depth (lists, callouts, etc.)

## Scripts

### 1. `validate-html-to-notion-conversion.cjs` - Structural Validation

Validates a single HTML file against its Notion block conversion. **Focuses on element counts and types**, not content order or nesting depth.

**Usage:**
```bash
node scripts/validate-html-to-notion-conversion.cjs <html-file-path>
```

**Example:**
```bash
node scripts/validate-html-to-notion-conversion.cjs patch/pages-to-update/example.html
```

**Output:**
- HTML structure analysis (headings, lists, tables, images, etc.)
- Notion block structure analysis
- Side-by-side comparison
- Color-coded validation results
- Pass/warn/fail status

**Sample Output:**
```
================================================================================
HTML to Notion Conversion Validator
================================================================================

📄 File: example.html
📊 HTML size: 44.09 KB

📊 HTML Structure:
  • Headings: 1
  • Lists: 19
  • Tables: 2
  • Images: 15
  • Callouts: 24

📊 Notion Structure:
  • Headings: 1
  • List items: 59
  • Tables: 2
  • Images: 10
  • Callouts: 14

================================================================================
Validation Results
================================================================================

📋 Comparing Headings...
  ✅ Heading count matches: 1

📋 Comparing Tables...
  ✅ Table count matches: 2
  ✅ Table 1: 4 rows (matches)
  ✅ Table 2: 3 rows (matches)

================================================================================
Summary
================================================================================

✅ Passed:   6/8
⚠️  Warnings: 2/8
❌ Errors:   0/8

✅ VALIDATION PASSED
```

### 2. `batch-validate-conversions.cjs` - Batch Structural Validation

Validates multiple HTML files in a directory. Like script #1, **focuses on element counts and types**.

**Usage:**
```bash
node scripts/batch-validate-conversions.cjs <directory>
```

**Example:**
```bash
node scripts/batch-validate-conversions.cjs patch/pages-to-update
```

**Features:**
- Processes all `.html` files in directory
- Per-file validation summary
- Aggregate statistics
- Identifies problematic files
- Exports results to JSON (`validation-results.json`)

**Sample Output:**
```
================================================================================
Batch HTML to Notion Conversion Validator
================================================================================

📂 Directory: patch/pages-to-update
📊 Found 5 HTML files

[1/5] create-a-change-schedule.html
  ✅ PASS
     Passed: 8, Warnings: 0, Errors: 0

[2/5] improvement-integration.html
  ⚠️  WARN (1 errors)
     Passed: 7, Warnings: 1, Errors: 1

[3/5] onboard-github.html
  ✅ PASS
     Passed: 6, Warnings: 2, Errors: 0

================================================================================
Batch Validation Summary
================================================================================

Total files: 5
✅ Passed:   4
⚠️  Warnings: 1
❌ Failed:   0
🔥 Errors:   0

💾 Results exported to: patch/pages-to-update/validation-results.json

✅ ALL VALIDATIONS PASSED
```

### 3. `validate-content-order-and-nesting.cjs` - Deep Order & Nesting Validation

Validates that content appears in the correct order and at proper nesting depths. **Focuses on sequence preservation and structural integrity**.

**Usage:**
```bash
node scripts/validate-content-order-and-nesting.cjs <html-file-path>
```

**Example:**
```bash
node scripts/validate-content-order-and-nesting.cjs patch/pages-to-update/example.html
```

**What It Validates:**
- ✅ Content order preservation (blocks appear in correct sequence)
- ✅ List nesting depth accuracy (depth 0, 1, 2, etc.)
- ✅ Heading hierarchy
- ✅ Table positioning
- ✅ Position consistency across element types

**Sample Output:**
```
================================================================================
Content Order and Nesting Validator
================================================================================

📄 File: example.html

🔍 Extracting HTML content sequence...
  Found 43 elements

🔄 Converting to Notion blocks...
  Generated 38 blocks

🔍 Extracting Notion block sequence...
  Found 116 elements

🔍 Analyzing Content Order and Nesting...

📋 Heading Order:
  ✅ [1] Heading "Onboard GitHub to DevOps Change Velocity workspace" (order preserved)

📋 List Item Nesting:
  HTML list items: 19
  Notion list items: 59

  Checking first 5 items for nesting depth:
  ✅ [1] Depth 0: "Navigate to Workspaces > DevOp..."
  ✅ [2] Depth 0: "In the Tool name field, enter ..."
  ✅ [3] Depth 0: "Select Next...."
  ✅ [4] Depth 0: "Complete the connection and co..."
  ✅ [5] Depth 1: "In the Credential type field, ..."

  Max nesting depth - HTML: 1, Notion: 2

📋 Table Order:
  ✅ [1] Table with 4 rows (order preserved)

================================================================================
Validation Summary
================================================================================

📊 Order Validation:
  ✅ Matches: 1/1
  ❌ Mismatches: 0/1

📊 Nesting Validation:
  ✅ Matches: 5/5
  ❌ Mismatches: 0/5

================================================================================
✅ VALIDATION PASSED
Content order and nesting preserved correctly
```

**When to Use:**
- **Script #3 (this)**: When you need to verify content sequence and nesting depth
- **Scripts #1 & #2**: When you need to verify element counts and types

**Key Differences:**
| Validation | Script #1 & #2 | Script #3 |
|------------|---------------|-----------|
| Element counts | ✅ Yes | ❌ No |
| Block types | ✅ Yes | ❌ No |
| Content order | ❌ No | ✅ Yes |
| Nesting depth | ❌ No | ✅ Yes |
| Sequence validation | ❌ No | ✅ Yes |

## Validation Categories

### 1. Headings
- **Pass**: Count matches and levels preserved
- **Warn**: Count matches but levels differ (e.g., H5→H3)
- **Fail**: Count mismatch

### 2. Lists
- **Pass**: HTML lists converted to Notion list items
- **Warn**: Item count differs slightly (flattened nesting)
- **Fail**: No list items when lists expected

### 3. Tables
- **Pass**: Count matches, row counts match
- **Warn**: Count matches but row counts differ
- **Fail**: Count mismatch

### 4. Images
- **Pass**: Count matches exactly
- **Warn**: Count differs by 1-2 (duplicates filtered)
- **Fail**: Significant count mismatch

### 5. Code Blocks
- **Pass**: Count matches
- **Warn**: Count differs slightly
- **Fail**: Code blocks missing

### 6. Callouts
- **Pass**: Count matches
- **Warn**: Count differs (gray info callouts filtered)
- **Fail**: Significant count mismatch

### 7. Text Content
- **Pass**: Paragraph count similar (within ±2)
- **Warn**: Count differs moderately
- **Fail**: Significant difference

## Exported JSON Format

The `validation-results.json` file contains:

```json
{
  "timestamp": "2025-11-16T12:00:00.000Z",
  "directory": "patch/pages-to-update",
  "totalFiles": 5,
  "summary": {
    "pass": 4,
    "warn": 1,
    "fail": 0,
    "error": 0
  },
  "results": [
    {
      "file": "example.html",
      "status": "pass",
      "blockCount": 38,
      "comparison": {
        "passed": 6,
        "warnings": 2,
        "errors": 0,
        "details": [...]
      },
      "htmlStructure": {
        "headings": 1,
        "lists": 19,
        "tables": 2,
        "images": 15
      },
      "notionStructure": {
        "headings": 1,
        "lists": 59,
        "tables": 2,
        "images": 10
      }
    }
  ]
}
```

## Use Cases

### Pre-PATCH Validation

Validate files before running batch PATCH:

```bash
# Validate all files in pages-to-update
node scripts/batch-validate-conversions.cjs patch/pages-to-update

# Review validation-results.json for problematic files
cat patch/pages-to-update/validation-results.json | jq '.results[] | select(.status != "pass")'

# Only PATCH validated files
# (manually move problematic files out first)
```

### Post-Fix Testing

After fixing conversion logic (like tables in lists):

```bash
# Test specific problematic file
node scripts/validate-html-to-notion-conversion.cjs patch/pages-to-update/problematic-page.html

# Verify fix worked
# Expected: ✅ Tables count matches, table 1 has children
```

### Regression Testing

Validate a set of reference pages after code changes:

```bash
# Create test-fixtures directory with known-good pages
mkdir tests/fixtures/validation-tests
cp patch/pages-to-update/updated-pages/*.html tests/fixtures/validation-tests/

# Run validation
node scripts/batch-validate-conversions.cjs tests/fixtures/validation-tests

# Check for regressions
diff validation-results-baseline.json tests/fixtures/validation-tests/validation-results.json
```

## Known Discrepancies

Some differences are expected and acceptable:

### 1. List Flattening
- **HTML**: `<ol>` with nested `<ol>` counts as 2 lists
- **Notion**: Flattened to N `numbered_list_item` blocks
- **Status**: ⚠️ Warning (acceptable)

### 2. Duplicate Image Filtering
- **HTML**: 15 images (some duplicates)
- **Notion**: 10 images (duplicates filtered by URL)
- **Status**: ⚠️ Warning (acceptable)

### 3. Callout Filtering
- **HTML**: 24 callouts (includes gray info boxes)
- **Notion**: 14 callouts (gray boxes filtered out)
- **Status**: ⚠️ Warning (acceptable)

### 4. Heading Level Conversion
- **HTML**: H5 heading
- **Notion**: H3 heading (max level)
- **Status**: ⚠️ Warning (acceptable)

### 5. Text Block Consolidation
- **HTML**: 42 text blocks (many small `<p>` tags)
- **Notion**: 20 paragraphs (consolidated)
- **Status**: ⚠️ Warning (acceptable)

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All validations passed (or passed with minor warnings) |
| `1` | Validation failed (significant errors detected) |

## Integration with Existing Workflow

### Workflow 1: Validate Before PATCH

```bash
# 1. Move files to pages-to-update
mv patch/complete/*.html patch/pages-to-update/

# 2. Run batch validation
node scripts/batch-validate-conversions.cjs patch/pages-to-update

# 3. Review results
cat patch/pages-to-update/validation-results.json | jq '.summary'

# 4. Move problematic files to separate folder
# (based on validation results)

# 5. Run batch PATCH on validated files
cd patch/config && bash batch-patch-with-cooldown.sh
```

### Workflow 2: Test Specific Fix

```bash
# 1. Identify problematic file
# Example: tables missing from list items

# 2. Run validation
node scripts/validate-html-to-notion-conversion.cjs patch/pages-to-update/problem-page.html

# 3. Note specific errors
# Example: ❌ Table count mismatch: HTML=2, Notion=0

# 4. Fix conversion logic
# (edit server/services/servicenow.cjs)

# 5. Restart server
killall node && npm start

# 6. Re-run validation
node scripts/validate-html-to-notion-conversion.cjs patch/pages-to-update/problem-page.html

# 7. Verify fix
# Expected: ✅ Table count matches: 2
```

## Troubleshooting

### Server Not Running

```
❌ Server error: ECONNREFUSED
```

**Solution**: Start the proxy server:
```bash
npm start
```

### File Not Found

```
❌ File not found: path/to/file.html
```

**Solution**: Use absolute path or verify file exists:
```bash
ls -la path/to/file.html
node scripts/validate-html-to-notion-conversion.cjs "$(pwd)/path/to/file.html"
```

### No HTML Files

```
❌ No HTML files found in: directory
```

**Solution**: Verify directory contains `.html` files:
```bash
ls -la directory/*.html
```

## Future Enhancements

Possible improvements:

1. **Content Text Comparison**: Compare actual text content (not just counts)
2. **Block Order Validation**: Verify blocks appear in correct sequence
3. **Deep Nesting Analysis**: Validate 3+ level nesting orchestration
4. **Image URL Verification**: Check image sources match
5. **Table Content Validation**: Compare table cell contents
6. **Timing Statistics**: Track conversion time per file
7. **CI Integration**: Add to GitHub Actions workflow

## Related Documentation

- [FIX_TABLE_IN_LIST_NESTING.md](FIX_TABLE_IN_LIST_NESTING.md) - Table nesting fix that prompted validation tool
- [PATCH_WORKFLOW.md](patch-workflow.md) - PATCH operation workflow
- [TESTING_PLAN_v11.0.7.md](TESTING_PLAN_v11.0.7.md) - Comprehensive testing plan
