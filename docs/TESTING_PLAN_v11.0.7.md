# Testing Plan for v11.0.7 Marker Preservation Fix

## Overview
The v11.0.7 fix addresses a systemic marker overwriting bug that affected any block type at depth >= 2. This testing plan ensures the fix works correctly across all affected scenarios.

## Background
**Issue**: When `enforceNestingDepthLimit()` stripped children from depth-2 blocks, those children were added to parent's `markedBlocks` array. If they already had `_sn2n_marker` from nested processing, the parent would overwrite it, causing blocks to be orchestrated to wrong parents.

**Fix**: Check if blocks already have `_sn2n_marker` before assigning new one, preserving original parent associations.

**Scope**: Affects ALL block types (images, paragraphs, tables, code, callouts) in 7 processing locations.

---

## Test Scenarios

### 1. ✅ VERIFIED: Inline Images in Nested Lists (Original Issue)
**Status**: ✅ Confirmed working

**Test Case**: "Add a document to a contract" page
- Nested numbered list items with inline images
- Images appear in `<p>` tags within `<li>` items

**Expected Result**:
```
3. Add a document to the contract.
   - If you are using the core UI...
     1. Click the Manage Attachments icon... [IMAGE HERE]
     2. In the Attachments dialog box...
   - If you are using Hardware Asset Workspace...
     1. Click the Attachment icon... [IMAGE HERE]
     2. In the Attachments window...
```

**Verification**: Run `verify-page-structure.cjs` script
**Result**: ✅ Images correctly nested under specific numbered_list_items

---

### 2. ⚠️ TODO: Multiple Images in Same Nested Item
**Test Case**: List item with multiple inline images
```html
<ol>
  <li>
    <ul>
      <li>
        <ol>
          <li>
            <p>Click icon1 <img src="..."> then icon2 <img src="..."> to proceed</p>
          </li>
        </ol>
      </li>
    </ul>
  </li>
</ol>
```

**Expected Result**: Both images as children of the same numbered_list_item

**How to Test**:
1. Find ServiceNow page with multiple inline images in single list item
2. Extract and verify both images appear as children
3. Check markers with: `grep "sn2n:" logs/notion-payload-*.json`

**Look for**: Both images should have SAME marker token

---

### 3. ⚠️ TODO: Nested Tables in Lists
**Test Case**: Table within a nested list item
```html
<ol>
  <li>Step 1
    <ul>
      <li>Option A
        <ol>
          <li>
            <table>...</table>
          </li>
        </ol>
      </li>
    </ul>
  </li>
</ol>
```

**Expected Result**: Table orchestrated to correct nested list item, not parent

**How to Test**:
1. Find ServiceNow page with tables in nested procedures
2. Extract and verify table appears under correct step
3. Check marker logs: `grep -A 2 "table" logs/notion-payload-*.json | grep "sn2n:"`

**Look for**: `[MARKER-PRESERVE-OL]` or `[MARKER-PRESERVE-UL]` logs showing table marker preserved

---

### 4. ⚠️ TODO: Nested Callouts
**Test Case**: Callout (note/warning) within nested list
```html
<ol>
  <li>Configure settings
    <ul>
      <li>Advanced options
        <div class="note">
          <p>Important: Check prerequisites</p>
          <ul>
            <li>Requirement 1</li>
            <li>Requirement 2</li>
          </ul>
        </div>
      </li>
    </ul>
  </li>
</ol>
```

**Expected Result**: Callout with nested list appears under "Advanced options"

**How to Test**:
1. Find page with notes/warnings in nested procedures
2. Verify callout positioning in final page
3. Check if callout's nested list maintains structure

**Look for**: `[MARKER-PRESERVE-CALLOUT]` logs

---

### 5. ⚠️ TODO: Code Blocks in Nested Lists
**Test Case**: Code snippet within nested procedure step
```html
<ol>
  <li>Execute command
    <ul>
      <li>For Windows users
        <pre><code>npm install</code></pre>
      </li>
    </ul>
  </li>
</ol>
```

**Expected Result**: Code block appears under "For Windows users"

**How to Test**:
1. Find technical documentation with code examples in steps
2. Verify code block placement
3. Check syntax: code blocks should be immediate children or orchestrated correctly

---

### 6. ⚠️ TODO: Mixed Content at Same Depth
**Test Case**: Multiple different block types at same nesting level
```html
<ol>
  <li>Complete setup
    <ul>
      <li>Advanced configuration
        <ol>
          <li>
            <p>Step with image <img src="..."></p>
          </li>
          <li>
            <table>...</table>
          </li>
          <li>
            <div class="note">Important note</div>
          </li>
        </ol>
      </li>
    </ul>
  </li>
</ol>
```

**Expected Result**: All blocks (image, table, callout) correctly nested under their respective steps

**How to Test**:
1. Find complex procedure with varied content types
2. Verify each block appears under correct parent
3. Check marker map: `jq '.markerMap' logs/orchestration-debug-*.json` (if logged)

**Look for**: Multiple `[MARKER-PRESERVE-*]` logs showing different block types preserved

---

### 7. ⚠️ TODO: Paragraph Promotion with Complex Content
**Test Case**: Paragraph with multiple elements promoted to list item text
```html
<ol>
  <li>
    <p>Main text with <img src="icon.png"> and <strong>formatting</strong></p>
    <p>Additional paragraph</p>
  </li>
</ol>
```

**Expected Result**: 
- First paragraph text becomes list item text
- Image appears as child of list item
- Second paragraph orchestrated as child

**How to Test**:
1. Find list items with multiple paragraphs and images
2. Verify first paragraph is promoted, rest are children
3. Check for `[IMAGE-INLINE-FIX-V2]` logs

---

### 8. ⚠️ TODO: Bulleted Lists (UL) Scenarios
**Test Case**: Same nesting scenarios but with bulleted lists instead of numbered

**Why Important**: We fixed both UL and OL processing separately - need to verify both

**How to Test**: Repeat scenarios 1-7 but look for bulleted list examples in ServiceNow docs

**Look for**: `[MARKER-PRESERVE-UL*]` logs instead of `[MARKER-PRESERVE-OL*]`

---

### 9. ⚠️ TODO: Prereq/Related Content Callouts
**Test Case**: "Before you begin" sections with nested content
```html
<div class="prereq">
  <p>Before you begin</p>
  <ul>
    <li>Requirement 1
      <ul>
        <li>Sub-requirement with <img src="..."></li>
      </ul>
    </li>
  </ul>
</div>
```

**Expected Result**: Nested image in sub-requirement correctly placed

**How to Test**:
1. Find pages with "Before you begin" sections containing nested lists
2. Verify nested content structure preserved
3. Check for `[MARKER-PRESERVE-PREREQ]` logs

---

## Regression Testing

### Known Good Pages to Re-test
These pages worked before and should still work:

1. **Simple lists without nesting** - no markers involved
2. **Shallow nesting (depth 1)** - no orchestration needed
3. **Tables at root level** - direct children, no markers
4. **Callouts with simple content** - basic marker usage

**How to Test**: Re-extract these pages and verify structure unchanged

---

## Automated Testing Strategy

### Log Pattern Verification
After each extraction, check logs for:

```bash
# Count preserved markers by type
grep -c "MARKER-PRESERVE-UL]" logs/*.log
grep -c "MARKER-PRESERVE-OL]" logs/*.log  
grep -c "MARKER-PRESERVE-CALLOUT]" logs/*.log

# Check for marker overwrites (should be 0)
grep "Overwriting marker" logs/*.log

# Verify orchestration success
grep "Orchestrator: Found parent" logs/*.log
grep "Orchestrator: appended" logs/*.log
```

### Validation Checks
After orchestration, verify:
- No orphaned blocks (blocks with markers that weren't found)
- No marker leaks (marker tokens visible in final page)
- Block counts match expectations

---

## Priority Testing Order

1. **HIGH PRIORITY** (affects common content):
   - ✅ Inline images in nested lists (VERIFIED)
   - ⚠️ Multiple images in same item
   - ⚠️ Nested tables
   - ⚠️ Mixed content scenarios

2. **MEDIUM PRIORITY** (less common but important):
   - ⚠️ Nested callouts
   - ⚠️ Code blocks in lists
   - ⚠️ Prereq sections with nesting

3. **LOW PRIORITY** (edge cases):
   - ⚠️ 4+ levels of nesting (should be flattened but markers preserved)
   - ⚠️ Empty list items with only nested content
   - ⚠️ Malformed HTML edge cases

---

## Success Criteria

For each test scenario, verify:

1. ✅ **Correct Placement**: Block appears under intended parent
2. ✅ **Marker Preservation**: `[MARKER-PRESERVE-*]` log appears if block had existing marker
3. ✅ **No Marker Leaks**: `(sn2n:xxxxx)` tokens removed from final page
4. ✅ **Structure Integrity**: Nested relationships maintained
5. ✅ **Validation Passes**: No errors in validation summary

---

## Testing Tools

### 1. Page Structure Verifier
```bash
node server/scripts/verify-page-structure.cjs <page-id>
```
Shows hierarchical structure of created page

### 2. Payload Inspector
```bash
# Check markers in initial payload
jq '.. | objects | select(has("rich_text")) | select(.rich_text[] | .text?.content? | test("\\(sn2n:"))' logs/notion-payload-*.json

# Count block types
jq '.blockTypes' logs/notion-payload-*.json
```

### 3. Log Analysis
```bash
# Find specific marker orchestration
grep -A 10 "mhthguz5-8od1tp" server/logs/*.log

# Check for preservation logs
grep "MARKER-PRESERVE" server/logs/*.log | tail -20
```

---

## Known Limitations

1. **Notion's depth limit**: Even with correct markers, Notion enforces 2-level nesting in initial create
2. **API rate limits**: Testing many pages quickly may hit rate limits (use delays)
3. **Image download**: Large images may timeout during upload

---

## Reporting Issues

If a test fails, capture:
1. ServiceNow page URL
2. Generated Notion page URL  
3. Relevant logs (`grep -A 20 -B 5 "ERROR\|fail" logs/*.log`)
4. Payload file (`logs/notion-payload-*.json`)
5. Expected vs actual structure (use verifier script)

---

## Next Steps

1. Run HIGH PRIORITY tests first
2. Document results in this file
3. Create GitHub issues for any failures
4. Update CHANGELOG with testing results
5. Consider adding automated test suite for regression prevention
