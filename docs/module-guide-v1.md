# ServiceNow-2-Notion Module Guide

A concise, single-file reference that compiles the commented notes from each module, summarizing purpose, core functions, and dependencies. Grouped by server (proxy) and client (userscript).

## Server (proxy) modules

### server/sn2n-proxy.cjs
- Purpose: Express proxy server entry; wires routing, modular converters/services/orchestrators; supports fallback to legacy monolith mode.
- Key functions/behaviors:
  - Loads converters (rich-text, table), services (notion, servicenow), orchestration (block-chunking, marker-management, deep-nesting) with try/catch fallbacks.
  - Provides safe* fallbacks for append/marker/deep nesting when modules are missing.
  - Sets up Express app, permissive CORS, JSON sizing, and routes.
- Depends on: express, cors, dotenv, fs, path, axios, form-data, @notionhq/client, local server/* modules.

### server/services/servicenow.cjs
- Purpose: ServiceNow content extraction and HTML→Notion blocks conversion.
- Key features:
  - Rich text conversion; technical identifier detection (kbd/codeph/parmname/keyword); table parsing; callouts; videos; URL normalization.
  - Enforces Notion 2-level nesting; defers deeper children with markers for follow-up orchestration.
  - Main API: `async extractContentFromHtml(html)`.
- Depends on: axios, form-data, cheerio, fs; utils/url.cjs, converters/rich-text.cjs, utils/notion-format.cjs, converters/table.cjs, orchestration/marker-management.cjs.

### server/services/notion.cjs
- Purpose: Encapsulates Notion API access (init client, create page, append blocks, map properties, image upload placeholder).
- Key functions:
  - `initNotionClient(token)`, `getNotionClient()`
  - `createPage(databaseId, properties, children)`
  - `appendBlocks(pageId, blocks)`
  - `uploadImageToNotion(imageUrl, alt)` (placeholder)
  - `mapDataToNotionProperties(data, mappings, databaseSchema)`
- Depends on: @notionhq/client, axios.

### server/converters/rich-text.cjs
- Purpose: HTML to Notion `rich_text` conversion; handles links, bold/italic, inline code, placeholders, UIControl and technical spans.
- Key functions:
  - `convertRichTextBlock(input, options)`
  - Uses shared utilities for technical detection and HTML cleaning.
- Depends on: utils/url.cjs, fs (for debug), utils/html-formatting.cjs, utils/notion-format.cjs.

### server/converters/table.cjs
- Purpose: Convert HTML tables to Notion table blocks; captions→headings; extract images from cells; nested lists.
- Key functions:
  - `async convertTableBlock(tableHtml, options)`
  - `deduplicateTableBlocks` (referenced in proxy via table converter export)
- Depends on: utils/notion-format.cjs (cleanHtmlText), converters/rich-text.cjs, utils/url.cjs.

### server/orchestration/block-chunking.cjs
- Purpose: Chunk/append blocks to respect Notion 100-block limit; retry with backoff; strip private keys.
- Key functions:
  - `async appendBlocksToBlockId(blockId, blocks, opts)`
  - `deepStripPrivateKeys(blocks)`
- Depends on: global notion client/log via `getGlobals()`; Express route sets globals.

### server/orchestration/deep-nesting.cjs
- Purpose: Post-create orchestration for 3+ level children using markers; finds parent list item and appends children.
- Key functions:
  - `async findParentListItemByMarker(rootBlockId, marker)`
  - `async orchestrateDeepNesting(pageId, markerMap)`
- Depends on: orchestration/block-chunking.cjs, orchestration/marker-management.cjs; global notion/log.

### server/orchestration/marker-management.cjs
- Purpose: Manage marker lifecycle for deep nesting; collect/strip from initial payload; clean rich_text.
- Key functions:
  - `generateMarker()`
  - `collectAndStripMarkers(blocks, map)`
  - `removeCollectedBlocks(blocks)`
  - `removeMarkerFromRichTextArray(richArray, marker)`
- Depends on: global log.

### server/routes/w2n.cjs
- Purpose: Main Web-to-Notion endpoint: validates payload, optional dry-run conversion, page creation, dedupe, deep-nesting orchestration.
- Key behaviors:
  - Extensive diagnostics; uses `servicenowService.extractContentFromHtml`.
  - Dedupe and filter via `utils/dedupe.cjs`.
  - Uses globals for normalizers and orchestrators.
- Depends on: express, fs, path; services/notion.cjs, services/servicenow.cjs, utils/dedupe.cjs.

### server/routes/health.cjs
- Purpose: GET /api/health — health status, version, Notion client state.
- Depends on: express; uses process env and global notion.

### server/routes/status.cjs
- Purpose: GET /api/status — service name, version, uptime, timestamp.
- Depends on: express.

### server/routes/ping.cjs
- Purpose: GET /api/ping — simple pong response.
- Depends on: express.

### server/routes/databases.cjs
- Purpose: Database discovery and schema endpoints with short cache; schema typing for UI.
- Key routes:
  - GET /databases — list with pagination and cache
  - GET /databases/:id/schema — typed schema
  - GET /databases/:id — alias; returns schema
- Depends on: express; global notion, logging, sendSuccess/sendError helpers.

### server/routes/logging.cjs
- Purpose: GET/POST /api/logging — view and set verbose/extraDebug runtime flags.
- Depends on: express; global getters/setters.

### server/routes/upload.cjs
- Purpose: Fetch-and-upload and direct upload endpoints to Notion file storage.
- Key routes:
  - POST /fetch-and-upload — URL→download→upload flow
  - POST /upload-to-notion — base64/dataURI upload
- Depends on: express, path; global helpers for file upload.

### server/utils/notion-format.cjs
- Purpose: Core Notion formatting helpers.
- Key exports:
  - `VALID_RICH_TEXT_COLORS` — supported color set
  - `normalizeAnnotations(annotations)` — safe annotation object
  - `cleanHtmlText(html)` — strip tags, decode entities, protect placeholders, normalize whitespace
- Depends on: standard library only; console for optional debug.

### server/utils/dedupe.cjs
- Purpose: Compute dedupe keys for blocks and filter duplicates, with special handling for callouts/images/lists/dividers.
- Key exports:
  - `computeBlockKey(blk)`
  - `dedupeAndFilterBlocks(blockArray, options)`
- Depends on: standard lib.

### server/utils/url.cjs
- Purpose: URL normalization and validation for ServiceNow/Notion contexts.
- Key exports:
  - `convertServiceNowUrl(url)`
  - `isValidNotionUrl(url)`
  - `isVideoIframeUrl(url)`
- Depends on: URL (built-in).

### server/config/index.cjs
- Purpose: Centralized config loader from environment (.env).
- Exports: `port`, `notionToken`, `notionVersion`, `verbose`, `extraDebug`.

### server/config/logger.cjs
- Purpose: Lightweight logger with level control; compatible with existing `log()` usage.
- Exports: `error`, `warn`, `info`, `debug`, `log`.

### server/martian-helper.cjs
- Purpose: Markdown/HTML→Notion conversion via @tryfabric/martian; plus Notion file upload orchestration utilities.
- Key functions:
  - `setNotionClient(client)`
  - `convertToNotionBlocks(input, { from, options })`
  - Post-processing for tables, lists, toggles.
- Depends on: axios, uuid, crypto, fs, path, @tryfabric/martian (optional).

---

## Client (userscript) modules

### src/main.js
- Purpose: Userscript entry; coordinates config, UI injection, content extraction, and proxy communication.
- Key behaviors:
  - Initializes config; wires UI injectors; creates main buttons; routes actions to API calls.
  - Uses overlay progress UI and property mapping modal injectors.
- Depends on: config.js; ui/*; content/*; api/*; utils/*.

### src/config.js
- Purpose: Constants, defaults, user-config storage/migration, branding assets.
- Key exports:
  - `PROVIDER_VERSION`, `PROVIDER_NAME`, `BRANDING`, default images
  - `defaultConfig`, `DB_CACHE_TTL`, `DEFAULT_CUSTOM_SELECTORS`
  - `getConfig()`, `getCustomSelectors()`, `debug()`, `initializeConfig()`, `migrateOldConfig()`

### src/api/proxy-api.js
- Purpose: Client→proxy API wrapper with Tampermonkey GM_xmlhttpRequest fallback to fetch.
- Key exports (subset):
  - `apiCall(method, endpoint, data)`; `fetchDatabaseSchema(id)`; `fetchDatabases(options)`; `sendProcessedContentToProxy(...)`; `createNotionPage(...)`; `checkProxyHealth()`; etc.
- Depends on: config.js (debug, getConfig), utils/url-utils.js (normalizeUrl, isValidImageUrl), utils/notion-utils.js (hyphenateNotionId, findProperty).

### src/api/database-api.js
- Purpose: Client-side DB caching, fetch, and property mapping storage.
- Key exports (subset):
  - `getDatabase(id)`, `refreshDatabase(id)`, `getAllDatabases(opts)`
  - `getPropertyMappings(id)`, `savePropertyMappings(id, mappings)`, `resetPropertyMappings(id)`
- Depends on: config.js (debug), proxy-api.js.

### src/utils/notion-utils.js
- Purpose: Utility helpers for Notion IDs and property lookup.
- Exports: `hyphenateNotionId(id)`, `findProperty(properties, names)`

### src/utils/url-utils.js
- Purpose: Client-side URL normalization and image URL validation.
- Exports: `normalizeUrl(url, baseUrl)`, `isValidImageUrl(url)`

### src/content/content-extractor.js
- Purpose: Extracts page content (including iframes), chooses best container, removes nav elements, returns combined HTML and images.
- Key exports: `extractContentWithIframes(contentElement)`, `findContentElement(...)` (in-file), plus diagnostics.
- Depends on: config.js (debug, getConfig), metadata-extractor.js (constructServiceNowBaseUrl).

### src/content/metadata-extractor.js
- Purpose: Extract metadata from ServiceNow pages using selectors and custom overrides.
- Key exports: `extractServiceNowMetadata()`; internal helpers to match selectors and normalize breadcrumb.
- Depends on: config.js (debug, getCustomSelectors).

### src/content/content-utils.js
- Purpose: Text/content helpers for DOM text extraction, normalization, lists/tables summaries, reading-time estimates.
- Key exports: `getTextNodes(node)`, `normalizeText(text)`, `extractPlainText(content)`, `countWords(text)`, `estimateReadingTime(text)`, `processTable(table)`, `processList(list)`

### src/ui/overlay-progress.js
- Purpose: Self-contained overlay UI for progress/success states; exposes injector for property mapping modal.
- Key exports: `overlayModule` (object of methods), `setPropertyMappingModalInjector(fn)` and many UI helpers within module scope.

### src/ui/main-panel.js
- Purpose: Floating control panel UI; database picker; action buttons; starts capture, opens modals; debug/diagnostics.
- Key exports: `injectMainPanel()`, `setupMainPanel(panel)`
- Depends on: config.js, ui/modals, api/database-api.js, overlay-progress.js, ui/utils.js.

### src/ui/property-mapping-modal.js
- Purpose: Modal to map extracted content fields to Notion DB properties; persists mappings.
- Key exports: `injectPropertyMappingModal()`, `setupPropertyMappingModal(el)`
- Depends on: config.js; api/database-api.js (get/refresh DB);

### src/ui/advanced-settings-modal.js
- Purpose: Modal for advanced toggles (Martian usage, direct images, debugging, dedupe search).
- Key exports: `injectAdvancedSettingsModal()`, `setupAdvancedSettingsModal(el)`
- Depends on: config.js; calls /api/logging to sync combined debug flag.

### src/ui/icon-cover-modal.js
- Purpose: Modal for selecting emoji icon and Unsplash cover (with upload support and previews).
- Key exports: `injectIconCoverModal()`, `setupIconCoverModal(el)`
- Depends on: config.js (debug), proxy-api.js (image search/defaults, uploads).

### src/ui/utils.js
- Purpose: Common UI utilities (toast, success/error panels, element creation, modal helpers, debug selector exposure).
- Key exports: `showToast`, `showSuccessPanel`, `showErrorPanel`, `debounce`, `createEl`, `createDebugSelectorFunction`, `exposeDebugFunction`, `closeModal`, `setupCommonModalHandlers`, `createLoadingHTML`, `createErrorHTML`.

---

## Notes and cross-cutting concerns
- Deep nesting: Initial page creation is capped at two levels; deeper children are deferred via markers and appended later (server/orchestration/*, server/routes/w2n.cjs).
- 100-block limit: The block chunker handles slicing and retry (server/orchestration/block-chunking.cjs).
- Rich text: Preserve HTML as long as possible; annotate via converters/rich-text.cjs; utilities in utils/notion-format.cjs and utils/html-formatting.cjs.
- Tables: Use placeholder markers for newlines; caption→heading; extract images to separate blocks (server/converters/table.cjs).
- Dedupe/filtering: Remove gray info callouts; careful handling of images and list items (server/utils/dedupe.cjs; applied in routes/w2n.cjs).
- URL handling: Convert ServiceNow relative URLs; validate video iframes (server/utils/url.cjs); client has a subset in src/utils/url-utils.js.

