# CHANGELOG — ServiceNow-2-Notion

Version: 9.2.1
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
