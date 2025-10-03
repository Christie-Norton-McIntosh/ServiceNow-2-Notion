# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [8.0.0] - 2025-10-03

### Added

- Full download-and-upload flow for images: the proxy now downloads images (supporting authenticated ServiceNow-hosted images) and uploads them to Notion using the Notion file upload flow.
- Userscript now replaces images and SVGs inside `<table>` markup with a bullet symbol (•) before sending HTML to the proxy; Notion does not support images in table cells, so bullets act as placeholders.
- Server-side table parsing (`parseTableToNotionBlock`) inspects `<thead>` vs `<tbody>` and uses the first tbody row to decide whether to treat the row as a header (if the first tbody row contains images, header row is disabled).
- Robust logging and SN2N_VERBOSE flag for verbose troubleshooting.
- Timestamped backup of key files in `backups/8.0.0-<timestamp>/`.

### Changed

- Inline images in paragraphs are preserved and positioned correctly in the Notion page flow (image-only paragraphs no longer get dropped).
- Disabled Martian conversion bypass for HTML-to-Notion conversion to ensure custom image handling is used.
- Improved HTML parsing and extraction logic; removed earlier behavior that extracted all images at the top of the page (which caused images to appear above content).
- Bumped package version to `8.0.0` and rebuilt `dist/ServiceNow-2-Notion.user.js` with updated metadata.

### Removed

- Universal Workflow module: previously provided an alternate processing path via an external workflow component. All callers now use the proxy-based processing implementation.

### Fixed

- Image handling issues where ServiceNow-hosted images were not properly uploaded to Notion.
- Table compatibility with Notion by replacing images in table cells with placeholders.

### Notes

- Consider tagging the release and creating a GitHub release entry with the release notes below.
- If you want the userscript header to also appear inside `src/main.js` (some copies exist), I can search and update any additional version constants; I updated the primary `src/config.js` constant which is referenced in `src/main.js`.
- I did not change any behavior that would affect backward compatibility for saved user settings.

### Files Changed

- `package.json` — version bumped to `8.0.0`
- `src/config.js` — `PROVIDER_VERSION` set to `8.0.0`
- `src/content/content-extractor.js` — added table image/SVG replacement and logging
- `server/sn2n-proxy.cjs` — improved image download/upload flow and paragraph image handling
- `dist/ServiceNow-2-Notion.user.js` — rebuilt userscript with updated metadata

### Acknowledgements

Thanks for the detailed debugging logs and sample pages — they made tracking the image stripping easy.
