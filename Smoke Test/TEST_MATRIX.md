# Smoke Test Matrix — ServiceNow-2-Notion

This document lists the smoke-test scenarios included in `Smoke Test/proxy-smoke-test.cjs` and gaps where we don't yet have representative fixtures. Use this as the single source of truth for what the smoke test covers and the expected outcome for each scenario.

## Included scenarios

- callout-with-list
  - Purpose: Verify that ServiceNow callouts (note/warning blocks) that include nested lists (UL/OL) are converted to Notion `callout` blocks and that nested list items are preserved as separate `bulleted_list_item` or `numbered_list_item` blocks.
  - Expected outcome: `callout` block exists; at least two `bulleted_list_item` blocks are present.

- duplicate-image-dedup
  - Purpose: Ensure uploaded ServiceNow images (identified by `file_upload.id`) are deduplicated so that duplicate uploaded images are not produced as separate Notion `image` blocks.
  - Expected outcome: No duplicate `image` blocks with identical `image.file_upload.id`.
  - Notes: External images (image.external.url) may legitimately appear more than once in dryRun output; current test does not fail on duplicate external URLs.

- table-with-figure
  - Purpose: Verify that `<figure><img/></figure>` nested inside tables becomes a Notion `image` block and that table structure is preserved as a `table` block.
  - Expected outcome: At least one `table` block and at least one `image` block in the output.

- html-entity-decoding
  - Purpose: Ensure HTML entities (e.g., `&lt;div&gt;`) are decoded and tags are stripped so that literal tags do not render as text in Notion rich_text.
  - Expected outcome: No paragraph or callout rich_text content contains literal `<div` or `&lt;div` substrings.

- rich-text-splitting
  - Purpose: Simulate long, fragmented HTML content to ensure Notion rich_text arrays are split (we check that no single paragraph has an excessively large number of rich_text fragments).
  - Expected outcome: No single paragraph/callout rich_text array longer than 120 entries.

## Not-covered / Missing scenarios (recommend adding fixtures)

These are situations we should add fixtures for to further harden the conversion pipeline:

- Deeply nested lists inside callouts (3+ levels)
  - Why: Notion supports only two levels for list blocks in our converter; we should document expected behavior and test fallback handling (nested lists flattened vs chunked).

- Mixed inline formatting in lists inside callouts (bold, italic, code spans, links)
  - Why: Ensure rich_text annotations survive and are preserved across nested conversion + marker orchestration.

- Tables with complex cells (colspan/rowspan, nested lists, inline code)
  - Why: Table conversion is one of the trickiest and prone to content loss; add fixtures that exercise merged cells and lists inside table cells.

- Code blocks inside callouts or tables
  - Why: Ensure code fences and preformatted text are detected and converted to Notion `code` blocks or `code` rich_text appropriately.

- Multiple figures with captions and alt text (figure + figcaption)
  - Why: Verify caption extraction into adjacent paragraph blocks or into the image `caption` field.

- Images with query-string variations (same image URL with different query params)
  - Why: If we normalize external URLs for dedupe, ensure we have fixtures showing whether query params should be ignored or preserved.

- Embedded iframes and third-party embeds
  - Why: Some ServiceNow pages embed videos or interactive widgets; ensure stable behavior (either map to embed blocks or strip safely).

- Callouts that contain tables
  - Why: Validate markers and orchestration correctly append child blocks when nested complex blocks (like `table`) appear inside callouts.

- Rich text with heavy HTML entities and escaped fragments mixed with tags
  - Why: Edge case for `cleanHtmlText()` where order of decoding vs stripping must be correct.

- Lists where items include figures or images
  - Why: Ensure images inside list items are preserved and associated with the correct list item.

- Multiple numbered lists on same page with proper nesting and numbering restart
  - Purpose: Verify that when a paragraph contains a nested `<ol>`, the numbered list items are nested as children of the paragraph block, and that multiple such paragraphs on the same page each have their numbered lists restart at 1 (not continue numbering from previous lists).
  - Test URL: https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/concept/c_CreateAndManageSWSuite.html
  - Expected outcome: 
    - Paragraph "To make the new software model record a parent record in a suite:" has numbered list items 1-5 as children
    - Paragraph "To make the new software record a child item:" has numbered list items 1-4 as children (restarts at 1, not continues to 6-9)
    - No divider blocks inserted between procedures
    - Lists are indented under their parent paragraphs in Notion UI
  - Why: Notion auto-continues numbered lists at the same nesting level; only nesting under a parent block forces restart. This tests proper HTML structure preservation and semantic nesting.

- Paragraph with nested list vs paragraph with nested image/figure
  - Purpose: Verify that list elements (`<ul>`, `<ol>`) nested in paragraphs become children of the paragraph block, while non-list elements like `<figure>` become siblings at the root level.
  - Test URL: Same as above (https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/concept/c_CreateAndManageSWSuite.html)
  - Expected outcome:
    - Paragraph "Use the Inference percent and Inference mandatory options..." has bulleted list as children (nested)
    - Paragraph "For example, specify the Inference percent as 80%..." is followed by Image "Figure 1. The interference percent..." as a sibling (not nested)
    - Image appears at root level in Notion, not indented under the paragraph
  - Why: Lists are semantically related to their parent paragraph and should nest; images are independent content and should be siblings to avoid incorrect indentation.

## Suggested next steps

1. Add fixtures for the highest-risk missing scenarios (deeply nested lists in callouts, tables with complex cells, and callout-with-table).
2. Decide on dedupe policy for external images and implement URL normalization + tests if desired.
3. Add unit tests for `computeBlockKey()` and `dedupeAndFilterBlocks()` to lock behavior.
4. After expanding the matrix, add CI or a `npm test` script that runs the smoke tests against a locally started dev server.

## How to run

See `Smoke Test/README.md` — start the proxy (`npm run start`) and run `node "Smoke Test/proxy-smoke-test.cjs"`.
