# Module Organization - Version 9.0.0

This document describes the organization of utility functions and their locations after the refactoring completed on October 13, 2025.

## Module Structure

### `server/utils/url.cjs` - URL Utilities
**Purpose**: Centralized URL normalization and validation

**Functions**:
- `convertServiceNowUrl(url)` - Converts ServiceNow relative URLs to absolute URLs
- `isValidNotionUrl(url)` - Validates URLs for Notion API compatibility
- `isVideoIframeUrl(url)` - Detects video platform iframes (YouTube, Vimeo, etc.)

**Used by**: `sn2n-proxy.cjs`, `services/servicenow.cjs`, `converters/rich-text.cjs`

---

### `server/utils/notion-format.cjs` - Notion Formatting Utilities
**Purpose**: Core formatting utilities for Notion API compliance

**Functions**:
- `normalizeAnnotations(annotations)` - Normalizes rich text annotations with defaults
- `cleanHtmlText(html)` - Strips HTML tags and decodes entities

**Constants**:
- `VALID_RICH_TEXT_COLORS` - Set of valid Notion rich text colors

**Used by**: `converters/rich-text.cjs`, `services/servicenow.cjs`, `sn2n-proxy.cjs`

---

### `server/converters/rich-text.cjs` - Rich Text Conversion
**Purpose**: HTML to Notion rich_text conversion with formatting preservation

**Functions**:
- `convertRichTextBlock(input, options)` - Main HTML to rich_text converter
  - Handles bold, italic, code, links
  - Auto-detects technical identifiers
  - **Enforces 2000-char limit per rich_text element** (v9.0.0)
- `cloneRichText(rt)` - Deep clones rich_text objects
- `sanitizeRichTextArray(items)` - Filters and validates rich_text arrays

**Re-exports**: `normalizeAnnotations`, `VALID_RICH_TEXT_COLORS`, `cleanHtmlText` (from utils/notion-format.cjs)

**Used by**: `services/servicenow.cjs` (via `parseRichText` delegation)

---

### `server/services/servicenow.cjs` - ServiceNow Content Extraction
**Purpose**: ServiceNow-specific HTML parsing and block conversion

**Functions**:
- `extractContentFromHtml(html)` - Main entry point for HTML-to-Notion conversion
  - Internal `parseRichText(html)` - Delegates to `convertRichTextBlock`
  - Internal `createImageBlock(src, alt)` - Creates Notion image blocks
  - Handles callouts, tables, code blocks, lists, paragraphs
- `parseMetadataFromUrl(url)` - Extracts metadata from ServiceNow URLs
- `getGlobals()` - Retrieves global utility functions (internal helper)

**Imports**: 
- `convertServiceNowUrl`, `isVideoIframeUrl` from `utils/url.cjs`
- `cleanHtmlText`, `convertRichTextBlock` from `converters/rich-text.cjs`

**Used by**: `sn2n-proxy.cjs` (via `htmlToNotionBlocks`)

---

### `server/sn2n-proxy.cjs` - Main Proxy Server
**Purpose**: Express server and Notion API orchestration

**Functions**:
- `htmlToNotionBlocks(html)` - Delegates to `servicenowService.extractContentFromHtml`
- Image upload, Notion API calls, route handlers
- Global function setup for service layer

**Imports**:
- `convertServiceNowUrl`, `isVideoIframeUrl`, `isValidNotionUrl` from `utils/url.cjs`
- `cleanHtmlText` from `utils/notion-format.cjs`
- `servicenowService` for content extraction

---

## Key Improvements (v9.0.0)

### 1. **Eliminated Duplicate Functions**
- ✅ `cleanHtmlText` - Now only in `utils/notion-format.cjs`
- ✅ `convertServiceNowUrl` - Now only in `utils/url.cjs`
- ✅ `isVideoIframeUrl` - Now only in `utils/url.cjs`
- ✅ `isValidNotionUrl` - Now only in `utils/url.cjs`

### 2. **Centralized Rich Text Splitting**
- All paragraph blocks now use `convertRichTextBlock`
- Automatic splitting at 2000 characters (Notion API compliance)
- No more "rich_text.content.length should be ≤ 2000" errors

### 3. **Logical Grouping**
- **URL utilities** → `utils/url.cjs`
- **Notion formatting** → `utils/notion-format.cjs`
- **Rich text conversion** → `converters/rich-text.cjs`
- **ServiceNow extraction** → `services/servicenow.cjs`
- **Server orchestration** → `sn2n-proxy.cjs`

### 4. **Clear Dependencies**
```
sn2n-proxy.cjs
  ├── utils/url.cjs
  ├── utils/notion-format.cjs
  └── services/servicenow.cjs
        ├── utils/url.cjs
        └── converters/rich-text.cjs
              ├── utils/url.cjs
              └── utils/notion-format.cjs
```

---

## Migration Notes

### For Developers
- Always import from the canonical source module
- Do not create local copies of utility functions
- Use `convertRichTextBlock` for all rich text conversion
- URL utilities are in `utils/url.cjs`, not scattered across files

### For Future Refactoring
- New URL utilities → `utils/url.cjs`
- New Notion formatting helpers → `utils/notion-format.cjs`
- New rich text converters → `converters/rich-text.cjs`
- ServiceNow-specific logic → `services/servicenow.cjs`

---

## Testing Checklist

After module reorganization, verify:
- [ ] Server starts without module resolution errors
- [ ] Notion page creation succeeds with ServiceNow content
- [ ] No "convertServiceNowUrl is not defined" errors
- [ ] No "cleanHtmlText is not defined" errors
- [ ] Long paragraphs split correctly (no 2000-char limit errors)
- [ ] All imports resolve correctly
- [ ] No duplicate function definitions remain

---

**Last Updated**: October 13, 2025  
**Version**: 9.0.0  
**Status**: ✅ Complete
