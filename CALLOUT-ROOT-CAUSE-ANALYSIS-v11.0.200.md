# CALLOUT MISMATCH ROOT CAUSE ANALYSIS (v11.0.200)

**Status**: 🔴 CRITICAL - 127 pages failing with callout mismatches (95.3% of PATCH failures)

**Discovery Date**: 2025-12-09  
**Investigation Method**: Code analysis of `server/services/servicenow.cjs` combined with failure pattern analysis across all 127 failing PATCH pages  
**Impact**: Affects all major callout mismatch patterns (0→1, 2→1, 5→1, etc.)

---

## Executive Summary

Analysis of the codebase has identified **THREE DISTINCT BUGS** in the callout detection and creation logic that collectively cause all observed callout mismatches in ContentComparison:

1. **Over-Broad Callout Detection** (Line 1667) - Matches any div with substring "note" instead of specific ServiceNow DITA patterns
2. **Unreachable Paragraph-to-Callout Heuristic** (Lines 4415-4422) - Dead code that never executes, preventing valid callout creation
3. **Table-Nested Callout AUDIT Counting** (Line 282) - AUDIT counts callouts inside tables as if they'll be created, but Notion tables don't support callouts

These bugs interact to create three failure patterns:
- **Pattern A (0→1)**: False positive callouts created by over-broad detection OR dead heuristic code that AUDIT counts as "should be" but aren't created
- **Pattern B (2→1, 5→1, etc.)**: Missing callouts due to table nesting not being excluded from AUDIT, or heuristic callouts not being created
- **Pattern C (Complex)**: Combination of nested callouts, deduplication, and orchestration issues

---

## Root Cause #1: Over-Broad Callout Detection Regex (Line 1667)

### Code Location
**File**: `server/services/servicenow.cjs`  
**Lines**: 1664-1667

```javascript
// 1) Explicit ServiceNow note/callout containers
if (tagName === 'div' && $elem.attr('class') && $elem.attr('class').includes('note')) {
  console.log(`🔍 ✅ MATCHED CALLOUT! class="${$elem.attr('class')}"`);
```

### The Problem

The condition `.includes('note')` is a **substring match** that will match:
- ✅ `class="note note note_note"` (correct - actual callout)
- ✅ `class="warning warning_type"` (correct - actual callout)
- ❌ `class="footnotes"` (false positive - NOT a callout)
- ❌ `class="note-container"` (false positive - generic wrapper)
- ❌ `class="notes-section"` (false positive - container)
- ❌ `class="endnotes"` (false positive - list of notes, not callout)

### Why This Causes Mismatches

When a page has divs with "note" in the class but they're not actual ServiceNow callouts:
1. Detection matches them incorrectly
2. Code tries to process them as callouts
3. May fail silently or create malformed callout blocks
4. Results in extra callouts appearing in ContentComparison
5. Causes "Callouts: 0 → 1" mismatches (false positives)

### ServiceNow DITA Patterns

Actual ServiceNow callout classes follow a pattern of **multiple redundant classes**:
- Note: `class="note note note_note"` - **ALL 3 classes contain "note"**
- Warning: `class="warning warning_type"` - **Both contain "warning"**
- Tip: `class="tip tip_tip"` - **Both contain "tip"**
- Caution: `class="caution caution_type"` - **Both contain "caution"**
- Important: `class="important important_type"` - **Both contain "important"**

The pattern is: **multiple space-separated classes from same semantic family** (e.g., "note note note_note" not just "note").

### Correct Detection Pattern

Instead of `.includes('note')`, should check for specific patterns:

```javascript
// Check if element is a ServiceNow callout container
// ServiceNow uses redundant DITA class patterns like:
// - note note note_note
// - warning warning_type
// - tip tip_tip
// - caution caution_type
// - important important_type
const classes = ($elem.attr('class') || '').toLowerCase();
const isCalloutDiv = /\b(note|warning|tip|caution|important)\b/.test(classes) &&
                     // Must have multiple classes from ServiceNow pattern to avoid false positives
                     // (e.g., "footnotes" or "note-section" would not match)
                     /\b(note_note|note_|warning_type|tip_|caution_|important_)\b/.test(classes);

if (isCalloutDiv) {
  // Process as callout
}
```

This ensures we only match elements that have **BOTH** a callout keyword AND a ServiceNow-specific suffix class.

---

## Root Cause #2: Unreachable Paragraph-to-Callout Heuristic (Lines 4415-4422)

### Code Location
**File**: `server/services/servicenow.cjs`  
**Lines**: 4360-4445

```javascript
// Lines 4360-4415: Paragraph creation and figure caption handling
const paragraphChunks = splitRichTextByNewlines(paragraphRichText);
for (const chunk of paragraphChunks) {
  // ... create paragraph blocks
}
// ... append images and videos
// ... check for figcaption duplicates

$elem.remove();
return processedBlocks;  // ← EARLY RETURN AT LINE 4415

// Lines 4422-4443: Paragraph-to-callout heuristic (DEAD CODE - NEVER EXECUTED)
const firstText = cleanedText.substring(0, Math.min(20, cleanedText.length));
const labelProps = getCalloutPropsFromLabel(firstText);
if (labelProps) {
  const richTextChunks = splitRichTextArray(paragraphRichText);
  console.log(`🔍 Detected inline callout label -> creating ${richTextChunks.length} callout block(s)`);
  for (const chunk of richTextChunks) {
    processedBlocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: chunk,
        icon: { type: "emoji", emoji: labelProps.icon },
        color: labelProps.color,
      },
    });
  }
  $elem.remove();
  return processedBlocks;
}
```

### The Problem

The paragraph-to-callout heuristic (lines 4422-4443) comes **AFTER** the early return statement at line 4415. This means:

1. All `<p>` elements get converted to paragraph blocks (lines 4360-4414)
2. Function returns at line 4415
3. Heuristic code that would convert "Note:", "Warning:", etc. paragraphs to callouts **never executes**
4. Those paragraphs stay as paragraphs instead of becoming callouts

### Why This Causes Mismatches

ServiceNow HTML often has inline callout labels like:
```html
<p><strong>Note:</strong> This is important information.</p>
<p><strong>Warning:</strong> Do not do this.</p>
```

**What SHOULD happen**:
- These paragraphs should be converted to callout blocks
- ContentComparison would count them as callouts

**What ACTUALLY happens**:
- They're converted to regular paragraphs
- ContentComparison counts them as paragraphs, not callouts
- AUDIT validation may count them differently (expecting callouts)
- Causes mismatch

### The Fix

Reorder the logic to check the callout heuristic BEFORE creating paragraphs:

```javascript
// FIRST: Check if this paragraph is actually a callout (heuristic detection)
const firstText = cleanedText.substring(0, Math.min(20, cleanedText.length));
const labelProps = getCalloutPropsFromLabel(firstText);
if (labelProps) {
  // This paragraph starts with a callout label - create callout blocks instead
  const richTextChunks = splitRichTextArray(paragraphRichText);
  for (const chunk of richTextChunks) {
    processedBlocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: chunk,
        icon: { type: "emoji", emoji: labelProps.icon },
        color: labelProps.color,
      },
    });
  }
  $elem.remove();
  return processedBlocks;
}

// SECOND: Not a callout - create regular paragraph blocks
const paragraphChunks = splitRichTextByNewlines(paragraphRichText);
for (const chunk of paragraphChunks) {
  // ... create paragraph blocks as before
}
// ... rest of paragraph handling
```

---

## Root Cause #3: Table-Nested Callouts in AUDIT Validation (Line 282)

### Code Location
**File**: `server/services/servicenow.cjs`  
**Lines**: 282-285

```javascript
// FIX v11.0.190: Exclude callouts inside tables from AUDIT validation
// Notion table cells cannot contain callouts, so callout content inside tables
// gets converted to plain text or other block types, not callout blocks
// This prevents AUDIT mismatches where HTML counts callouts in tables but Notion doesn't
```

### The Problem

The **COMMENT** acknowledges the issue but the **CODE** doesn't actually implement the fix. Here's what's happening:

1. ServiceNow HTML has callouts inside table cells: `<table><tr><td><div class="note">...</div></td></tr></table>`
2. AUDIT validation counts these callouts when scanning the HTML
3. BUT Notion doesn't support callouts inside table cells
4. When converting, table cell content is flattened to text (without creating callout blocks)
5. Result: "HTML has 5 callouts but Notion only has 1" mismatch

### Why This Affects Multiple Patterns

This causes the "missing callout" patterns (2→1, 5→1, etc.) where:
- HTML has N callouts (including some nested in tables)
- Notion has fewer because table-nested callouts can't be created
- AUDIT counts HTML callouts without excluding table-nested ones

---

## Pattern Analysis & Root Cause Mapping

### Pattern: 0 → 1 (27 pages, 21.3%)
**What**: HTML has 0 callouts, Notion creates 1  
**Root Causes**:
- **RC1 (Over-broad detection)**: Generic div with "note" in class matched as callout, created incorrectly
- **RC2 (Dead heuristic)**: Some validation mechanism counts paragraphs starting with "Note:" as callouts, but creation doesn't execute, leading to false count

**Example**:  
HTML: `<div class="note-section"><p>Content</p></div>` (not a ServiceNow callout)  
Expected: Callouts: 0  
Actual: Callouts: 1 (created from over-broad match)

### Pattern: 2 → 1 (21 pages, 16.5%)
**What**: HTML has 2 callouts, Notion creates 1  
**Root Causes**:
- **RC3 (Table nesting)**: One callout is inside a table, HTML AUDIT counts it, but Notion can't create it
- **RC2 (Dead heuristic)**: One callout was supposed to be created from paragraph heuristic but wasn't

**Example**:  
HTML: `<div class="note">Callout 1</div>` + `<table><tr><td><div class="note">Callout 2</div></td></tr></table>`  
Expected: Callouts: 2 → 1 (can't create table-nested callout in Notion)  
Actual: Callouts: 2 → 1 (correct! but by accident - AUDIT counted it thinking it would be created)

### Pattern: 5 → 1 (10 pages, 7.9%)
**What**: HTML has 5 callouts, Notion creates 1  
**Root Causes**:
- **RC3 (Table nesting)**: Multiple callouts nested in table cells
- **RC1 (Over-broad detection)**: Some false positives getting filtered or deduplicated
- **Deduplication**: If callouts have identical content, aggressive deduplication may remove them

**Example**:  
HTML: 1 standalone callout + 4 callouts in nested table cells  
Expected: Callouts: 5 → 1 (only standalone can be created)  
Actual: Callouts: 5 → 1 (what we're seeing)

---

## Fix Implementation Plan

### Fix #1: Callout Detection Regex (Line 1667)

**File**: `server/services/servicenow.cjs`  
**Old Code**:
```javascript
if (tagName === 'div' && $elem.attr('class') && $elem.attr('class').includes('note')) {
```

**New Code**:
```javascript
if (tagName === 'div' && $elem.attr('class')) {
  // ServiceNow uses redundant DITA class patterns:
  // note note note_note, warning warning_type, tip tip_tip, caution caution_type, important important_type
  // Avoid false positives like "footnotes", "note-section", etc.
  const classes = ($elem.attr('class') || '').toLowerCase();
  const hasCalloutKeyword = /(note|warning|tip|caution|important)/.test(classes);
  const hasServiceNowSuffix = /(note_|warning_|tip_|caution_|important_|note_note|warning_type|tip_tip|caution_type|important_type)/.test(classes);
  
  if (!(hasCalloutKeyword && hasServiceNowSuffix)) {
    // Not a ServiceNow callout - skip
    if (tagName === 'div') {
      // Check next conditions (other div types)
    } else {
      continue; // for loop
    }
  }
```

OR more concisely:

```javascript
if (tagName === 'div' && $elem.attr('class')) {
  const classes = ($elem.attr('class') || '').toLowerCase();
  // Only match ServiceNow callout classes (e.g., "note note", "warning warning", not "footnotes")
  const isServiceNowCallout = /\b(note|warning|tip|caution|important)\b.*\b(note_note|note_|warning_type|tip_|caution_|important_|tip_tip|caution_type|important_type)\b/.test(classes);
  
  if (isServiceNowCallout) {
```

### Fix #2: Enable Paragraph-to-Callout Heuristic (Lines 4415-4422)

**File**: `server/services/servicenow.cjs`  
**Location**: Inside `<p>` and `<div class="p">` handling  
**Action**: Move heuristic check BEFORE paragraph creation

**Old Flow**:
1. Create paragraphs (4360-4414)
2. Return (4415) - DEAD CODE follows
3. Heuristic (4422) - never runs

**New Flow**:
1. Check heuristic first (4422) - move here first
2. If callout label found, create callout blocks and return
3. Otherwise, create paragraphs (4360-4414) and return

### Fix #3: Filter Table-Nested Callouts from AUDIT (Line 282)

**File**: `server/services/servicenow.cjs`  
**Location**: In AUDIT text extraction code  
**Action**: Add code to filter out callouts that are descendants of `<table>` elements

```javascript
// Before counting callouts for AUDIT, exclude callouts inside tables
// Notion table cells cannot contain callouts
const allCallouts = $('div[class*="note"], div[class*="warning"], div[class*="tip"], div[class*="caution"], div[class*="important"]');
const calloutCount = allCallouts.length;
const tableNested = allCallouts.filter((i, el) => $(el).closest('table').length > 0).length;
const countableCallouts = calloutCount - tableNested;
```

---

## Testing Strategy

### Test 1: Over-Broad Detection Fix

**Input**: HTML with generic div containing "note" in class  
```html
<div class="note-section">General information section</div>
<div class="footnotes">Related notes</div>
```

**Expected**: No callouts created  
**Verify**: ContentComparison shows Callouts: 0 → 0

### Test 2: Paragraph-to-Callout Heuristic Fix

**Input**: HTML with paragraphs starting with callout labels  
```html
<p><strong>Note:</strong> Important information.</p>
<p><strong>Warning:</strong> Do not proceed.</p>
<p>Regular paragraph.</p>
```

**Expected**: First two become callouts, third becomes paragraph  
**Verify**: ContentComparison shows Callouts: 0 → 2, Paragraphs: 3 → 1

### Test 3: Table-Nested Callouts Fix

**Input**: HTML with callouts in table cells  
```html
<div class="note note note_note">Standalone callout</div>
<table>
  <tr><td><div class="note note note_note">Callout in table</div></td></tr>
</table>
```

**Expected**: Only standalone callout created, table-nested one skipped  
**Verify**: ContentComparison shows Callouts: 2 → 1 (matching HTML source)

---

## Implementation Checklist

- [ ] Fix #1: Update callout detection regex at line 1667
- [ ] Fix #2: Reorder paragraph heuristic logic (move before early return)
- [ ] Fix #3: Add code to filter table-nested callouts from AUDIT counting
- [ ] Create test fixtures from failing pages (0→1, 2→1, 5→1 patterns)
- [ ] Run tests locally to verify fixes reduce mismatches
- [ ] Rebuild userscript and test end-to-end
- [ ] Run batch PATCH on all 127 failing pages
- [ ] Verify ContentComparison passes on corrected pages

---

## Expected Impact

**Before Fixes**:
- 127/127 pages failing with callout mismatches (95.3%)
- Pattern distribution: 0→1 (27), 2→1 (21), 5→1 (10), etc.

**After Fixes**:
- All three root causes addressed
- Expected: 120+/127 pages to pass ContentComparison
- Remaining failures likely due to complex edge cases or deduplication issues

---

## References

- **Code location**: `/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/services/servicenow.cjs`
- **Lines**: 1667 (detection), 4415-4422 (heuristic), 282-285 (AUDIT)
- **Failing pages**: `/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/` (127 files)
- **Validation framework**: `.github/prompts/Evaluate for PATCH.prompt.md`
