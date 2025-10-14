# Fix: Rich Text 100-Element Limit

## Problem

Notion API returned validation error:
```
body.children[0].paragraph.rich_text.length should be ≤ `100`, instead was `163`.
```

This occurred when processing ServiceNow documentation pages with heavy formatting (bold, italic, code, links, etc.), where each formatting change creates a separate rich_text element.

## Root Cause

Notion's API has **two separate limits** for rich_text content:

1. **2000 characters per `text.content`** ✅ Already fixed
2. **100 elements max per `rich_text` array** ❌ Was not handled

The `parseRichText()` function creates one rich_text element for each formatting change:
- Plain text → 1 element
- **Bold text** → 3 elements (plain, bold, plain)
- `inline code` → 3 elements (plain, code, plain)
- [link](#) → separate element

A paragraph with many inline code blocks, links, and formatting can easily exceed 100 elements.

## Example That Triggers the Issue

```html
<p>
  The <code>sys_id</code> field contains <code>abc123</code> value.
  Check <a href="...">documentation</a> for <code>table_name</code> info.
</p>
```

This creates ~15+ rich_text elements for a single paragraph.

## Solution

Added `splitRichTextArray()` helper function that:
1. Checks if rich_text array exceeds 100 elements
2. Splits into chunks of ≤100 elements
3. Creates multiple blocks (one per chunk)

### Implementation

```javascript
/**
 * Splits a rich_text array into chunks of max 100 elements (Notion's limit).
 * 
 * @param {Array} richText - Array of rich_text elements
 * @returns {Array<Array>} Array of rich_text chunks, each with ≤100 elements
 */
function splitRichTextArray(richText) {
  const MAX_RICH_TEXT_ELEMENTS = 100;
  
  if (!richText || richText.length <= MAX_RICH_TEXT_ELEMENTS) {
    return [richText];
  }
  
  const chunks = [];
  for (let i = 0; i < richText.length; i += MAX_RICH_TEXT_ELEMENTS) {
    chunks.push(richText.slice(i, i + MAX_RICH_TEXT_ELEMENTS));
  }
  
  return chunks;
}
```

### Applied to All Block Types

Updated block creation for:
- **Paragraphs** - Split into multiple paragraphs if needed
- **Headings** (h1, h2, h3) - Split into multiple headings if needed
- **List items** - Split into multiple list items if needed
- **Callouts** - Split into multiple callouts if needed

### Example Usage

```javascript
// Before (could fail with >100 elements)
processedBlocks.push({
  type: "paragraph",
  paragraph: {
    rich_text: paragraphRichText, // Could be 163 elements
  }
});

// After (guaranteed ≤100 elements per block)
const richTextChunks = splitRichTextArray(paragraphRichText);
for (const chunk of richTextChunks) {
  processedBlocks.push({
    type: "paragraph",
    paragraph: {
      rich_text: chunk, // Always ≤100 elements
    }
  });
}
```

## Visual Impact

When a paragraph has >100 rich_text elements:

**Before:** ❌ Notion API error, page creation fails

**After:** ✅ Content split into multiple consecutive blocks:
- Paragraph 1 (100 elements)
- Paragraph 2 (63 elements)

The split is invisible to the user - content reads naturally across blocks.

## Testing

Test with ServiceNow pages that have:
- Heavy inline code formatting (many `<code>` tags)
- Extensive linking
- Mixed bold/italic/code formatting
- Technical identifiers with dots/underscores

## Files Modified

- `server/services/servicenow.cjs`:
  - Added `splitRichTextArray()` helper function
  - Updated paragraph block creation
  - Updated heading block creation
  - Updated list item block creation
  - Updated callout block creation

## Related Fixes

- Character limit (2000): Fixed in `converters/rich-text.cjs` with `convertRichTextBlock()`
- Element limit (100): Fixed in `services/servicenow.cjs` with `splitRichTextArray()`

Both limits now handled correctly! ✅

## Date

October 13, 2025
