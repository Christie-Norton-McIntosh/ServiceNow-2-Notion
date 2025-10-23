# HTML Formatting Processing Order

This document maps out the complete processing order for HTML formatting in the ServiceNow-2-Notion converter. Understanding this order is critical for fixing bugs and adding new handlers.

## Overview

The converter has **two main processing paths**:

1. **`servicenow.cjs` → `parseRichText()`**: Processes paragraph content and most text
2. **`rich-text.cjs` → `convertRichTextBlock()`**: Processes table cell content

Each path must handle the same HTML elements in a carefully orchestrated order to avoid conflicts.

---

## Processing Order in `servicenow.cjs` → `parseRichText()`

### Phase 1: Extraction & Placeholder Creation
**Purpose**: Extract complex elements that need special handling, replace with placeholders to protect from interference

| Order | Line | Element | Placeholder Pattern | Notes |
|-------|------|---------|-------------------|-------|
| 1 | 252 | `<kbd>` tags | `__KBD_PLACEHOLDER_N__` | Extract user input/technical content, decode HTML entities |
| 2 | 270 | URLs | `__URL_PLACEHOLDER_N__` | Extract URLs (especially with `<placeholder>` syntax), decode entities |
| 3 | 298 | Decode entities | N/A | Global HTML entity decode AFTER URL extraction |

**Why this order?**
- `<kbd>` often contains URLs, so extract first
- URLs must be extracted before global entity decode to protect `&lt;` and `&gt;` in placeholders
- Entity decode happens after extraction to prevent breaking URL patterns

### Phase 2: Placeholder Restoration with Markers
**Purpose**: Convert placeholders to annotation markers that will be processed into Notion formatting

| Order | Line | Element | Marker Pattern | Logic |
|-------|------|---------|---------------|-------|
| 4 | 313 | URL restoration | `__CODE_START__url__CODE_END__` | Wrap all URLs in code markers |
| 5 | 320 | `<kbd>` restoration | `__CODE_START__` or `__BOLD_START__` | Intelligent detection: technical → code, UI labels → bold |
| 6 | 348 | `<span class="ph cmd">` | `__BOLD_START__content__BOLD_END__` | Commands/instructions → bold (MUST be after kbd restoration) |

**Why this order?**
- URLs restored first (most specific)
- `<kbd>` restored next (can contain URLs or be contained by other elements)
- `cmd` spans MUST come after `<kbd>` restoration so nested `<kbd>` tags are already converted to markers

### Phase 3: HTML Cleanup
**Purpose**: Remove structural HTML tags before annotation processing

| Order | Line | Operations | Notes |
|-------|------|------------|-------|
| 7 | 355-365 | Remove all `<div>`, `<section>`, `<article>` tags | Structural containers shouldn't appear in rich text |
| 8 | 369-370 | Remove incomplete HTML tags | Safety cleanup for chunked content |
| 9 | 373 | Normalize whitespace | Collapse multiple spaces |

### Phase 4: Iframe & Media Processing
**Purpose**: Extract and create blocks for embedded content

| Order | Line | Element | Block Type | Notes |
|-------|------|---------|-----------|-------|
| 10 | 382-409 | `<iframe>` tags | Video/embed blocks | Check for video URLs, create video blocks |
| 11 | 411-549 | `<img>` tags | Image blocks | Download ServiceNow images, external URL for others |

### Phase 5: Span & Inline Formatting
**Purpose**: Apply semantic formatting to inline elements

| Order | Line | Element/Class | Marker | Notes |
|-------|------|---------------|--------|-------|
| 12 | 550 | `<span class="uicontrol">` | `__BOLD_BLUE_START__...__BOLD_BLUE_END__` | UI control names |
| 13 | 564 | `<span class="sectiontitle tasklabel">` | `__BOLD_START__...__BOLD_END__` | Section titles |
| 14 | 574-649 | Technical identifiers (`ph`, `keyword`, `parmname`, `codeph`) | `__CODE_START__` or plain text | Check for CODE block context, technical patterns |

**Why this order?**
- Most specific classes first (`uicontrol`, `cmd`)
- Generic technical classes last (`ph`, `keyword`) to avoid overriding specific handlers

### Phase 6: Standard HTML Tags
**Purpose**: Convert standard HTML formatting to markers

| Order | Line | Element | Marker | Notes |
|-------|------|---------|--------|-------|
| 15 | 651 | `<code>` | `__CODE_START__...__CODE_END__` | Inline code blocks |
| 16 | 655 | `<strong>`, `<b>` | `__BOLD_START__...__BOLD_END__` | Bold text |
| 17 | 658 | `<em>`, `<i>` | `__ITALIC_START__...__ITALIC_END__` | Italic text |
| 18 | 661 | `<u>` | `__UNDERLINE_START__...__UNDERLINE_END__` | Underlined text |
| 19 | 664 | `<s>`, `<strike>` | `__STRIKETHROUGH_START__...__STRIKETHROUGH_END__` | Strikethrough text |

### Phase 7: Links
**Purpose**: Extract and store link information

| Order | Line | Element | Storage | Notes |
|-------|------|---------|---------|-------|
| 20 | 678-702 | `<a>` tags | `__LINK_N__` placeholder + links array | Extract href, decode entities, store for later processing |

### Phase 8: Marker Conversion to Annotations
**Purpose**: Convert all markers to Notion annotation format

| Order | Line | Marker Type | Annotation | Notes |
|-------|------|-------------|------------|-------|
| 21 | 704-870 | Split text by markers | N/A | Regex pattern matches all marker types |
| 22 | Various | `__BOLD_START__` | `{ bold: true }` | |
| 23 | Various | `__ITALIC_START__` | `{ italic: true }` | |
| 24 | Various | `__CODE_START__` | `{ code: true }` | |
| 25 | Various | `__UNDERLINE_START__` | `{ underline: true }` | |
| 26 | Various | `__STRIKETHROUGH_START__` | `{ strikethrough: true }` | |
| 27 | Various | `__BOLD_BLUE_START__` | `{ bold: true, color: 'blue' }` | UI controls |

---

## Processing Order in `rich-text.cjs` → `convertRichTextBlock()`

**Used for**: Table cell content, simpler text processing

### Phase 1: Link Extraction
| Order | Line | Element | Placeholder | Notes |
|-------|------|---------|-------------|-------|
| 1 | 137-147 | `<a>` tags | `__LINK_N__` | Extract links first, add soft breaks after |

### Phase 2: Standard Formatting
| Order | Line | Element | Marker | Notes |
|-------|------|---------|--------|-------|
| 2 | 155 | `<strong>`, `<b>` | `__BOLD_START__...__BOLD_END__` | Bold |
| 3 | 157 | `<em>`, `<i>` | `__ITALIC_START__...__ITALIC_END__` | Italic |

### Phase 3: Keyboard Input
| Order | Line | Element | Marker | Notes |
|-------|------|---------|--------|-------|
| 4 | 159-188 | `<kbd>` | `__CODE_START__` or `__BOLD_START__` | Intelligent detection (same as servicenow.cjs) |

### Phase 4: Code
| Order | Line | Element | Marker | Notes |
|-------|------|---------|--------|-------|
| 5 | 190-198 | `<code>` | `__CODE_START__...__CODE_END__` | Inline code |

### Phase 5: Semantic Spans
| Order | Line | Element/Class | Marker | Notes |
|-------|------|---------------|--------|-------|
| 6 | 200-203 | `<span class="uicontrol">` | `__BOLD_BLUE_START__...__BOLD_BLUE_END__` | UI controls |
| 7 | 207-211 | `<span class="ph cmd">` | `__BOLD_START__...__BOLD_END__` | Commands (MUST be before generic `ph` handler) |
| 8 | 213-245 | Technical spans (`ph`, `keyword`, `parmname`, `codeph`) | `__CODE_START__` or plain text | Generic handler, runs last |

### Phase 6: Marker Conversion
| Order | Line | Operation | Notes |
|-------|------|-----------|-------|
| 9 | 265-388 | Split and convert markers | Same as servicenow.cjs |

---

## Critical Dependencies & Rules

### ✅ Must-Follow Rules

1. **Extract before process**: Elements that need special handling (URLs, `<kbd>`) must be extracted to placeholders BEFORE other processing
2. **Restore before siblings**: Placeholders must be restored to markers BEFORE sibling elements are processed
3. **Specific before generic**: Handler order matters:
   - `<span class="ph cmd">` BEFORE `<span class="ph">`
   - `<span class="uicontrol">` BEFORE `<span class="ph">`
4. **Both paths must match**: `servicenow.cjs` and `rich-text.cjs` must handle elements in compatible order
5. **Nested structure**: Outer elements should be processed after inner elements are converted to markers

### ❌ Common Pitfalls

| Issue | Cause | Solution |
|-------|-------|----------|
| Raw `__PLACEHOLDER__` visible | Handler runs before placeholder restoration | Move handler after restoration phase |
| Missing formatting | Generic handler runs before specific handler | Move specific handler earlier |
| Broken URLs | Entity decode before URL extraction | Extract URLs first, then decode |
| Incorrect nesting | Parent processed before child converted | Process child first (extract → restore → parent) |

---

## Example: Nested Elements Processing

For HTML: `<span class="ph cmd">Click <kbd class="ph userinput">Save</kbd></span>`

**servicenow.cjs flow**:
```
1. Extract <kbd>: "Click __KBD_PLACEHOLDER_0__"
2. Restore <kbd>: "Click __BOLD_START__Save__BOLD_END__"  (UI label → bold)
3. Process cmd span: "__BOLD_START__Click __BOLD_START__Save__BOLD_END____BOLD_END__"
4. Convert markers: Nested bold annotations
```

**Why it works**: `<kbd>` is converted to markers BEFORE `cmd` span is processed, so `cmd` handler sees markers, not placeholders.

---

## Technical Identifier Detection

Both files use similar logic to detect technical content vs. UI labels:

### Technical Indicators (→ code formatting)
- URLs: `/^https?:\/\//i`
- Paths: `/^[\/~]/i`
- Placeholders: `/<[^>]+>/i`
- Domain extensions: `/\.(com|net|org|io|dev|gov|edu)/i`
- Dotted identifiers: `/^[\w\-]+\.[\w\-]+\./`
- Constants: `/^[A-Z_]{4,}$/` (4+ chars)
- Code characters: `/[\[\]{}();]/`
- Programming identifiers: `/^[a-z_][a-z0-9_]*$/i` with underscore or camelCase

### UI Labels (→ bold formatting)
- Short words without technical indicators
- Button labels like "Save", "Cancel", "OK"
- Menu items
- Dialog titles

### CODE Block Context Check
If text appears in a parent block of type `code`, it's treated as technical even if it doesn't match patterns above.

---

## Marker Patterns Reference

| Marker | Opening | Closing | Notion Annotation |
|--------|---------|---------|-------------------|
| Bold | `__BOLD_START__` | `__BOLD_END__` | `{ bold: true }` |
| Italic | `__ITALIC_START__` | `__ITALIC_END__` | `{ italic: true }` |
| Code | `__CODE_START__` | `__CODE_END__` | `{ code: true }` |
| Underline | `__UNDERLINE_START__` | `__UNDERLINE_END__` | `{ underline: true }` |
| Strikethrough | `__STRIKETHROUGH_START__` | `__STRIKETHROUGH_END__` | `{ strikethrough: true }` |
| Bold Blue | `__BOLD_BLUE_START__` | `__BOLD_BLUE_END__` | `{ bold: true, color: 'blue' }` |
| Link | `__LINK_N__` | N/A | Stored in links array |
| Soft Break | `__SOFT_BREAK__` | N/A | Creates separate text segment |

---

## When to Add New Handlers

1. **Identify the element**: What HTML tag or class needs special handling?
2. **Choose the path**: Does it appear in paragraphs (servicenow.cjs) or table cells (rich-text.cjs) or both?
3. **Determine the phase**: 
   - Needs protection? → Phase 1 (Extract)
   - Has nested elements? → Phase 2 (Restore after nested elements)
   - Semantic meaning? → Phase 5 (Semantic spans)
   - Standard HTML? → Phase 6 (Standard tags)
4. **Position carefully**: Place before generic handlers, after nested element restoration
5. **Add to BOTH files**: Ensure consistent handling in both processing paths
6. **Test nesting**: Test with nested elements to ensure correct processing order

---

## Testing Recommendations

For each new handler, test:

1. **Standalone**: `<element>content</element>`
2. **Nested in span**: `<span class="ph cmd"><element>content</element></span>`
3. **Containing nested**: `<element><kbd>nested</kbd></element>`
4. **In table cell**: Same HTML in a table cell (uses rich-text.cjs path)
5. **Multiple instances**: Multiple occurrences in same paragraph
6. **Edge cases**: Empty content, special characters, entities

---

## Recent Changes Log

| Date | Change | Reason | Files |
|------|--------|--------|-------|
| 2025-10-23 | **Consolidated formatting logic** into shared utility | Reduce duplication, simplify maintenance, ensure consistency | `server/utils/html-formatting.cjs` (NEW), `servicenow.cjs`, `rich-text.cjs` |
| 2025-10-23 | Moved `cmd` span handler from line 556 to 348 | Nested `<kbd>` inside `cmd` spans showing raw placeholders | servicenow.cjs |
| Earlier | Added `<kbd>` intelligent detection | `<kbd>` tags appearing as plain text | servicenow.cjs, rich-text.cjs |
| Earlier | Added `cmd` class handler | `<span class="ph cmd">` showing raw markers | servicenow.cjs, rich-text.cjs |

---

## Shared Utilities (NEW)

**File**: `server/utils/html-formatting.cjs`

This new module consolidates common HTML formatting logic used by both processing paths:

### Key Functions

| Function | Purpose | Used By |
|----------|---------|---------|
| `isTechnicalContent(content)` | Detect if content is technical (code) vs UI label (bold) | Both paths |
| `processKbdContent(content)` | Process `<kbd>` tags with intelligent detection | Both paths |
| `processTechnicalSpan(content, options)` | Process technical identifier spans (simplified logic) | Both paths |
| `decodeHtmlEntities(html)` | Decode HTML entities consistently | Both paths |
| `isInCodeBlock(options)` | Check if in CODE block context | Both paths |
| `wrapWithMarkers(content, type)` | Wrap content with annotation markers | Utility |

### Technical Detection Patterns (Consolidated)

All patterns moved from duplicated code in both files to single source:

```javascript
const TECHNICAL_PATTERNS = {
  url: /^https?:\/\//i,
  path: /^[\/~\\]/i,
  placeholder: /<[^>]+>/i,
  domain: /\.(com|net|org|io|dev|gov|edu|mil|info|biz|tech|app|co|us|uk)/i,
  dottedIdentifier: /^[\w\-]+\.[\w\-]+\./,
  constant: /^[A-Z_]{4,}$/,
  codeChars: /[\[\]{}();]/,
  programmingId: /^[a-z_][a-z0-9_]*$/i,
  hasUnderscore: /_/,
  isCamelCase: /[a-z][A-Z]/
};
```

**Benefits**:
- ✅ Single source of truth for technical detection
- ✅ Easier to update patterns (change once, applies everywhere)
- ✅ Consistent behavior between paragraphs and table cells
- ✅ Reduced code duplication (~100 lines eliminated)
- ✅ Better testability (test utility functions directly)

---

## Quick Reference: Line Numbers (Updated 2025-10-23)

### servicenow.cjs
- **252**: `<kbd>` extraction
- **270**: URL extraction  
- **313**: URL restoration
- **~326**: `<kbd>` restoration (NOW USES SHARED UTILITY: `processKbdContent`)
- **~355**: `cmd` span handler ⚡ (CRITICAL: After kbd restoration, USES SHARED UTILITY)
- **~488**: Technical identifier spans (NOW USES SHARED UTILITY: `processTechnicalSpan`)
- **~547**: `uicontrol` span handler
- **~638**: `<code>` tag
- **~642**: `<strong>`, `<b>` tags
- **~665**: `<a>` link extraction
- **~691**: Marker conversion to annotations

### rich-text.cjs
- **137**: `<a>` link extraction
- **155**: `<strong>`, `<b>` tags
- **~161**: `<kbd>` intelligent detection (NOW USES SHARED UTILITY: `processKbdContent`)
- **~175**: `<code>` tag
- **~185**: `uicontrol` span handler
- **~192**: `cmd` span handler ⚡ (CRITICAL: Before generic ph handler)
- **~200**: Technical identifier spans (NOW USES SHARED UTILITY: `processTechnicalSpan`)
- **~250**: Marker conversion to annotations

⚠️ **Note**: Line numbers are approximate after consolidation. Use grep to find exact locations.

---

## Debugging Tips

1. **Enable verbose logging**: Set `SN2N_VERBOSE=1` and `SN2N_EXTRA_DEBUG=1`
2. **Check console output**: Look for `🔍 [parseRichText]` and `🔍 [rich-text.cjs]` messages
3. **Search for placeholders**: If raw `__*_PLACEHOLDER__` appears in output, handler order is wrong
4. **Verify markers**: After processing, all content should have `__*_START__` markers, not placeholders
5. **Test both paths**: Test same HTML in paragraph AND table cell to ensure consistency

---

## Future Improvements

1. **Consolidate handlers**: Consider extracting common logic to shared utility
2. **Add validation**: Verify marker balance (every `START` has matching `END`)
3. **Performance**: Consider single-pass processing instead of multiple regex passes
4. **Documentation**: Keep this doc updated with every handler change
5. **Test suite**: Automated tests for all processing order combinations
