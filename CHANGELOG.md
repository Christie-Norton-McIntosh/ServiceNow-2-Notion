# CHANGELOG — ServiceNow-2-Notion

## Version: 11.0.6
Date: 2025-11-10

### Summary

**Debugging Enhancement**: Added comprehensive logging to diagnose image orchestration failures where markers are visible during extraction but images aren't placed.

### Issue
For some pages (e.g., "Add a document to a contract"), child images with markers are not being placed at their marker locations. Markers appear during extraction but are removed without appending the images.

### Enhanced Logging

Added detailed logging at key orchestration points:

1. **Image Block Detection**: Logs when markers contain image blocks
2. **Parent Search Results**: Tracks whether parent is found or not for image markers
3. **Image URL Logging**: Shows image URLs in append logs
4. **BFS Search Tracking**: Logs marker search start and failure with visited blocks list

### Debug Keywords
- `[IMAGE-DEBUG]` - Image orchestration tracking
- `[MARKER-SEARCH]` - BFS marker search results

### Usage
```bash
SN2N_VERBOSE=1 npm start
```

Look for log patterns to diagnose:
- Are images being marked and collected?
- Is the marker being found during orchestration?
- Where do images end up (parent vs page root)?

See `docs/image-marker-debugging-v11.0.6.md` for complete debugging guide.

**Files Modified**:
- `server/orchestration/deep-nesting.cjs`: Enhanced logging for image orchestration
- `docs/image-marker-debugging-v11.0.6.md`: Debugging guide

---

## Version: 11.0.4
Date: 2025-11-10

### Summary

**Critical Fix**: Context-aware deduplication prevents removal of intentionally repeated images and tables in procedural content.

### Problem

Two validation failures revealed that post-orchestration deduplication was too aggressive:
1. **Images**: Same icon appearing in different procedural steps was deduplicated (expected 2, got 1)
2. **Tables**: Identical tables in different procedural steps were deduplicated (expected 3, got 2)

### Solution

Modified post-orchestration deduplication to **preserve images and tables that are children of list items** (procedural steps). These often legitimately repeat:
- Icons guide users through multiple steps
- Tables with identical structure appear in different procedural contexts

### Changes

- **Context-Aware Deduplication** (`server/routes/w2n.cjs`):
  - Detects parent block type (list item vs other)
  - Skips deduplication for images and tables inside list items
  - Preserves deduplication for callouts (true duplicates)
  - Logs preserved blocks for debugging

### Validation Results

```
Total files tested: 2
✅ Passed: 2 (100.0%)
❌ Failing: 0 (0.0%)
```

Both previously failing pages now pass validation.

### Technical Details

**Before**: All images/tables deduplicated by URL/content globally  
**After**: Images/tables in list items exempted from deduplication  
**Rationale**: Procedural content intentionally repeats visual guidance across steps

**Files Modified**:
- `server/routes/w2n.cjs`: Added context detection and skip logic
- `docs/context-aware-deduplication-fix.md`: Full documentation

---

## Version: 11.0.3
Date: 2025-11-10

### Summary

**UI Enhancement**: Added localStorage persistence for UI panel position to prevent blocking navigation buttons during AutoExtract operations.

### Changes

#### UI Panel Position Persistence
- **Problem**: Panel always appeared at top-right corner (20px, 20px) after page reload, potentially covering ServiceNow navigation buttons
- **Solution**: Position now persists across page reloads using localStorage
- **Features**:
  - Automatic save when dragging ends
  - Automatic restore on page load with validation
  - Off-screen position detection and cleanup
  - New reset button (↗️) to restore default position
  - Success toast notification on reset
- **Benefits**: 
  - Users can position panel away from navigation buttons
  - Improves AutoExtract reliability
  - Position persists throughout multi-page operations
- **Technical**: Uses `localStorage` key `w2n-panel-position` with JSON value `{ left, top }`
- **Validation**: Ensures restored position is on-screen (8px margin from all edges)

**Files Modified**:
- `src/ui/main-panel.js`: Added position save/restore logic, reset button
- `docs/ui-panel-persistence.md`: Full documentation

---

## Version: 11.0.0
Date: 2025-11-09

### Summary

**Major Release**: Consolidates all v10.x improvements into a stable, production-ready release with intelligent navigation retry, comprehensive rate limit protection, and complete content extraction validation fixes.

### Highlights

- **Intelligent Navigation Retry System**: Auto-retry failed navigation up to 2 times with smart duplicate detection
- **Comprehensive Rate Limit Protection**: Server-side exponential backoff + client-side pause with failed pages tracking
- **5 Critical Validation Fixes**: Standalone images, table duplication, deeply nested tables, DataTables wrappers, callouts in lists
- **Enhanced Error Handling**: Post-response logging, better error messages, improved recovery
- **Full Backup System**: Versioned backups with detailed restoration instructions

### Major Features

#### Navigation Retry System (v10.0.38)
- Detects navigation failures (URL/pageId unchanged after click)
- Retries navigation immediately up to 2 times before confirming end-of-book
- Smart duplicate URL detection distinguishes expected vs unexpected duplicates
- End-of-book confirmation dialog prevents premature stops
- navigationFailures counter tracks consecutive failures
- Detailed debug logging with `[NAV-RETRY]` prefix

**Commit**: `e3105a6` - Navigation retry logic

#### Rate Limit Protection (v10.0.29)
- **Server-side**: Exponential backoff retry (5 attempts, 10s → 60s wait)
- **Client-side**: 60-second pause with automatic retry on rate limit hit
- **Failed pages tracking**: Maintains list with URL, title, timestamp, reason
- **Completion summary**: Shows successful vs failed pages breakdown
- **GM storage persistence**: Failed pages saved for manual retry

**Commit**: `e8fcf5d` - Rate limit protection and validation fixes

#### Content Extraction Validation Fixes (Issues #1-5)

**Issue #1: Standalone Images Not Extracted**
- Fixed standalone `<img>` tags outside `<figure>` elements
- Added external URL fallback when downloadAndUploadImage unavailable
- Comprehensive diagnostic logging for image processing

**Issue #2: Table Duplication**
- Added diagnostics to track table processing through conversion
- Enhanced logging shows when single table converts to multiple blocks
- Table deduplication utility prevents consecutive identical tables

**Issue #3: Tables in Deeply Nested Lists**
- Recursive block detection in nested `<ul>` and `<ol>` structures (3+ levels)
- Search inside wrapper divs for deeply nested tables
- Maintains proper list item text separation from nested blocks

**Issue #4: Complex DataTables Wrapper Nesting**
- Multi-pass Cheerio unwrapping (up to 10 passes) handles deep nesting
- Unwraps `dataTables_wrapper`, `dataTables_filter`, `zDocsFilterTableDiv`, etc.
- Recursively processes nested wrapper divs before table extraction

**Issue #5: Callouts in Lists Not Extracted**
- Process block-level children (`<div class='note'>`) within `<li>` elements
- Recursive search inside wrapper divs (`div.p`, `div.itemgroup`, etc.)
- Maintains proper callout formatting and color in nested contexts

**Commit**: `e8fcf5d` - Validation fixes implementation

### Technical Improvements

- **Enhanced Error Handling**: Post-response logging prevents client timeout
- **Array.from() Pattern**: Prevents skipped nodes during DOM iteration
- **Placeholder Markers**: Preserve newlines during whitespace normalization
- **Global Validation**: Added `isValidNotionUrl` for URL validation
- **Test Harness**: Enhanced `test-run-extract.cjs` with URL validation

### Documentation

- **RATE_LIMIT_PROTECTION.md**: Comprehensive rate limit guide with troubleshooting
- **RELEASE_NOTES_11.0.0.md**: Full feature list and migration guide
- **Backup System**: `backups/v10.0.38-20251109-202651/` with BACKUP_INFO.md
- **Updated Copilot Instructions**: Latest patterns and project structure

### Bug Fixes

- Navigation failures no longer stop AutoExtract prematurely
- Rate limiting doesn't cause content loss
- Standalone images extracted correctly
- Deeply nested tables no longer lost
- Callouts in lists extracted properly
- Post-response errors logged without crashing

### Breaking Changes

**None** - Version 11.0.0 is fully backward compatible with v10.x.

### Migration Guide

No action required. All v10.x features work identically in v11.0.0:
- Configuration preserved (GM storage)
- Property mappings maintained
- Database selections carried over

---

## Version: 10.0.0
Date: 2025-11-02

### Summary

**Major Release**: Complete overhaul of inline code formatting to ensure proper space handling in rich text elements. This is a breaking change that fundamentally improves how spaces are preserved around code-formatted text throughout Notion pages.

### Highlights

- **Global Code Block Space Cleanup**: All code-formatted text (role identifiers, multi-word identifiers, technical terms) now have leading and trailing spaces extracted as separate plain text elements
- **Proper Space Preservation**: Spaces between code blocks are now preserved as plain text, not included inside code formatting
- **Smart Space Detection**: Automatically detects and extracts spaces from code blocks, placing them BEFORE (leading) and AFTER (trailing) the code element as needed

### Technical Details

#### parseRichText Global Cleanup (`server/services/servicenow.cjs`)
- Added comprehensive space extraction logic at the end of `parseRichText()` function (lines 886-927)
- Iterates through all rich_text elements and identifies code-annotated text
- Extracts leading spaces and trailing spaces (only if followed by another element)
- Creates separate plain text rich_text elements for extracted spaces
- Ensures spaces appear between code blocks rather than inside them

#### Example Transformation
**Before v10.0.0:**
- `"admin "` (code) + `, ` (plain) + `" contract_manager"` (code) ❌

**After v10.0.0:**
- `"admin"` (code) + ` ` (plain) + `, ` (plain) + `"contract_manager"` (code) ✅

### Breaking Changes

- **Rich Text Structure**: Code blocks with spaces will now be split into multiple rich_text elements
- **Formatting Impact**: Any code that assumes spaces are included inside code-annotated text will need updates
- **Element Count**: More rich_text elements may be created per block (due to space extraction)

### Bug Fixes

- Fixed trailing spaces appearing inside inline code blocks throughout pages
- Fixed comma placement in role identifier lists (commas now outside code blocks)
- Fixed marker literal display (`__CODE_START__` appearing as text with spaces)
- Fixed role identifier regex to prevent matching marker underscores

### Files Changed

- `server/services/servicenow.cjs`: Added global code block space cleanup (lines 886-927)
- Multiple previous attempts at local cleanup (lines 3246-3395) now supplemented by global solution

### Migration Guide

No action required for most users. The change is transparent and improves formatting quality. If you have custom post-processing that assumes spaces inside code blocks, review the new rich_text structure.

---

## Version: 9.2.1
Date: 2025-10-18

## Summary

Patch release: housekeeping, docs updates, and fixes discovered during Notion exports.

## Highlights

- Exempt list items from deduplication to preserve identical procedural steps across lists.
- Implemented structural paragraph-level nesting for lists so Notion restarts numbered lists correctly without relying on divider insertion.
- Removed temporary debug flags and noisy logs; restored environment-driven debug behavior.
- Added a versioned backup archive in `backups/backup-9.2.1-20251018-000000/` containing critical files.

## Details

- Dedupe fix: `server/utils/dedupe.cjs` now skips deduplication for `numbered_list_item` and `bulleted_list_item`.
- Paragraph nesting: `server/services/servicenow.cjs` attaches `ul/ol/dl` list elements as children of paragraph blocks; non-list figures/images are emitted as siblings.
- Documentation: `docs/TEST_MATRIX.md` updated with new ServiceNow page scenarios; README and CHANGELOG updated.

## Bug Fixes (Table Formatting & Rich Text)

### Conditional image placeholders in tables
- **Problem**: All images in tables showed "See image below" placeholder, even when images weren't being uploaded to Notion.
- **Fix**: Track valid image URLs during extraction; use descriptive placeholder (`See "caption"` or `See image below`) only for valid images being uploaded; use bullet placeholder (`•`) for invalid/skipped images.
- **File**: `server/converters/table.cjs`
- **Commit**: 5578623

### Bullet formatting in table cells
- **Problem**: Multiple bullet items in table cells appeared on same line (e.g., "• Item1 • Item2 • Item3") instead of separate lines.
- **Fix**: Detect multiple bullets with regex pattern and insert newlines between each bullet item; clean leading whitespace after formatting.
- **File**: `server/converters/table.cjs`
- **Commit**: ae1a5a7

### UIControl formatting and newline preservation
- **Problem**: ServiceNow `<span class="ph uicontrol">` elements appeared as plain text instead of bold+blue formatting; newlines in table cells were being collapsed by whitespace normalization.
- **Fix**: 
  - Added uicontrol span detection with `__BOLD_BLUE_START__`/`__BOLD_BLUE_END__` markers
  - Changed whitespace handling from `/\s+/g` to `/[^\S\n]+/g` to preserve newlines while collapsing other whitespace
  - Added marker parsing for bold+blue formatting (matches ServiceNow UI element styling)
- **File**: `server/converters/rich-text.cjs`
- **Commit**: a3e819d

---

Version: 9.2.0
Date: 2025-10-16 / 2025-10-17

## Summary

This release adds robust handling for "access limited" pages during AutoExtract, fixes several content conversion issues (duplicate images, rich-text limits, icon/cover URLs), and includes multiple server-side converter improvements. The userscript was rebuilt and the proxy server updated where necessary.

## Highlights

- AutoExtract: Automatic reload-and-resume for pages that show the "Access to this content is limited to authorized users." message. The script will attempt up to 3 reloads and then skip the page if access is still restricted.
- Duplicate images: Fixed duplicate image blocks in Notion pages caused by mixed-content processing.
- Icon & cover images: Corrected GitHub raw URLs so page icons and covers appear on created Notion pages.
- SVG ClassName crash: Fixed TypeError when `element.className` is an SVGAnimatedString.
- Rich-text 100-element limit: Added splitting logic to ensure Notion API's 100-element per rich_text limit is respected.
- Table image extraction: Images inside table cells are extracted as separate image blocks with placeholder references inside table cells.

- Callout nested content preservation: ServiceNow callouts that contain nested lists, figures, or paragraphs are now preserved. The server creates the Notion callout with the callout text and appends nested blocks (for example, bulleted/numbered lists and figures) after page creation using the orchestrator. This preserves list structure inside Notion callouts instead of flattening to plain text.
  - Files: `server/services/servicenow.cjs`, `server/orchestration/deep-nesting.cjs`, `server/utils/notion-format.cjs`

## New features

### Access-limited page handling (AutoExtract)
- Detects access-limited pages via page title and H1 content.
- Auto-reloads the page up to 3 attempts (15s wait per reload; 5s between retries) to try to regain access.
- If access is not regained after 3 reloads the page is skipped (not saved to Notion) and the extractor proceeds to the next page.
- Toast and console feedback added for visibility.

### Resume-after-reload
- AutoExtract saves state using Tampermonkey `GM_setValue` before reload and resumes automatically after reload.
- `reloadAttempts` counter prevents infinite reload loops (max 3 attempts). On exceeding attempts, AutoExtract stops and alerts the user.

## Fixes

### Duplicate images in Notion pages
- Problem: Images were duplicated when a figure appeared inside paragraph/mixed content.
- Fix: Use `element.outerHTML` to remove nested block HTML correctly and skip image extraction from mixed text content so images are only processed once.
- File: `server/services/servicenow.cjs`.

### Icon and cover URLs
- Problem: GitHub raw URLs contained a duplicated folder segment and returned 404.
- Fix: Corrected URLs to `main/src/img/ServiceNow icon.png` and `main/src/img/ServiceNow cover.png`.
- File: `server/routes/w2n.cjs`.

### TypeError: className.toLowerCase is not a function
- Problem: `element.className` can be an `SVGAnimatedString` on SVG elements, causing `.toLowerCase()` calls to fail.
- Fix: Normalize className by checking type and using `.baseVal` if necessary.
- File: `src/ui/main-panel.js`.

### Rich-text 100-element Notion API limit
- Problem: Notion rejects `rich_text` arrays longer than 100 elements.
- Fix: Implemented `splitRichTextArray()` and split large rich_text arrays across multiple blocks (paragraphs/headings/list items/callouts) as needed.
- File: `server/converters/rich-text.cjs` (and usages in `services/servicenow.cjs`).

### Table image extraction
- Problem: Notion table cells cannot hold images; prior approach sometimes replaced images with bullets or lost images.
- Fix: Preserve `<figure>` elements, replace them with placeholders inside table cells, and extract figure images as separate image blocks immediately after the table.
- Files: `src/content/content-extractor.js`, `server/services/servicenow.cjs`.

### HTML tags appearing as text in paragraphs
- Problem: Raw HTML tags (like `<div class="note note note_note ">`) were appearing as literal text in paragraph blocks, and callout text content was duplicating (appearing both in the callout and in a surrounding paragraph). This was caused by:
  1. Entity-encoded HTML (like `&lt;div&gt;`) being decoded AFTER tag removal, causing the decoded tags to remain in the text
  2. Mixed content paragraphs using string replacement to remove nested blocks, which often failed due to HTML formatting differences
  3. When removal failed, the callout's text content remained and created a duplicate paragraph
- Fix: 
  1. Reversed the order of operations in `cleanHtmlText()` to decode HTML entities FIRST, then remove tags
  2. **PRIMARY FIX**: Replaced string-based `outerHTML.replace()` with Cheerio DOM manipulation using `.clone()` and `.remove()` (line ~1453)
  3. Added `cleanHtmlText()` call before `parseRichText()` to strip any remaining tags
  4. Added aggressive multi-pass tag stripping in fallback paragraph logic as a safety net
- Files: `server/utils/notion-format.cjs` (line ~133), `server/services/servicenow.cjs` (lines ~1453, ~1951).

## Build & Deployment

- Build command: `npm run build` (rollup config builds userscript to `dist/ServiceNow-2-Notion.user.js`).
- Built artifact: `dist/ServiceNow-2-Notion.user.js` (approx. 240–241 KB).
- Build output reported: `created dist/ServiceNow-2-Notion.user.js in ~190ms`.
- Server: `server/sn2n-proxy.cjs` (Express) runs on port 3004; restart required after server-side changes.

## Files changed (key)

- src/ui/main-panel.js — Added reload/resume logic, `isPageAccessLimited()`, `reloadAttempts` tracking, className fix.
- src/content/content-extractor.js — Preserve figures in table HTML and avoid client-side image replacement.
- server/services/servicenow.cjs — Cheerio based DOM traversal, duplicate image fix, table image extraction.
- server/routes/w2n.cjs — Fixed icon and cover external URLs.
- server/converters/rich-text.cjs — Added rich_text splitting logic to respect Notion limits.
- dist/ServiceNow-2-Notion.user.js — Rebuilt userscript including the above changes.

## Testing & Verification

- Testcases and guides added:
  - `docs/testing-table-images.md`
  - `docs/TESTING_SCENARIOS.md`
  - `docs/fix-rich-text-100-element-limit.md`
  - `docs/table-image-extraction.md`
- Manual tests documented for table images, duplicate image scenarios, and access-limited reload flows.
- Build & deployment reports and final summary added (`BUILD_DEPLOYMENT_REPORT.md`, `FINAL_SUMMARY_ACCESS_LIMITED.md`).

## Known limitations & notes

- Notion API: table cells cannot contain images — images are extracted and placed after tables as a workaround.
- Tampermonkey state uses `GM_setValue`/`GM_getValue` and is compatible with current userscript runtime (Tampermonkey/Greasemonkey variants may behave slightly differently).
- Manual Tampermonkey testing remains necessary for UI-driven checks.

## Next steps / Recommendations

- Run manual smoke tests across a set of sample ServiceNow pages (documented in `docs/testing-table-images.md`).
- Monitor server logs for any edge cases in HTML conversion (tables with nested figures, unusual figure structures).
- Consider adding a small automated integration test harness that sends sample HTML files to the proxy and verifies Notion-block outputs (low-priority).

---

For full implementation details, see the companion docs in `docs/` (flow diagrams, implementation guides, quick references) and the build report files in the repository root.
