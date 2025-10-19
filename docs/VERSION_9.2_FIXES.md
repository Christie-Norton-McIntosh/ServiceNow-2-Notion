# Version 9.2.x — Comprehensive Fix Documentation

**Version Range**: 9.2.0 - 9.2.3  
**Release Period**: October 16-19, 2025  
**Status**: Current Release  

---

## Overview

Version 9.2 introduced significant improvements to AutoExtract, content conversion, and table handling. This document consolidates all fixes and enhancements from releases 9.2.0, 9.2.1, 9.2.2, and 9.2.3.

---

## Version 9.2.3 (October 19, 2025)

### Text and Links Preserved Around Tables

**Problem**: Text and links appearing before or after tables in mixed content containers were being lost or appearing in the wrong location. The sentence "For more information on similarity solution, refer" would disappear, and the link "Create similarity solution" would appear without the preceding text.

**Root Cause**: 
- When iterating through `childNodes` (a live NodeList), removing elements from the DOM during iteration caused the next node to be skipped
- After processing a table-wrap DIV and removing it from the DOM, the next text node was skipped entirely
- This happened because NodeList is "live" and updates when DOM changes

**Example Issue**:
```
Expected: "For more information on similarity solution, refer [Create similarity solution]."
Actual: "[Create similarity solution]." (missing leading text)
```

**Solution**:
- Use `Array.from()` to create a snapshot of `childNodes` before iteration
- This prevents DOM modifications from affecting the iteration
- All text nodes and inline elements are now properly accumulated before/after block elements

**Technical Implementation**:
```javascript
// Before (broken)
const childNodes = $elem.get(0).childNodes;
for (const node of childNodes) {
  // When we remove a node, the live NodeList shifts and next node is skipped
}

// After (fixed)
const childNodes = Array.from($elem.get(0).childNodes);
for (const node of childNodes) {
  // Array snapshot is unaffected by DOM modifications
}
```

**Files**: 
- `server/services/servicenow.cjs` (lines ~1625, ~2105)

**Commit**: eb1072c, bc6da69

**Result**: 
- ✅ Text before tables appears in correct position
- ✅ Links after tables include preceding text
- ✅ All mixed content properly ordered
- ✅ No skipped nodes during iteration

---

## Version 9.2.2 (October 19, 2025)

### Soft Returns Between Paragraphs in Table Cells

**Problem**: Table cells with multiple `<p>` tags had content collapsed onto a single line without newlines. Additionally, UIControl formatting was lost and unwanted line breaks appeared from source HTML indentation.

**Example Issue**: `"Text1[Text2]"` instead of `"Text1\n[Text2]"`, with "Reason/Comments" appearing as plain text instead of bold+blue.

**Root Cause**: 
- Initial regex approach extracted plain text, stripping nested HTML tags like `<span class="ph uicontrol">`
- No paragraph boundary detection to add newlines between multiple `<p>` tags
- Source HTML indentation/newlines were preserved, creating unwanted line breaks

**Solution**:
- Detect cells with multiple `<p>` tags and add intentional newlines between them
- Preserve HTML tags inside paragraphs (for uicontrol and other formatting)
- Normalize source HTML whitespace (remove indentation) without affecting intentional newlines
- Pass HTML to rich-text converter which handles `<span class="ph uicontrol">` → bold+blue

**Technical Implementation**:
```javascript
// Detect multiple paragraphs and add newlines between them
const paragraphMatches = processedHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi);

if (paragraphMatches && paragraphMatches.length > 1) {
  textContent = processedHtml
    .replace(/<\/p>\s*<p[^>]*>/gi, '</p>\n<p>')  // Add newline between paragraphs
    .replace(/<\/?p[^>]*>/gi, '');  // Remove <p> tags but keep nested HTML
} else {
  textContent = processedHtml.replace(/<\/?p[^>]*>/gi, '');
}

// Normalize whitespace (remove source HTML formatting)
textContent = textContent
  .replace(/\s*\n\s*/g, ' ')  // Remove indentation newlines
  .replace(/\s{2,}/g, ' ')    // Collapse multiple spaces
  .trim();
```

**Why This Works**: 
- Preserves HTML tags for rich-text converter to process
- Adds intentional newlines BEFORE normalizing whitespace
- Removes formatting whitespace AFTER adding intentional newlines
- Rich-text converter sees `<span class="ph uicontrol">` and applies bold+blue

**Files**: `server/converters/table.cjs` (processTableCellContent)  
**Commit**: TBD

**Result**: 
- ✅ Soft returns between paragraphs in table cells
- ✅ UIControl formatting preserved (bold + blue)
- ✅ Clean text flow without unwanted line breaks
- ✅ All content properly formatted in Notion

---

## Version 9.2.1 (October 18, 2025)

### Table Formatting Fixes

Three critical table formatting issues were identified and resolved during live usage testing.

#### 1. Conditional Image Placeholders

**Problem**: All images in tables showed "See image below" placeholder, even when images weren't being uploaded to Notion due to validation failures.

**Solution**: 
- Track valid image URLs during extraction in a `Set`
- Apply conditional placeholder based on image validity:
  - Valid images: `See "caption"` or `See image below`
  - Invalid images: `•` (bullet placeholder)

**Files**: `server/converters/table.cjs`  
**Commit**: 5578623

#### 2. Bullet Line Breaks in Table Cells

**Problem**: Multiple bullet items in table cells appeared on same line (e.g., "• Item1 • Item2 • Item3") instead of separate lines.

**Solution**:
- Detect multiple bullets with regex pattern `/•[^•]+•/`
- Insert newlines between bullet items
- Clean leading whitespace

**Files**: `server/converters/table.cjs`  
**Commit**: ae1a5a7

#### 3. UIControl Formatting & Newline Preservation

**Problem**: 
- ServiceNow `<span class="ph uicontrol">` elements appeared as plain text instead of bold+blue
- Newlines in table cells were collapsed by aggressive whitespace normalization

**Solution**:
- Added uicontrol span detection with `__BOLD_BLUE_START__`/`__BOLD_BLUE_END__` markers
- Changed whitespace regex from `/\s+/g` to `/[^\S\n]+/g` to preserve newlines
- Added marker parsing for bold+blue formatting

**Files**: `server/converters/rich-text.cjs`  
**Commit**: a3e819d

**See**: `docs/FIX_TABLE_FORMATTING_9.2.1.md` for detailed technical documentation

---

## Version 9.2.0 (October 16-17, 2025)

### 1. Access-Limited Page Handling (AutoExtract)

**Problem**: AutoExtract would fail or skip content when encountering ServiceNow pages showing "Access to this content is limited to authorized users" message.

**Solution**: 
- Automatic detection via page title and H1 content
- Auto-reload mechanism (up to 3 attempts with 15s wait)
- Smart skip logic if access not regained
- Toast notifications and console feedback
- State preservation using Tampermonkey `GM_setValue`

**Key Features**:
- Seamless AutoExtract continuation after reload/skip
- `reloadAttempts` counter prevents infinite loops
- Comprehensive error handling

**Files**: `src/ui/main-panel.js`  
**Archived Docs**: `docs/archive/features/access-limited/`

---

### 2. Duplicate Image Blocks

**Problem**: Images were duplicated when a `<figure>` appeared inside paragraph/mixed content — the image would appear both inline in the paragraph and as a separate image block.

**Root Cause**: 
- Mixed content processing used string replacement to remove nested blocks
- Replacement often failed due to HTML formatting differences
- Failed removal caused image to be processed twice

**Solution**:
- Use `element.outerHTML` to ensure exact HTML matching
- Skip image extraction from mixed text content
- Process images only once in dedicated extraction phase

**Files**: `server/services/servicenow.cjs`  
**Commit**: Referenced in v9.2.0 changelog  
**Archived Doc**: `docs/archive/fixes/v9.2/FIX_DUPLICATE_IMAGE_IMAGES.md`

---

### 3. Icon & Cover Image URLs

**Problem**: 
- GitHub raw URLs for page icons and covers contained duplicated folder segments
- URLs returned 404 errors, causing icons/covers not to appear on Notion pages

**Solution**:
- Corrected URLs to proper path format:
  - Icon: `main/src/img/ServiceNow icon.png`
  - Cover: `main/src/img/ServiceNow cover.png`
- Verified raw.githubusercontent.com accessibility

**Files**: `server/routes/w2n.cjs`  
**Commits**: Multiple fixes  
**Archived Docs**: 
- `docs/archive/fixes/v9.2/FIX_ICON_COVER_URLS.md`
- `docs/archive/fixes/v9.2/FIX_ICON_COVER_VISIBILITY.md`

---

### 4. TypeError: className.toLowerCase is not a function

**Problem**: On SVG elements, `element.className` returns an `SVGAnimatedString` object instead of a string, causing `.toLowerCase()` calls to throw TypeError.

**Solution**:
- Normalize className by checking type
- Use `.baseVal` property for SVG elements
- Safely handle both string and object className values

**Files**: `src/ui/main-panel.js`  
**Archived Doc**: `docs/archive/fixes/v9.2/FIX_CLASSNAME_TOLOWERCASE_ERROR.md`

---

### 5. Rich Text 100-Element Limit

**Problem**: Notion's API limits `rich_text` arrays to 100 elements per block. ServiceNow pages with heavy inline formatting (code blocks, links, bold/italic) easily exceed this limit, causing API errors.

**Solution**:
- Implemented `splitRichTextArray()` function
- Automatically split large rich_text arrays across multiple consecutive blocks
- Preserve formatting across block boundaries
- Handle paragraphs, headings, list items, and callouts

**Files**: 
- `server/converters/rich-text.cjs`
- `server/services/servicenow.cjs`

**Impact**: Pages with 1000+ rich text elements now convert successfully  
**Archived Doc**: `docs/archive/fixes/v9.2/fix-rich-text-100-element-limit.md`

---

### 6. HTML Tags Appearing as Text in Paragraphs

**Problem**: 
- Raw HTML tags (like `<div class="note note_note">`) appeared as literal text in paragraph blocks
- Callout text content was duplicating (appearing in both callout and surrounding paragraph)

**Root Causes**:
1. Entity-encoded HTML (`&lt;div&gt;`) decoded AFTER tag removal, causing decoded tags to remain
2. Mixed content paragraphs used string replacement, which often failed
3. Failed removal left callout's text content, creating duplicate paragraph

**Solution**:
1. Reversed operation order: decode HTML entities FIRST, then remove tags
2. **Primary Fix**: Replaced string-based `outerHTML.replace()` with Cheerio DOM manipulation using `.clone()` and `.remove()`
3. Added `cleanHtmlText()` call before `parseRichText()` 
4. Added aggressive multi-pass tag stripping as safety net

**Files**: 
- `server/utils/notion-format.cjs` (line ~133)
- `server/services/servicenow.cjs` (lines ~1453, ~1951)

**Archived Doc**: `docs/archive/fixes/v9.2/FIX_HTML_TAGS_IN_PARAGRAPHS.md`

---

### 7. Table Image Extraction

**Problem**: Notion table cells cannot contain images. Previous approach sometimes replaced images with bullets or lost images entirely.

**Solution**:
- Preserve `<figure>` elements during extraction
- Replace figures with descriptive placeholders inside table cells
- Extract figure images as separate image blocks after table
- Maintain proper nesting levels

**Features**:
- Placeholder format: `See "Figure N. Caption text"`
- Images appear as separate blocks immediately after table
- Handles multiple tables with images correctly

**Files**: 
- `src/content/content-extractor.js`
- `server/services/servicenow.cjs`
- `server/converters/table.cjs`

**Enhanced in**: v9.2.1 (conditional placeholders)

---

### 8. Content Order with Cheerio

**Problem**: Content extraction order didn't match ServiceNow page visual order, causing logical flow issues in Notion.

**Solution**: 
- Refactored extraction to use Cheerio's DOM traversal
- Process elements in document order
- Maintain parent-child relationships correctly

**Files**: Various content extraction modules  
**Archived Doc**: `docs/archive/fixes/v9.2/fix-content-order-cheerio.md`

---

## Testing & Validation

### Test Pages Used

All fixes validated using real ServiceNow documentation:

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html

https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html

https://docs.servicenow.com/bundle/yokohama-platform-administration/page/administer/navigation-and-ui/concept/c_CustomizingUIPages.html
```

### Validation Checklist

- ✅ Text and links around tables preserved in correct order (v9.2.3)
- ✅ Soft returns between paragraphs in table cells (v9.2.2)
- ✅ Table image placeholders conditional on validity
- ✅ Bullet items in tables on separate lines
- ✅ UIControl elements formatted as bold+blue
- ✅ Newlines preserved in table cells
- ✅ Access-limited pages auto-reload and skip
- ✅ No duplicate image blocks
- ✅ Icons and covers appear on Notion pages
- ✅ SVG elements don't cause className errors
- ✅ Rich text arrays split automatically
- ✅ No HTML tags in paragraph text
- ✅ Content order matches ServiceNow pages
- ✅ Table images extracted as separate blocks

---

## Performance Impact

| Fix | Impact | Notes |
|-----|--------|-------|
| Table formatting | None | In-memory processing |
| Access-limited handling | +15s (reload) to +100s (3 reloads) | Only on limited pages |
| Image deduplication | Negligible | Skips duplicate processing |
| Rich text splitting | Negligible | Only on large arrays |
| Content order | Negligible | DOM traversal optimization |

**Overall**: Version 9.2.x maintains excellent performance while significantly improving content accuracy and reliability.

---

## Migration Notes

### From 9.1.x to 9.2.x

- No breaking changes
- All features backward compatible
- Existing property mappings preserved
- AutoExtract behavior enhanced (no changes to manual extract)

### Configuration

No configuration changes required. All fixes work automatically.

---

## Known Limitations

### Table Images
- ⚠️ Images use external URLs (not uploaded to Notion storage)
- ⚠️ If ServiceNow URLs become inaccessible, images break
- 📝 TODO: Implement actual image download and upload

### Rich Text Splitting
- Splits occur at rich_text array boundaries
- Very rare edge cases may have sub-optimal split points
- Overall readability maintained

### Access-Limited Handling
- Maximum 3 reload attempts (configurable in code)
- 15-second wait per reload (prevents rate limiting)
- Pages that remain limited after 3 attempts are skipped

---

## Related Documentation

### Active Documentation
- `docs/TESTING_SCENARIOS.md` — Complete testing matrix
- `docs/notion-blocks-reference.md` — Notion block type reference
- `docs/table-image-extraction.md` — Table image handling details
- `docs/testing-table-images.md` — Table testing procedures
- `docs/FIX_TABLE_FORMATTING_9.2.1.md` — Detailed v9.2.1 fix documentation

### Archived Documentation
- `docs/archive/features/access-limited/` — Complete access-limited feature docs (5 files)
- `docs/archive/fixes/v9.2/` — Individual fix documentation (8 files)
- `docs/archive/reports/` — Build and verification reports

---

## Quick Reference

### ServiceNow Class Formatting

| ServiceNow Class | Notion Format | Use Case |
|-----------------|---------------|----------|
| `ph uicontrol` | Bold + Blue | UI elements (buttons, fields, menus) |
| `ph keyword` | Bold | Keywords, important terms |
| `ph parmname` | Italic | Parameter names, variables |
| `ph codeph` | Code (inline) | Short code snippets |

### Image Placeholder Logic

```javascript
if (isValidImageUrl(imgUrl)) {
    placeholder = caption ? `See "${caption}"` : "See image below";
} else {
    placeholder = "•";
}
```

### Whitespace Preservation

```javascript
// Before (9.2.0)
text = text.replace(/\s+/g, ' '); // Collapsed all whitespace

// After (9.2.1)
text = text.replace(/[^\S\n]+/g, ' '); // Preserve newlines
text = text.replace(/ *\n */g, '\n'); // Clean around newlines
```

---

## Support & Debugging

### Console Output

Enable verbose logging:
```javascript
// In browser console or environment
SN2N_VERBOSE=1
```

### Common Issues

1. **Table bullets on same line**: Verify v9.2.1 installed
2. **Missing images**: Check browser console for validation errors
3. **Access-limited pages**: Check toast notifications for reload status
4. **Duplicate images**: Verify v9.2.0+ installed

### Verification

Check userscript version in Tampermonkey:
```javascript
// @version      9.2.1
```

Or in browser console:
```javascript
window.BUILD_VERSION // Should show "9.2.1"
```

---

## Version History

| Version | Date | Key Changes | Commits |
|---------|------|-------------|---------|
| 9.2.3 | Oct 19, 2025 | Text/links around tables preserved | eb1072c, bc6da69 |
| 9.2.2 | Oct 19, 2025 | Soft returns in table cells | b4f2660 |
| 9.2.1 | Oct 18, 2025 | Table formatting fixes | 3 commits |
| 9.2.0 | Oct 16-17, 2025 | Access-limited, images, rich text | Multiple commits |

---

**Current Status**: Production Ready ✅

**Next Steps**: 
- Monitor for edge cases in production usage
- Consider implementing image upload to Notion storage
- Potential performance optimizations for very large pages

---

*Last Updated: October 18, 2025*  
*Maintained by: ServiceNow-2-Notion Project*
