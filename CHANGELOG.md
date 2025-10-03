# Changelog

All notable changes to ServiceNow-2-Notion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.0.0] - 2025-10-03

Release date: 2025-10-03 (local)

Summary
-------
This release focuses on robust image handling (especially ServiceNow-hosted images), table compatibility with Notion, and stability improvements to the HTML-to-Notion conversion pipeline.

Highlights
----------
- Images
  - Full download-and-upload flow for images: the proxy now downloads images (supporting authenticated ServiceNow-hosted images) and uploads them to Notion using the Notion file upload flow.
  - Inline images in paragraphs are preserved and positioned correctly in the Notion page flow (image-only paragraphs no longer get dropped).
  - Disabled Martian conversion bypass for HTML-to-Notion conversion to ensure custom image handling is used.

- Tables
  - Userscript now replaces images and SVGs inside `<table>` markup with a bullet symbol (•) before sending HTML to the proxy; Notion does not support images in table cells, so bullets act as placeholders.
  - Server-side table parsing (`parseTableToNotionBlock`) inspects `<thead>` vs `<tbody>` and uses the first tbody row to decide whether to treat the row as a header (if the first tbody row contains images, header row is disabled).

- Conversion
  - Improved HTML parsing and extraction logic; removed earlier behavior that extracted all images at the top of the page (which caused images to appear above content).
  - Added robust logging and SN2N_VERBOSE flag for verbose troubleshooting.

- Build & Distribution
  - Bumped package version to `8.0.0` and rebuilt `dist/ServiceNow-2-Notion.user.js` with updated metadata.
  - Created a timestamped backup of key files in `backups/8.0.0-<timestamp>/`.

Files Changed
-------------
- `package.json` — version bumped to `8.0.0`
- `src/config.js` — `PROVIDER_VERSION` set to `8.0.0`
- `src/content/content-extractor.js` — added table image/SVG replacement and logging
- `server/sn2n-proxy.cjs` — improved image download/upload flow and paragraph image handling
- `dist/ServiceNow-2-Notion.user.js` — rebuilt userscript with updated metadata

Notes & Next Steps
------------------
- Consider tagging the release and creating a GitHub release entry with the release notes below.
- If you want the userscript header to also appear inside `src/main.js` (some copies exist), I can search and update any additional version constants; I updated the primary `src/config.js` constant which is referenced in `src/main.js`.
- I did not change any behavior that would affect backward compatibility for saved user settings.

Acknowledgements
----------------
Thanks for the detailed debugging logs and sample pages — they made tracking the image stripping easy.

## Historical Notes

### Universal Workflow Removal

Overview

The Universal Workflow module previously provided an alternate processing path
via an external workflow component. It has been removed from the project and
all callers now use the proxy-based processing implementation.

What changed

- `src/api/workflow-api.js` has been removed/replaced by a minimal placeholder
  to prevent import-time errors during transition.
- `src/main.js` now always uses the proxy flow for processing content.
- `dist/ServiceNow-2-Notion.user.js` is rebuilt and no longer contains any
  Universal Workflow-related logic or debug messages.

Developer notes

- If you maintained custom extractors or integrations that relied on the
  Universal Workflow module, you'll need to migrate them to either:

  - Proxy-side processing (recommended): implement server-side handlers that
    perform the workflow logic, or
  - Local conversion utilities: update the userscript to perform conversion
    tasks directly in the browser.

- To permanently remove the placeholder `src/api/workflow-api.js`, ensure no
  remaining code imports it and then delete the file and rebuild.

Contact

If you need help migrating existing workflow extractors or automation, open an
issue or ask for a migration plan in the repo's issue tracker.