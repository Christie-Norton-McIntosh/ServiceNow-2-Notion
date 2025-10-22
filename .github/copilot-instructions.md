
# ServiceNow-2-Notion — Copilot Instructions (2025)

Quick, actionable guidance for AI coding agents working in this repo. Keep edits small, reference real files, and verify with a local build and proxy run.

## Agent quickstart (TL;DR)
- Big picture: ES6 userscript in `src/**` → bundled to `dist/ServiceNow-2-Notion.user.js` (Rollup IIFE). Local proxy in `server/**` converts ServiceNow HTML to Notion blocks and creates pages.
- Build userscript: `npm run build` (or `build:prod`); dev watch: `npm run dev`. After any `src/**` change, rebuild and re-upload the userscript to Tampermonkey.
- Versioning (REQUIRED before build): bump the version so Tampermonkey detects updates and Rollup injects the correct banner/runtime. Use `npm version patch|minor|major` (or `npm run release:patch|minor|major`).
- Run proxy: `npm start` (nodemon, port 3004). `.env` in `server/` or root: `NOTION_TOKEN`, `NOTION_VERSION`, optional `SN2N_VERBOSE=1`, `SN2N_EXTRA_DEBUG=1`.
- Key files: `src/main.js` (userscript wiring), `server/sn2n-proxy.cjs` (Express entry), `server/services/servicenow.cjs` (HTML→blocks), `server/converters/{rich-text,table}.cjs`, `server/routes/w2n.cjs`, `server/orchestration/*.cjs`.
- Patterns:
  - Userscript UI: never auto-inject on import; provide `injectXxx()` + `setupXxx(el)` and wire injectors only in `src/main.js` (see `src/ui/property-mapping-modal.js`).
  - DOM iteration: always snapshot live NodeLists with `Array.from(node.childNodes)` before modifying (avoid skipped nodes).
  - Preserve HTML (don’t early-strip tags); let `rich-text.cjs` derive annotations (UIControl, keyword, parmname, codeph).
  - Tables/newlines: use placeholder markers (e.g., `__NEWLINE__`) → normalize whitespace → restore markers (see `server/converters/table.cjs`).
  - Deep nesting: initial create limited to 2 levels. Insert `sn2n:marker` tokens + `markerMap`, create page, then `orchestrateDeepNesting()` appends deeper children and cleans markers (see `server/orchestration/*.cjs`, invoked by `w2n.cjs`).
  - Notion limits: chunk children in 100-block batches; append remaining after page create (`w2n.cjs`).
  - Images: ServiceNow images must be downloaded+uploaded to Notion `file_uploads`; fallback to external URL only for non-ServiceNow images (`sn2n-proxy.cjs:createImageBlock`).
  - Dedupe/filter: filter gray info callouts; dedupe identical blocks and images by id/URL (`server/utils/dedupe.cjs` used in `w2n.cjs`).
- API surface: POST `/api/W2N` with `{ title, databaseId, contentHtml|content, properties?, url?, dryRun? }`. `dryRun` returns `{ children, hasVideos }` without creating a page. Health: `/health`, `/ping`, `/api/status`; DB: `/api/databases/:id`; logging: `/api/logging`.
- Pitfalls: search for `w2n-` IDs before UI renames; wire modal injectors only in `src/main.js`; respect Notion nesting/100-block caps; use `Array.from()` with DOM; rebuild userscript after edits.

---

These instructions are for AI coding agents working in the ServiceNow-2-Notion repository. Follow these concise, actionable guidelines for immediate productivity and safe edits.

## �️ Big Picture Architecture

- **Frontend**: Tampermonkey userscript (bundled from ES6 modules in `src/`) extracts ServiceNow content and sends it to a local proxy server.
- **Backend**: Node.js/Express server (`server/`) receives HTML, converts to Notion blocks, and creates Notion pages via API.
- **Build**: Rollup bundles all ES6 modules into `dist/ServiceNow-2-Notion.user.js` (IIFE for Tampermonkey).
- **Data Flow**: ServiceNow page → Userscript extraction → Proxy server → HTML→Notion conversion → Notion page creation.

## 📁 Key Components & Entry Points

### Client-Side (Userscript)

- `src/main.js`: App orchestration, UI wiring, and extraction coordination.
- `src/ui/*.js`: Modal components (always use `injectXxx()`/`setupXxx()` pattern; never auto-inject on import).
- `src/content/*.js`: ServiceNow content and metadata extraction logic.
- `src/api/*.js`: Integrations (Notion API, proxy communication).

### Server-Side (Proxy)

- `server/sn2n-proxy.cjs`: Express server entry point, route configuration.
- `server/services/servicenow.cjs`: **Main HTML processing**, mixed content handling, block element orchestration.
- `server/converters/table.cjs`: Table cell content processing with placeholder markers, image extraction.
- `server/converters/rich-text.cjs`: HTML tag → Notion rich_text conversion (UIControl, keyword, parmname, codeph).
- `server/orchestration/`: Content orchestration, block assembly, deduplication.
- `server/utils/notion-format.cjs`: Notion block utilities, HTML cleaning.

### Build & Config

- `rollup.config.js`: Build config and userscript metadata.

## 🔧 Critical Developer Workflows

IMPORTANT: Always bump the version BEFORE any build so the userscript header `@version` and `window.BUILD_VERSION` reflect changes and Tampermonkey pulls the update.

**Build & Test Cycle:**
```bash
npm run build    # Generate dist/ServiceNow-2-Notion.user.js
# Load into Tampermonkey, test on ServiceNow page
```

**Server Development:**
```bash
npm start        # Starts proxy server with nodemon (port 3004)
# Auto-restarts on server/ file changes
```

**Version Management:**
```bash
npm version patch/minor/major    # Updates package.json + rollup.config.js
# Alternatively: npm run release:patch|minor|major (runs scripts/release.js)
```

**Post-Update Procedures:**
```bash
npm run build    # Rebuild userscript
npm start        # Restart proxy server
```

Note: If your edits change any client-side code (files under `src/` or the generated userscript), you must re-run `npm run build` and re-upload the generated `dist/ServiceNow-2-Notion.user.js` to Tampermonkey (or reinstall the userscript) so the browser userscript reflects your changes.

## 🎨 Project-Specific Patterns

### Client-Side (Userscript) Patterns

- **UI Modal Pattern:**
  - Never auto-inject on import
  - Always use `injectXxx()`/`setupXxx()` pair
  - Example:
    ```js
    export function injectPropertyMappingModal() { /* ... */ }
    export function setupPropertyMappingModal(element) { /* ... */ }
    ```
- **Modal Injector Wiring:**
  - Wire modal injectors in `src/main.js` only
  - Example:
    ```js
    setPropertyMappingModalInjector(showPropertyMappingModal);
    ```
- **Global App Access:**
  - Use: `const app = window.ServiceNowToNotion?.app?.();`

### Server-Side (Proxy) Patterns

- **Placeholder Marker Pattern** (protect newlines during normalization):
  - Mark intentional boundaries with `__NEWLINE__` before normalization
  - Normalize all whitespace to remove source HTML formatting
  - Restore markers as actual newlines after normalization
  - Example (`server/converters/table.cjs`):
    ```js
    // 1. Mark intentional newlines
    .replace(/<\/p>\s*<p[^>]*>/gi, '</p>__NEWLINE__<p>')
    // 2. Normalize whitespace (removes HTML indentation)
    .replace(/\s*\n\s*/g, ' ')
    // 3. Restore markers as newlines
    .replace(/__NEWLINE__/g, '\n')
    ```
- **Array.from() for DOM Iteration** (prevent live NodeList issues):
  - **ALWAYS** use `Array.from(childNodes)` when iterating nodes you might modify
  - Live NodeLists update when DOM changes, causing skipped nodes
  - Example (`server/services/servicenow.cjs`):
    ```js
    // ❌ WRONG: live NodeList
    const childNodes = $elem.get(0).childNodes;
    
    // ✅ CORRECT: array snapshot
    const childNodes = Array.from($elem.get(0).childNodes);
    ```
- **HTML Preservation Strategy:**
  - Keep HTML tags intact in intermediate processing
  - Pass to `rich-text.cjs` converter for formatting extraction
  - Never extract plain text early (loses UIControl, keyword, etc.)
- **HTML-to-Notion Block Conversion:**
  - Recursive parsing, mixed content, code block extraction, nested lists (2-level), tables, images, rich text formatting
- **Deep Nesting via Additional API Requests** (NOT flattening):
  - Notion API limits nesting to 2 levels in initial page creation
  - **Strategy**: Use marker-based orchestration with follow-up PATCH requests
  - **Process**:
    1. Parse HTML and identify blocks requiring deep nesting (3+ levels)
    2. Add temporary `sn2n:marker` tokens to parent block rich_text
    3. Store deeply-nested children in `markerMap` keyed by marker
    4. Strip children from initial payload (avoids API rejection)
    5. Create page with 2-level blocks + markers
    6. **After page creation**: `orchestrateDeepNesting()` searches page for markers
    7. For each marker: locate parent block via API, PATCH append children
    8. Clean up markers from rich_text after successful append
  - **Key Files**: 
    - `server/orchestration/deep-nesting.cjs` - Marker search, PATCH orchestration
    - `server/orchestration/marker-management.cjs` - Marker insertion/removal
    - `server/routes/w2n.cjs` - Calls orchestrator after page creation
  - **Important**: We preserve nesting depth through additional API calls, NOT by flattening list levels

## 🔍 Integration Points & Dependencies

- **ServiceNow Integration:**
  - Extracts content from iframe-heavy ServiceNow pages
  - Parses metadata from page structure and URLs
- **Notion API Integration:**
  - Creates pages, maps properties, uploads images
  - Handles block deduplication and deep nesting
- **Proxy Server Communication:**
  - Local Express server (port 3004), CORS-enabled
  - Uses `.env` for config

## ⚡️ Server & Startup Best Practices

- Kill lingering node processes before restart (`killall node` or `pkill -f sn2n-proxy.cjs`)
- Use a single nodemon instance
- Avoid synchronous file I/O in startup paths
- Wrap all async startup logic in try/catch and log errors
- Add short delay between stop/start if restarting rapidly

## ⚠️ Common Pitfalls & Required Checks

- Search for `w2n-` IDs before renaming UI elements
- Never import modal modules at top-level
- Wire modal injectors only in `src/main.js`
- Always run `npm run build` after changes
- Manual Tampermonkey testing required (no automated tests)
- Use `SN2N_VERBOSE=1` for server debug
- Strip private `_sn2n_` keys before Notion API calls
- Test HTML conversion edge cases (tables, lists, code blocks)

## 📋 Code-Edit Checklist

1. Search for `w2n-` ID references before renaming UI elements
2. Add `injectXxx()`/`setupXxx()` pairs for new UI components
3. Wire modal injectors in `src/main.js` only
4. Run `npm run build` and verify dist file
5. Manual smoke test in Tampermonkey
6. If client-side code changed, re-upload userscript
6. Bump version with `npm version` for behavioral changes
7. Strip private keys before Notion API calls
8. Test HTML conversion edge cases

## 🎯 Where to Start Reading

- `src/main.js`: App initialization and wiring
- `src/ui/property-mapping-modal.js`: UI modal pattern
- `server/sn2n-proxy.cjs`: HTML-to-Notion conversion logic
- `rollup.config.js`: Build config and userscript metadata
- `README.md`: High-level architecture and setup
