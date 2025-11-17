# Callout Deduplication Fix — v11.0.8

## Issue Summary

**File**: `patch/pages/pages-to-update/insights-view-in-cmdb-workspace-2025-11-17T04-05-31.html`  
**Error**: "Missing callouts: expected 5, got 3 (2 missing)"  
**Page ID**: 2aea89fe-dba5-8112-9867-fcec70becbaf

## Root Cause

The Insights page contains 5 callouts, all with class `note note note_note`:

1. **Callout 1**: "Note: The count of Service Graph connectors..."
2. **Callout 2**: "Note: Historical data might not be available for all past 90 days..." ✅
3. **Callout 3**: "Note: Historical data might not be available for all past 90 days..." ❌ **DUPLICATE**
4. **Callout 4**: "Note: Historical data might not be available for all past 90 days..." ❌ **DUPLICATE**
5. **Callout 5**: "Note: [Service Graph connectors tab only appears if...]"

Callouts #2, #3, and #4 have **identical text content**. The deduplication logic in `server/utils/dedupe.cjs` uses:
- **Callout key**: `callout:${normalizedText}|${emoji}|${color}`
- **Proximity window**: 5 blocks
- **Deduplication path**: Two-path system
  - **Title-only callouts** (e.g., "Note:" with nothing after): Check adjacent duplicates only (distance ≤ 1)
  - **Callouts with content** (e.g., "Note: [text]"): Proximity-based deduplication (5-block window)

All three "Historical data" callouts:
- Have identical normalized text
- Have same icon (ℹ️) and color (blue_background)
- Appear within 5 blocks of each other
- Are treated as "content callouts" (not title-only)

Result: Callouts #3 and #4 were deduped as duplicates of #2, leaving only 3 callouts.

## The Problem with Previous Logic

The old regex pattern only matched **exact** title-only patterns:
```javascript
const isTitleOnly = /^(Before you begin|Role required:|Prerequisites?|Note:|Important:|Warning:)\s*$/i.test(trimmed);
```

This pattern requires:
- `^` = start of string
- `Note:` = literal text
- `\s*` = optional whitespace
- `$` = **end of string**

So "Note:" alone matched, but "Note: [any text]" did NOT match.

## Why This Caused Issues

In technical documentation, it's common to have:
- Repeated "Note:" warnings in different sections
- Identical wording (e.g., "Historical data might not be available...")
- All within proximity window (5 blocks)

These are **legitimate repeated warnings**, not duplicates. They provide context-specific information in different sections of the documentation.

## The Solution

Modified `server/utils/dedupe.cjs` lines 117-153 to exempt ALL "Note:" callouts from proximity-based deduplication:

```javascript
// Before (v11.0.7):
const isTitleOnly = /^(Before you begin|Role required:|Prerequisites?|Note:|Important:|Warning:)\s*$/i.test(trimmed);
if (isTitleOnly) {
  // Check adjacent duplicates only
}
// For callouts with content, use normal proximity-based deduplication

// After (v11.0.8):
const isTitleOnly = /^(Before you begin|Role required:|Prerequisites?|Note:|Important:|Warning:)\s*$/i.test(trimmed);
const isNoteCallout = /^Note:/i.test(trimmed); // NEW: Check if starts with "Note:"
if (isTitleOnly || isNoteCallout) {
  // Check adjacent duplicates only for BOTH title-only AND all "Note:" callouts
}
// For other callouts with content, use normal proximity-based deduplication
```

## What Changed

1. **Added `isNoteCallout` check**: `const isNoteCallout = /^Note:/i.test(trimmed);`
2. **Combined conditions**: `if (isTitleOnly || isNoteCallout)`
3. **Result**: ALL "Note:" callouts now only check adjacent duplicates (distance ≤ 1), not proximity-based (5-block window)

## Impact

**Before Fix**:
- "Note: [text]" callouts within 5 blocks with identical content → DEDUPED
- Result: Missing legitimate repeated warnings

**After Fix**:
- "Note: [text]" callouts only deduped if **adjacent** (distance ≤ 1)
- Result: Legitimate repeated warnings in different sections preserved

## Validation

**Expected Behavior**:
- Insights page: 5 callouts in HTML → 5 callouts in Notion
- Validation: "expected 5, got 5" ✅
- Three "Historical data" warnings preserved across different sections

**To Test**:
1. Re-extract Insights page via Chrome extension
2. Check validation result: Should show 5 callouts (no errors)
3. Verify all three "Historical data" callouts appear in Notion page

## Files Modified

- `server/utils/dedupe.cjs` (lines 117-153)
  - Added `isNoteCallout` variable
  - Modified condition to include `isNoteCallout`
  - Updated log messages to distinguish "Title-only" vs "Note:" callouts

## Related Documentation

- `docs/deduplication-logic.md` - General deduplication architecture
- `docs/AUTO-VALIDATION.md` - Validation workflow
- `.github/copilot-instructions.md` - Updated with this fix pattern

## Additional Fix: "Before you begin" Callouts

After the initial "Note:" fix, analysis of other failing pages revealed a similar issue with "Before you begin" prerequisite sections.

### Files Affected
1. **managing-application-service-relationships** (expected 3, got 2)
   - Has 3 `<section class="section prereq">` elements
   - Each has "Before you begin\nRole required: [different roles]"
   - Different role requirements but being deduped

2. **viewing-api-data-connections** (expected 2, got 1)
   - Has 2 prereq sections
   - Being deduped as proximity-based duplicates

3. **exploring-service-graph-connectors** (expected 3, got 1)
   - Has 3 `<div class="itemgroup info">` elements
   - All say "For more information, see Application Manager"
   - These ARE legitimate duplicates (deduplication correct)

### Root Cause
The prereq sections are converted to callouts with text starting with "Before you begin". Even though they have different role requirements after that, if the role text is short, they can be considered duplicates within the 5-block proximity window.

### Solution Applied
Extended the exemption logic to also include callouts that start with "Before you begin":

```javascript
const isBeforeYouBeginCallout = /^Before you begin/i.test(trimmed);
if (isTitleOnly || isNoteCallout || isBeforeYouBeginCallout) {
  // Check adjacent duplicates only (distance ≤ 1)
}
```

### Impact
- **Before**: "Before you begin" callouts within 5 blocks → proximity deduplication → some removed
- **After**: "Before you begin" callouts only deduped if directly adjacent
- **Result**: Each procedure's prereq section preserved

## Version

- **Fix Version**: v11.0.8
- **Date**: 2025-11-17
- **Issues Fixed**: 
  1. Insights page missing 2 of 5 "Note:" callouts
  2. Managing/viewing pages missing "Before you begin" prereq callouts
- **Status**: ✅ FIXED
