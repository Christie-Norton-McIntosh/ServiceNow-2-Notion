# Block Deduplication Logic

**Component**: `server/utils/dedupe.cjs`  
**Purpose**: Remove duplicate blocks and filter noise while preserving legitimate repetition  
**Last Updated**: November 5, 2025

---

## Overview

The deduplication system prevents duplicate content in Notion pages while intelligently preserving legitimate repetition of common phrases and instructions that appear in different sections of documentation.

## Key Principle: Proximity-Based Deduplication

**Before (Global Deduplication)**:
- Used a global `Set` to track all seen blocks
- Removed ALL duplicates across the entire document
- Problem: Removed legitimate repetition like "Submit the form." appearing in different procedures

**After (Proximity-Based Deduplication)**:
- Uses a sliding window of recent blocks
- Only removes duplicates within a configurable proximity window
- Allows common phrases to appear in different sections

### Proximity Window

```javascript
const PROXIMITY_WINDOW = 5; // Only dedupe if duplicates are within 5 blocks of each other
```

**Examples**:

| Scenario | Distance | Action |
|----------|----------|--------|
| Duplicate at positions 10 and 11 | 1 block | ❌ Removed (likely formatting error) |
| Duplicate at positions 10 and 14 | 4 blocks | ❌ Removed (within window) |
| Duplicate at positions 10 and 16 | 6 blocks | ✅ Kept (outside window) |
| "Submit the form." at positions 10 and 45 | 35 blocks | ✅ Kept (legitimate repetition) |

---

## Deduplication Rules

### Never Deduplicate

The following block types are **NEVER** deduplicated, regardless of proximity:

#### 1. Dividers
```javascript
if (blk && blk.type === 'divider') {
  out.push(blk); // Always keep - unique by position
  continue;
}
```
**Reason**: Dividers are positional elements that separate sections

#### 2. List Items
```javascript
if (blk && (blk.type === 'numbered_list_item' || blk.type === 'bulleted_list_item')) {
  out.push(blk); // Always keep
  continue;
}
```
**Reason**: Common instructions legitimately appear in multiple procedures
- Example: "Open a software model record." in different workflows

#### 3. Common Section Headings
```javascript
const isCommonHeading = /^(Procedure|About this task|Steps|Requirements?|Overview|Submit the form\.?)$/i.test(txt.trim());
```
**Always Kept**:
- "Procedure"
- "About this task"
- "Steps"
- "Requirements" / "Requirement"
- "Overview"
- "Submit the form." / "Submit the form"

**Reason**: These are standard documentation section labels

#### 4. Common Callouts
```javascript
const isCommonCallout = /^(Before you begin|Role required:|Prerequisites?|Note:|Important:|Warning:)/i.test(txt.trim());
```
**Always Kept**:
- "Before you begin"
- "Role required:"
- "Prerequisites" / "Prerequisite"
- "Note:"
- "Important:"
- "Warning:"

**Reason**: Standard documentation patterns that appear in multiple sections

---

### Proximity-Based Deduplication

All other blocks use the sliding window approach:

#### Images (Special Case)
```javascript
if (blk && blk.type === 'image' && blk.image) {
  const fileId = blk.image.file_upload && blk.image.file_upload.id;
  if (fileId) {
    // Check if this image was seen recently (in the whole document)
    const foundInRecent = recentBlocks.find(entry => entry[0] === imageKey);
    if (foundInRecent) {
      // Remove duplicate
    }
  }
}
```
**Note**: Images use **global** deduplication (not proximity-based) because identical images should only appear once

#### All Other Blocks
```javascript
const foundInWindow = recentBlocks.find(entry => {
  const [entryKey, entryIndex] = entry;
  return entryKey === key && (i - entryIndex) <= PROXIMITY_WINDOW;
});
```

**Deduplicated Block Types** (with proximity):
- Paragraphs (except common headings)
- Code blocks
- Tables
- Callouts (except common patterns)

---

## Gray Callout Filtering

In addition to deduplication, the system **filters out** gray info callouts:

```javascript
if (
  blk &&
  blk.type === "callout" &&
  blk.callout &&
  blk.callout.color === "gray_background" &&
  blk.callout.icon?.type === "emoji" &&
  String(blk.callout.icon.emoji).includes("ℹ")
) {
  // Filter out - these are noise
}
```

**Reason**: Gray info callouts with ℹ️ emoji are typically auto-generated navigation aids that don't add value to the Notion page

**Blue callouts are kept**: These contain important notes and warnings

---

## Block Key Computation

Each block is identified by a unique key based on its content:

### Callout Key
```javascript
`callout:${text}|${emoji}|${color}`
```

### Image Key
```javascript
`image:file:${fileId}` or `image:external:${url}`
```

### Table Key
```javascript
`table:${width}x${rows}:${rowSamples}`
```
- Includes first 3 rows of content
- Normalizes cell text (removes markers, whitespace)
- Truncates to 200 chars per cell

### List Item Key
```javascript
`${blockType}:${text.substring(0, 200)}`
```

### Paragraph Key
```javascript
`paragraph:${text.substring(0, 200)}`
```

### Code Block Key
```javascript
`code:${language}:${codeText.substring(0, 200)}`
```

---

## Tuning the Proximity Window

The `PROXIMITY_WINDOW` constant controls the deduplication sensitivity:

### Current Setting: 5 blocks
**Good for**: Standard documentation with common phrases appearing in different sections

### Smaller Window (2-3 blocks)
**Use when**: You have very repetitive content with minimal separation
**Risk**: May not catch some duplicates

### Larger Window (10+ blocks)
**Use when**: You have shorter sections and want more aggressive deduplication
**Risk**: May remove legitimate repetition in nearby sections

### Recommendations
- **Don't go below 2**: Won't catch adjacent duplicates
- **Don't go above 10**: Will start removing legitimate repetition
- **Test after changes**: Capture a complex page and check validation logs

---

## Common Issues and Solutions

### Issue: Legitimate phrase removed
**Symptoms**: "Submit the form." appears once instead of twice in different procedures

**Solution 1**: Add to common phrases allowlist
```javascript
const isCommonHeading = /^(Procedure|...|Your Phrase Here)$/i.test(txt.trim());
```

**Solution 2**: Increase proximity window
```javascript
const PROXIMITY_WINDOW = 10; // More lenient
```

### Issue: Duplicate blocks not removed
**Symptoms**: Identical blocks appear back-to-back in Notion

**Solution 1**: Check if block type is exempt
- List items are never deduplicated
- Common headings are never deduplicated

**Solution 2**: Decrease proximity window
```javascript
const PROXIMITY_WINDOW = 3; // More aggressive
```

### Issue: Important callout removed
**Symptoms**: "Note: ..." callout missing from output

**Check**: Is it a gray info callout?
- Gray callouts with ℹ️ are filtered out
- Blue/yellow callouts should be kept

**Solution**: Modify gray callout filter if needed

---

## Testing

### Test Scenarios

1. **Adjacent Duplicates** (should be removed)
   - Same paragraph appearing twice in a row
   - Distance: 1 block

2. **Near Duplicates** (should be removed)
   - Same content 3-4 blocks apart
   - Distance: 3-4 blocks

3. **Distant Repetition** (should be kept)
   - "Submit the form." in steps 5 and 35
   - Distance: 30+ blocks

4. **Common Phrases** (should always be kept)
   - "Procedure" heading in multiple sections
   - "Submit the form." in different procedures

### Validation Logs

Check server logs for deduplication activity:

```
🔧 dedupeAndFilterBlocks: removed 5 total (2 callouts, 3 duplicates)
🚫 Deduping block at index 15: duplicate of block at 12 (distance: 3)
🚫 Filtering gray callout: emoji="ℹ️", color="gray_background"
```

---

## Related Documentation

- **Implementation**: `server/utils/dedupe.cjs`
- **Usage**: `server/routes/w2n.cjs` (calls `dedupeAndFilterBlocks`)
- **Testing**: `docs/TESTING_SCENARIOS.md`
- **Block Keys**: See `computeBlockKey()` function in `dedupe.cjs`

---

## Changelog

### November 5, 2025 - Proximity-Based Deduplication
**Changed**: From global to proximity-based deduplication
**Reason**: Common phrases like "Submit the form." were being incorrectly removed when they appeared in different sections
**Impact**: Better preservation of legitimate repetition while still catching true duplicates

**Added**: "Submit the form." to common phrases allowlist
**Window**: Set to 5 blocks (tunable via `PROXIMITY_WINDOW` constant)

---

*For questions or issues with deduplication, see this document and check server logs for detailed deduplication activity.*
