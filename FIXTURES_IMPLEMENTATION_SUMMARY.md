# Test Fixtures System - Implementation Summary

## Overview

A comprehensive test fixtures system has been implemented to automatically capture and test HTML samples from ServiceNow pages that fail validation. This enables regression testing and debugging of conversion issues.

## What Was Created

### 1. Directory Structure
```
tests/fixtures/
├── README.md                           # Comprehensive documentation
├── validation-failures/                # Auto-captured failures
│   └── [page-title]-[timestamp].html  # Automatically saved on validation error
└── manual-samples/                     # Manually curated test cases
    └── add-or-modify-risk-conditions.html  # Example baseline test
```

### 2. Automatic Capture System

**Location**: `server/routes/w2n.cjs` (lines ~859-895)

**Trigger**: Automatically saves HTML when `validationResult.hasErrors` is true

**Filename Format**: `[sanitized-title]-[ISO-timestamp].html`
- Example: `add-or-modify-risk-conditions-2025-11-09T14-30-45.html`

**Metadata Included** (as HTML comment):
```html
<!--
  Page: Add or modify risk conditions
  URL: https://docs.servicenow.com/.../define-risk-and-impact-conditions.html
  Captured: 2025-11-09T14:30:45.123Z
  Validation Errors: Marker leak: 2 visible sn2n:marker tokens found
  Warnings: Block count high: 18 > 15
  Page ID: abc123-def456...
  Block Count (expected): 13
  Block Count (actual): 18
-->
```

**Environment Variables**:
- `SN2N_SAVE_VALIDATION_FAILURES` - Set to `false` or `0` to disable (default: enabled)
- `SN2N_FIXTURES_DIR` - Custom directory path (default: `tests/fixtures/validation-failures`)

### 3. Test Fixture Runner

**Script**: `tests/test-fixture.cjs`

**Usage**:
```bash
# Test a single fixture
node tests/test-fixture.cjs tests/fixtures/manual-samples/add-or-modify-risk-conditions.html

# Test all fixtures in a directory
for f in tests/fixtures/validation-failures/*.html; do 
  node tests/test-fixture.cjs "$f"
done
```

**Features**:
- Parses metadata from HTML comments
- Sends HTML to proxy server in dryRun mode
- Displays conversion results with color-coded output
- Compares expected vs actual block counts
- Shows block type summary and first 5 blocks
- Detects videos, warnings, and errors

**Output Example**:
```
================================================================================
Test Fixture Runner
================================================================================

📋 Fixture Metadata:
   Page: Add or modify risk conditions
   URL: https://docs.servicenow.com/...
   Expected Blocks: 16 (after Related Content fix)

📊 HTML length: 14771 characters
📊 Contains 2 table(s)
📊 Contains 1 ordered list(s)

🚀 Sending to proxy server (dryRun mode)...

✅ Conversion successful!
📦 Generated 16 blocks

📋 Block Summary:
   bulleted_list_item: 3
   callout: 1
   heading_3: 1
   numbered_list_item: 4
   paragraph: 7

📊 Block Count Comparison:
   Expected: 16
   Actual: 16
   Difference: 0

================================================================================
Test Complete
================================================================================
```

### 4. Documentation

**File**: `tests/fixtures/README.md`

Comprehensive documentation covering:
- Directory structure and purpose
- Automatic capture system
- Manual sample creation
- Test fixture runner usage
- Best practices for fixture management
- Configuration options
- Example metadata format

### 5. Git Configuration

**Updated**: `.gitignore`

Added rule to ignore auto-captured validation failures while keeping manual samples in version control:
```
# Test fixtures - auto-captured validation failures (can be large)
tests/fixtures/validation-failures/*.html
```

Manual samples in `tests/fixtures/manual-samples/` ARE tracked in git.

## How It Works

### Automatic Capture Flow

1. **Page Conversion**: User exports page from ServiceNow → userscript sends HTML to proxy
2. **Validation**: Server converts HTML to blocks and validates the result
3. **Error Detection**: If `validationResult.hasErrors` is true
4. **Auto-Save**: Server writes HTML with metadata to `tests/fixtures/validation-failures/`
5. **Logging**: Server logs the saved filename for reference

### Testing Flow

1. **Run Test**: Execute `node tests/test-fixture.cjs <file.html>`
2. **Parse Metadata**: Script extracts metadata from HTML comment
3. **Send to Server**: Makes POST request to `/api/W2N` with `dryRun: true`
4. **Display Results**: Shows conversion results, block summary, and comparison
5. **Exit**: Returns exit code 0 (success) or 1 (failure)

## Benefits

### 1. Regression Testing
- Automatically build test suite from real-world failures
- Run all fixtures before releases to catch regressions
- Compare results across code changes

### 2. Debugging
- Isolated HTML samples for reproducing issues
- Complete context including page title, URL, and error details
- No need to manually save HTML from browser

### 3. Documentation
- Examples of problematic HTML structures
- Historical record of fixed issues
- Training data for new edge cases

### 4. Development Workflow
```bash
# 1. User reports validation error
# 2. HTML automatically saved to fixtures/validation-failures/
# 3. Developer runs fixture test
node tests/test-fixture.cjs tests/fixtures/validation-failures/problem-page-2025-11-09.html

# 4. Developer makes fix to server code
# 5. Re-run fixture to verify fix
node tests/test-fixture.cjs tests/fixtures/validation-failures/problem-page-2025-11-09.html

# 6. If fixed, move to manual-samples for regression testing
mv tests/fixtures/validation-failures/problem-page-2025-11-09.html \
   tests/fixtures/manual-samples/problem-case-tables-with-markers.html
```

## Current HTML Logging Options

### Console Logs (Currently Available)

**Client-Side** (`src/main.js`):
- Line 604-608: HTML length, sections, first/last 500 chars
- Line 728: `window.DEBUG_LAST_EXPORT_HTML` - Full HTML saved to global variable
- Line 755: Debug logging for specific OL/LI structures

**Server-Side** (`server/routes/w2n.cjs`):
- Line 23: `validateNotionPage` imports validation utility
- Line 826-837: Validation execution with source HTML
- **NEW** Line 859-895: Auto-capture HTML to fixtures on validation failure

**Server Logs** (`server/logs/`):
- Existing: `notion-payload-*.json` - Block structure dumps
- Existing: `target-ol-*.html` - Specific OL extractions for debugging

### Recommendation: Use Automatic Capture

**YES** - The automatic capture system is the best approach because:

1. **Zero Manual Effort**: No need to copy/paste HTML from console
2. **Complete Context**: Metadata includes page title, URL, errors, timestamps
3. **Standardized Format**: Consistent filename and metadata structure
4. **Git-Friendly**: Auto-ignored in `.gitignore`, selective manual tracking
5. **Test-Ready**: Works directly with test-fixture.cjs runner
6. **Production-Safe**: Only triggers on validation errors, not every page

**Use Console Logs For**:
- Quick debugging during development
- Inspecting HTML before sending to server
- Checking specific DOM structures in browser

**Use Auto-Capture For**:
- Building regression test suite
- Documenting and reproducing validation failures
- Long-term testing and continuous integration

## Future Enhancements

### Potential Additions

1. **Batch Test Runner**: `npm run test:fixtures` to run all fixtures
2. **CI Integration**: Add to GitHub Actions to run on every commit
3. **Comparison Tool**: Compare output before/after code changes
4. **Fixture Generator**: CLI tool to capture HTML from live URLs
5. **Assertion Framework**: Define expected outputs for automated pass/fail

### Example npm Scripts (Add to package.json)
```json
{
  "scripts": {
    "test:fixture": "node tests/test-fixture.cjs",
    "test:fixtures:all": "for f in tests/fixtures/manual-samples/*.html; do node tests/test-fixture.cjs \"$f\"; done",
    "test:fixtures:failures": "for f in tests/fixtures/validation-failures/*.html; do node tests/test-fixture.cjs \"$f\"; done"
  }
}
```

## Configuration Reference

### Server Environment Variables

```bash
# Enable validation (already available)
SN2N_VALIDATE_OUTPUT=1

# Enable auto-capture on validation failures (default: enabled)
SN2N_SAVE_VALIDATION_FAILURES=1

# Custom fixtures directory
SN2N_FIXTURES_DIR=/path/to/custom/fixtures

# Verbose logging
SN2N_VERBOSE=1
```

### Testing Without Creating Pages

Always use `dryRun: true` in the payload when testing fixtures to avoid creating actual Notion pages.

## Files Modified/Created

### Created
- `tests/fixtures/README.md` - Comprehensive documentation
- `tests/fixtures/validation-failures/` - Auto-capture directory
- `tests/fixtures/manual-samples/` - Manual test cases directory
- `tests/fixtures/manual-samples/add-or-modify-risk-conditions.html` - Example baseline
- `tests/test-fixture.cjs` - Fixture test runner script

### Modified
- `server/routes/w2n.cjs` - Added auto-capture logic (lines ~859-895)
- `.gitignore` - Added rule to ignore auto-captured files

## Summary

The test fixtures system provides a robust, automated way to:
- Capture problematic HTML samples when validation fails
- Test HTML samples through the conversion pipeline
- Build a regression test suite from real-world cases
- Debug and reproduce validation issues efficiently

The automatic capture is **production-ready** and **enabled by default**, requiring zero configuration. Simply enable validation (`SN2N_VALIDATE_OUTPUT=1`) and any page that fails validation will automatically save its HTML for future testing.
