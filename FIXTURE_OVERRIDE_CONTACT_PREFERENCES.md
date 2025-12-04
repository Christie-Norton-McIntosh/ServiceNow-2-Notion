# Test Fixture Added: Override Contact Preferences (Duplication Issue)

## Summary
Added page with **confirmed duplication and order issues** to test fixtures for regression testing and debugging.

## Page Details
- **Title**: Override contact preferences for a shift
- **Source**: ServiceNow IT Service Management documentation
- **Page ID**: `2bfa89fe-dba5-8119-8c92-d7fcde2546e3`
- **Fixture Path**: `tests/fixtures/override-contact-preferences-duplication-order-issue.html`
- **Test Script**: `tests/test-override-contact-preferences-duplication.cjs`

## Confirmed Issues

### 1. ✅ Callout Duplication (CONFIRMED)
**Issue**: The callout "Note: SMS and voice require that Notify is active." appears **TWICE** in the output.

**Location**: Both duplicates are nested inside `numbered_list_item[5]` as children:
- `numbered_list_item[5] → callout[1]`
- `numbered_list_item[5] → callout[2]`

**Expected**: Should appear only ONCE in the source HTML.

**Test Output**:
```
2️⃣  CALLOUTS DETECTED:
   Total callouts: 3
   [1] Depth 0: "Before you begin Role required: rota_admin , rota_manager"
   [2] Depth 1: "Note: SMS and voice require that Notify is active."
   [3] Depth 1: "Note: SMS and voice require that Notify is active."

   ⚠️  DUPLICATES FOUND:
      "Note: SMS and voice require that Notify is active."
```

### 2. ✅ Order Issue (REPORTED)
**Issue**: According to validation metadata, a callout appears at position 14 when it should be at position 20.

**Details from Validation**:
- Callout is appearing BEFORE a list item about "Mobile push"
- Should appear AFTER that list item
- htmlOrder: [21, 22]
- notionOrder: [20, 14]

### 3. ✅ Character Loss (43%)
**Issue**: Significant content loss from HTML to Notion.

**Numbers**:
- Source HTML: 2,799 characters
- Notion Output: 1,589 characters
- **Missing: 1,210 characters (43% loss)**

### 4. ❓ Validation Passing Despite Issues
**Paradox**: Page reports 100% similarity but has clear problems:
- ✅ 100% similarity score
- ❌ Has order issues (1 detected)
- ❌ Has content duplication
- ❌ Has 43% character loss

## Block Structure Analysis

### Top-Level Blocks (7 total):
```
[0] paragraph                 "Override all shift members' contact preferences..."
[1] callout                   "Before you begin Role required: rota_admin..."
[2] paragraph                 "Procedure"
[3] numbered_list_item        "Use one of the following methods..."
[4] numbered_list_item        "On the Contact Preferences tab..."
[5] numbered_list_item        "Select the contact methods..." ← CONTAINS DUPLICATES
[6] numbered_list_item        "Enable the Override user preference..."
```

### Block Type Counts:
- bulleted_list_item: 14
- numbered_list_item: 10
- paragraph: 4
- callout: 3 (expected 2, has 1 duplicate)
- image: 1

## Root Cause Investigation Needed

### Hypothesis 1: List Item Processing Issue
The duplicated callouts are both children of the same numbered list item (#5). This suggests:
- The list item processing code may be duplicating certain child blocks
- Could be related to how nested content is extracted from list items
- May be specific to callouts nested in list items with multiple children

### Hypothesis 2: HTML Structure Pattern
Source HTML shows:
```html
<li class="li step stepexpand">
  <span class="ph cmd">Select the contact methods...</span>
  <div class="itemgroup info">Depending on your instance configuration...
    <ul class="ul">
      <!-- Multiple list items including "Mobile push" -->
    </ul>
    <div class="note note note_note">
      <span class="note__title">Note:</span> SMS and voice require...
    </div>
  </div>
</li>
```

The `<div class="itemgroup info">` contains both:
1. A nested `<ul>` with multiple list items
2. A callout note

This structure might be processed multiple times or incorrectly.

### Hypothesis 3: Callout Detection Logic
The callout has class `note_note` (with underscore). Our regex patterns were fixed in v11.0.0 to handle underscores, but there may still be edge cases with:
- Nested callouts in complex list structures
- Multiple passes through the same content
- Incorrect parent-child relationships

## Testing Strategy

### Automated Test
Run: `node tests/test-override-contact-preferences-duplication.cjs`

**Expected Output**:
- Detects 2 occurrences of "SMS and voice require"
- Shows both at depth 1 (nested)
- Both as children of same numbered_list_item

### Manual Verification
1. View the Notion page: `https://www.notion.so/2bfa89fedba581198c92d7fcde2546e3`
2. Check the third numbered step ("Select the contact methods...")
3. Look for duplicate callouts in that section

### Fix Verification
After implementing fix:
1. Re-run test: Should show only 1 occurrence
2. Check block structure: Should have 2 callouts total (not 3)
3. Validate order: Callout should be in correct position
4. Check character count: Should reduce the 43% loss

## Files Added/Modified

### Added:
1. `tests/fixtures/override-contact-preferences-duplication-order-issue.html` (10KB)
   - Source HTML with metadata
   - Includes validation results showing issues

2. `tests/test-override-contact-preferences-duplication.cjs` (250 lines)
   - Automated test script
   - Analyzes block structure
   - Detects duplicates
   - Outputs detailed JSON report

### Output:
- `output/override-contact-preferences-analysis.json`
  - Full block structure
  - Duplicate locations
  - Search results
  - Complete analysis data

## Next Steps

1. **Investigate list item processing** in `server/services/servicenow.cjs`
   - Look for code that processes `<li class="li step stepexpand">`
   - Check how `<div class="itemgroup info">` is handled
   - Verify callout extraction doesn't run multiple times

2. **Check for double-processing**
   - Search for any loops or recursion that might process the same callout twice
   - Look for duplicate calls to callout extraction functions

3. **Fix and verify**
   - Apply fix to prevent duplication
   - Re-run test to confirm only 1 callout
   - Verify order is correct
   - Check if character loss is reduced

4. **Add regression test**
   - Keep this fixture in test suite
   - Add assertion: `calloutCount === 2` (not 3)
   - Add assertion: No duplicate text in callouts

## Impact
- ✅ Reproducible test case for duplication bug
- ✅ Documented structure and patterns
- ✅ Automated detection of the issue
- ✅ Foundation for fix verification

## Version
- **Added in**: v11.0.111
- **Date**: December 3, 2025
- **Status**: Ready for debugging and fix implementation
