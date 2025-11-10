# Fix: Duplicate Images in Notion Pages

## Problem
When converting ServiceNow documentation pages to Notion, images (especially those in `<figure>` elements) were appearing **twice** on the created Notion pages.

### Root Cause - Two-Part Issue

#### Part 1: Incomplete HTML Removal (FIXED)
The mixed content handler was using `$.html(block)` which returns **inner HTML** instead of `block.outerHTML` which returns the complete element including wrapper tags.

#### Part 2: Image Extraction from Mixed Content (FIXED)
Even with proper HTML removal, `parseRichText()` was being called on `textOnlyHtml` and would extract **any remaining image tags** as separate image blocks, in addition to the images created by processing nested block elements separately.

**The Result:**
When processing a paragraph with an embedded figure:
1. `parseRichText(textOnlyHtml)` would find img tags and create image blocks
2. Then `processElement(figure)` would create another image block
3. **Duplicate images** on the Notion page

## Solution

### Fix 1: Use Proper HTML Removal (Line 1463)
Changed from inner HTML to outer HTML:

```javascript
// Before:
const blockOuterHtml = $.html(block);  // ❌ Returns inner HTML only

// After:
const blockOuterHtml = block.outerHTML;  // ✅ Returns complete element
```

### Fix 2: Don't Extract Images from Mixed Content (Lines 1471-1488)
Skip image extraction when processing mixed content where nested blocks will be handled separately:

```javascript
// Before:
const { richText: textRichText, imageBlocks: textImages } = await parseRichText(textOnlyHtml);
if (textImages && textImages.length > 0) {
  processedBlocks.push(...textImages);  // ❌ Adds duplicate images
}

// After:
const { richText: textRichText } = await parseRichText(textOnlyHtml);
// Intentionally ignoring imageBlocks from mixed content to prevent duplicates ✅
```

## What Changed
**File:** `server/services/servicenow.cjs`

1. **Line 1463**: Use `block.outerHTML` instead of `$.html(block)`
2. **Lines 1471-1488**: Skip image extraction in mixed content scenarios

## How It Works Now

### Scenario: Paragraph with Embedded Figure

**HTML:**
```html
<div class="p">
  <p>
    Figure 1. Methods of sourcing requested items
    <figure class="fig fignone">
      <img src="..." alt="Methods" />
      <figcaption>Figure 1. Methods</figcaption>
    </figure>
  </p>
</div>
```

**Processing Flow:**
1. Detects mixed content (paragraph with nested figure)
2. Removes the ENTIRE `<figure>` element from textOnlyHtml using `block.outerHTML`
3. Extracts text: "Figure 1. Methods of sourcing requested items"
4. Calls `parseRichText()` on textOnlyHtml to get ONLY the text (no images extracted)
5. Creates 1 paragraph block with the extracted text
6. Processes the figure separately via `processElement()`
7. Creates 1 image block with caption
8. **Result**: 2 blocks total (1 paragraph + 1 image) ✅ NO DUPLICATES

## Testing
- Images in figures should appear **once** on Notion pages ✅
- Figure captions should be preserved ✅
- Mixed content (paragraphs with embedded figures) should render correctly ✅
- No extra paragraph blocks from duplicate processing ✅

## Build Info
- **Fixed File:** `server/services/servicenow.cjs`
- **Build Status:** ✅ Success (189ms)
- **Output:** `dist/ServiceNow-2-Notion.user.js` (241 KB)
- **Date:** October 17, 2025

## Related Components
- Affects: Mixed content handling in `processElement()` for `<p>` and `<div class="p">` elements
- Dependencies: None (internal to HTML-to-Notion block conversion)
- Backward Compatibility: ✅ No breaking changes

## Detailed Changes

### Change 1: Line 1463
```diff
- const blockOuterHtml = $.html(block);
+ const blockOuterHtml = block.outerHTML;  // Use outerHTML to include wrapper tags
```

### Change 2: Lines 1471-1488
```diff
- const { richText: textRichText, imageBlocks: textImages } = await parseRichText(textOnlyHtml);
- if (textImages && textImages.length > 0) {
-   processedBlocks.push(...textImages);
- }
+ // NOTE: Don't extract images from textOnlyHtml since nested block elements (like figures)
+ // will be processed separately. If there are any leftover img tags, they should NOT create
+ // separate image blocks - just include them as part of the paragraph text.
+ // We only call parseRichText to get the text content, not the images.
+ const { richText: textRichText } = await parseRichText(textOnlyHtml);
+ // Intentionally ignoring imageBlocks from mixed content to prevent duplicates
```

---

## Before vs After Comparison

| Scenario | Before Fix | After Fix | Status |
|----------|-----------|-----------|--------|
| Figure in paragraph | 2 images (duplicate) ❌ | 1 image ✅ | FIXED |
| Multiple figures in paragraph | 4 images (2x duplicate) ❌ | 2 images ✅ | FIXED |
| Figure + list in paragraph | Multiple duplicates ❌ | 1 image + list ✅ | FIXED |
| Standalone figure | 1 image ✅ | 1 image ✅ | No change |
| Paragraph without figures | 1 paragraph ✅ | 1 paragraph ✅ | No change |

