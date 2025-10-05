# Release 8.1.0 — ServiceNow-2-Notion

Release date: 2025-10-05 (local)

## Summary

This release focuses on comprehensive code block extraction and formatting improvements, ensuring JavaScript code blocks from ServiceNow documentation are properly displayed as formatted code blocks in Notion pages.

## Highlights

- Code Block Extraction

  - **Enhanced JavaScript Detection**: Improved pattern matching to correctly identify JavaScript code blocks and apply proper language formatting
  - **Placeholder-Based Processing**: Implemented a robust system where `<pre>` elements are extracted and replaced with placeholders during HTML processing, then substituted back with properly formatted code blocks
  - **Mixed Content Handling**: Code blocks within list items (containing both descriptive text and code) are now properly handled - text is preserved and code blocks are added as separate blocks
  - **Language Preservation**: Code blocks are correctly formatted with `javascript` language for syntax highlighting in Notion

- HTML Formatting

  - **Rich Text Preservation**: Enhanced HTML-to-Notion conversion with marker-based parsing for bold text (`<span class="uicontrol">`), italic text, and links
  - **Content Integrity**: Fixed content loss issues when code blocks were embedded within complex HTML structures

- Debugging & Reliability

  - **Enhanced Logging**: Added detailed debugging information for code block processing and placeholder replacement
  - **Error Handling**: Improved error handling for mixed content scenarios and edge cases

- Build & Distribution
  - Bumped package version to `8.1.0` and rebuilt `dist/ServiceNow-2-Notion.user.js` with updated metadata
  - Created a timestamped backup of key files in `backups/8.1.0-<timestamp>/`

## Files Changed

- `package.json` — version bumped to `8.1.0`
- `src/config.js` — `PROVIDER_VERSION` set to `8.1.0`
- `src/content/content-extractor.js` — enhanced code block detection and processing
- `src/main.js` — improved content extraction coordination
- `server/sn2n-proxy.cjs` — implemented placeholder-based extraction system and mixed content handling
- `dist/ServiceNow-2-Notion.user.js` — rebuilt userscript with updated metadata
- `CHANGELOG.md` — updated with detailed release notes

## Technical Details

The core improvement was implementing a placeholder-based extraction system:

1. **Extraction Phase**: `<pre>` elements are identified and extracted from the HTML, replaced with unique placeholders like `___PRE_PLACEHOLDER_0___`
2. **Processing Phase**: HTML is processed normally with preserved structure
3. **Replacement Phase**: Placeholders are substituted back with properly formatted Notion code blocks, handling both pure code blocks and mixed content scenarios

This approach ensures that code blocks embedded within list items or other complex structures are correctly extracted and formatted without losing surrounding content.

## Notes & Next Steps

- All code blocks from ServiceNow documentation should now appear as properly formatted JavaScript code blocks in Notion
- HTML formatting (bold text, links, lists) is preserved during conversion
- Consider tagging the release and creating a GitHub release entry with these release notes
- The userscript maintains backward compatibility with existing user settings

## Testing

- Verified code blocks in list items display correctly
- Confirmed code blocks in standalone sections work properly
- Validated HTML formatting preservation (bold, italic, links)
- Tested with various ServiceNow documentation page structures