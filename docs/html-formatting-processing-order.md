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
| 1 | ~260 | `<kbd>` tags | `__KBD_PLACEHOLDER_N__` | Extract user input/technical content (including URLs), decode HTML entities |
| 2 | ~275 | Decode entities | N/A | Global HTML entity decode AFTER kbd extraction |

**Why this order?**
- `<kbd>` tags handle most URLs since ServiceNow wraps technical content in `<kbd>`
- Extract kbd first to protect URLs with `&lt;` and `&gt;` from entity decode
- Entity decode happens after extraction to prevent breaking URL patterns in kbd tags

### Phase 2: Placeholder Restoration with Markers
**Purpose**: Convert placeholders to annotation markers that will be processed into Notion formatting

| Order | Line | Element | Marker Pattern | Logic |
|-------|------|---------|---------------|-------|
| 3 | ~288 | `<kbd>` restoration | `__CODE_START__` or `__BOLD_START__` | Intelligent detection: technical (including URLs) → code, UI labels → bold |
| 4 | ~295 | `<span class="uicontrol">` | `__BOLD_BLUE_START__...__BOLD_BLUE_END__` | UI control names |

**Why this order?**
- `<kbd>` tags are restored first, handling URLs and technical content automatically through intelligent detection
- `uicontrol` spans provide semantic highlighting for UI elements

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
| 12 | ~495 | `<span class="sectiontitle tasklabel">` | `__BOLD_START__...__BOLD_END__` | Section titles |

**Why this order?**
- This keeps formatting minimal and focused on truly semantic elements

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
| 6 | ~187 | `<span class="uicontrol">` | `__BOLD_BLUE_START__...__BOLD_BLUE_END__` | UI controls |

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
   - `<span class="uicontrol">` processes specifically for UI controls
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
3. cmd span is ignored (no handler): text passes through as-is
4. Convert markers: "Click" is plain text, "Save" is bold
```

**Result**: Only the `<kbd>` content gets formatting, the `cmd` span wrapper is ignored.

---

## Technical Identifier Detection

Both files use similar logic to detect technical content vs. UI labels:

### Technical Indicators (→ code formatting)
- Paths: `/^[\/~]/i`
- Placeholders: `/<[^>]+>/i`
- Domain extensions: `/\.(com|net|org|io|dev|gov|edu)/i`
- Dotted identifiers: `/^[\w\-]+\.[\w\-]+\./`
- Constants: `/^[A-Z_]{4,}$/` (4+ chars)
- Code characters: `/[\[\]{}();]/`
- Programming identifiers: `/^[a-z_][a-z0-9_]*$/i` with underscore or camelCase

**Note**: URLs are handled by `<kbd>` tags, not by this pattern matching

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
| 2025-10-23 | **Removed `cmd` class handler** | Too much bold text; `cmd` spans now appear as plain text with nested elements still formatted | servicenow.cjs, rich-text.cjs |
| 2025-10-23 | **Removed URL regex pattern from technical detection** | URLs now handled exclusively by `<kbd>` tags, pattern was redundant | html-formatting.cjs |
| 2025-10-23 | **Removed generic `ph` class from special formatting** | Generic `ph` class shouldn't get special formatting - appears as plain text | servicenow.cjs, rich-text.cjs |
| 2025-10-23 | **Removed redundant URL extraction regex** | `<kbd>` tags already handle URLs through intelligent detection | servicenow.cjs |
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
| `decodeHtmlEntities(html)` | Decode HTML entities consistently | Both paths |
| `isInCodeBlock(options)` | Check if in CODE block context | Both paths |
| `wrapWithMarkers(content, type)` | Wrap content with annotation markers | Utility |

### Technical Detection Patterns (Consolidated)

All patterns moved from duplicated code in both files to single source:

```javascript
const TECHNICAL_PATTERNS = {
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
- **~260**: `<kbd>` extraction (USES SHARED UTILITY: `processKbdContent`)
- **~275**: HTML entity decode
- **~288**: `<kbd>` restoration with intelligent detection
- **~295**: `uicontrol` span handler (bold + blue for UI controls)
- **~487**: `sectiontitle tasklabel` handler
- **~636**: `<code>` tag
- **~640**: `<strong>`, `<b>` tags
- **~663**: `<a>` link extraction
- **~689**: Marker conversion to annotations

### rich-text.cjs
- **~119**: `<a>` link extraction (strips technical span tags from link content)
- **~155**: `<strong>`, `<b>` tags
- **~159**: `<kbd>` intelligent detection (USES SHARED UTILITY: `processKbdContent`)
- **~190**: `<code>` tag
- **~187**: `uicontrol` span handler (bold + blue for UI controls)
- **~257**: Marker conversion to annotations

⚠️ **Note**: Line numbers are approximate after consolidation and recent changes. Use grep to find exact locations.

**Key Changes (2025-10-23)**:
- ✅ Removed redundant URL extraction - `<kbd>` tags now handle URLs
- ✅ Removed generic `ph` class from special formatting - only specific technical classes processed
- ✅ Consolidated formatting logic into shared utilities

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
