# Fix: HTML Tags Appearing as Text in Paragraphs

## Problem
Raw HTML tags were appearing as literal text in paragraph blocks, causing duplicate content:
- Callout blocks were created correctly (✅)
- But the same content appeared AGAIN as a paragraph with visible HTML tags like `<div class="note note note_note ">` (❌)

### Examples of the Issue
```
Paragraph: <div class="note note note_note "> Note: It takes one to two months...
Callout: Note: It takes one to two months... (correctly formatted)

Paragraph: <div class="note note note_note "> Note: Individual scores are shown...
Callout: Note: Individual scores are shown... (correctly formatted)
```

## Root Cause
The issue had TWO parts:

### Part 1: Wrong Order in `cleanHtmlText()`
The `cleanHtmlText()` function in `server/utils/notion-format.cjs` was:
1. Removing HTML tags FIRST: `/<[^>]*>/g`
2. Decoding entities SECOND: `&lt;` → `<`, `&gt;` → `>`

**Problem**: If the HTML contained entity-encoded tags like `&lt;div class="note"&gt;`:
- Step 1: Regex doesn't match (they're not real tags yet)
- Step 2: Entities get decoded to `<div class="note">`
- Result: The decoded tags remain in the text! ❌

### Part 2: Insufficient Tag Stripping
The fallback paragraph logic only called `cleanHtmlText()` once, with no additional safety checks for:
- Malformed HTML
- Unclosed tags
- Residual entity-encoded patterns

## Solution

### Fix 1: Reverse Order in `cleanHtmlText()`
**File**: `server/utils/notion-format.cjs` (line ~133)

```javascript
// BEFORE (wrong order):
let text = html.replace(/<[^>]*>/g, " ");  // Remove tags first
text = text.replace(/&lt;/g, "<");         // Decode entities second

// AFTER (correct order):
let text = html
  .replace(/&lt;/g, "<")                   // Decode entities FIRST
  .replace(/&gt;/g, ">")
  // ... other entity replacements
text = text.replace(/<[^>]*>/g, " ");      // THEN remove tags
```

This ensures entity-encoded tags get decoded first, so they can be properly stripped.

### Fix 2: Clean HTML Before parseRichText in Mixed Content
**File**: `server/services/servicenow.cjs` (line ~1453)

The primary issue was in the mixed content handler. When a paragraph contains nested blocks (like callouts), the code needs to extract ONLY the text that appears before/after the nested blocks, not the text INSIDE them.

**Original approach (BROKEN):**
- Used string replacement with `textOnlyHtml.replace(blockOuterHtml, '')` 
- This often failed because outerHTML string didn't match exactly (whitespace, formatting differences)
- Result: Text from inside callouts remained and created duplicate paragraphs

**Fixed approach:**
```javascript
// Clone the element and use Cheerio DOM manipulation
const $clone = $elem.clone();
$clone.find('> ul, > ol, > div.note, > figure, > iframe').remove();
const textOnlyHtml = $clone.html() || '';

// Then clean and parse
const cleanedHtml = cleanHtmlText(textOnlyHtml);
const { richText: textRichText } = await parseRichText(cleanedHtml);
```

This ensures nested blocks are properly removed from the DOM before extracting text, preventing duplicate content.

### Fix 3: Aggressive Multi-Pass Tag Stripping (Fallback)
**File**: `server/services/servicenow.cjs` (line ~1951)

```javascript
// Strip any remaining HTML tags before converting to rich text
let cleanedContent = cleanHtmlText(content.trim());

// Additional aggressive tag stripping as a safety measure
cleanedContent = cleanedContent.replace(/<[^>]*>/g, " ");

// Remove any residual HTML-like patterns that might have slipped through
cleanedContent = cleanedContent.replace(/&lt;[^&]*&gt;/g, " ");

// Clean up multiple spaces
cleanedContent = cleanedContent.replace(/\s+/g, " ").trim();

const fallbackRichText = convertRichTextBlock(cleanedContent);
```

This provides multiple layers of defense against HTML tags appearing in text (though with Fix 2, fallback paragraphs should rarely be created).

## Files Changed

1. **server/utils/notion-format.cjs**
   - Line ~133: Reversed order of entity decoding and tag removal
   - Decode entities FIRST, then remove tags

2. **server/services/servicenow.cjs**
   - Line ~1472: Added `cleanHtmlText()` call before `parseRichText()` in mixed content handler
   - This is the PRIMARY FIX that prevents HTML from appearing in paragraphs around callouts
   - Line ~1951: Added multi-pass aggressive tag stripping in fallback paragraph logic (safety net)

## Testing

The fix has been tested with the reported examples:

**Before Fix:**
```
Paragraph: <div class="note note note_note "> Note: It takes one to two months for aggregate monthly data...
Callout: Note: It takes one to two months for aggregate monthly data...
```

**After Fix:**
```
Callout: Note: It takes one to two months for aggregate monthly data... ✅
(No duplicate paragraph with HTML tags)
```

## Verification

From server logs:
```
🔍 MATCHED CALLOUT! class="note note note_note"
🔍 Callout rich_text has 1 elements
🔍 Creating callout block with 1 rich_text elements
...
✅ Minimal/no remaining content - all elements properly processed
```

The "Minimal/no remaining content" message confirms that no fallback paragraph is being created, meaning all callouts are being properly detected and removed from the HTML.

## Date
October 17, 2025

## Status
✅ Fixed and deployed (server auto-restarted with nodemon)
