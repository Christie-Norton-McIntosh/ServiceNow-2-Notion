
# ServiceNow-2-Notion — Copilot Instructions (2025) — v11.0.0

Quick, actionable guidance for AI coding agents working in this repo. Keep edits small, reference real files, and verify with a local build and proxy run.

## Agent quickstart (TL;DR)
- **Version**: 11.0.0 (Navigation retry, rate limit protection, 5 validation fixes)
- Big picture: ES6 userscript in `src/**` → bundled to `dist/ServiceNow-2-Notion.user.js` (Rollup IIFE). Local proxy in `server/**` converts ServiceNow HTML to Notion blocks and creates pages.
- Build userscript: `npm run build` (or `build:prod`); dev watch: `npm run dev`. After any `src/**` change, rebuild and re-upload the userscript to Tampermonkey.
- Versioning (REQUIRED before build): bump the version so Tampermonkey detects updates and Rollup injects the correct banner/runtime. Use `npm version patch|minor|major` (or `npm run release:patch|minor|major`).
- Run proxy: `npm start` (nodemon, port 3004). `.env` in `server/` or root: `NOTION_TOKEN`, `NOTION_VERSION`, optional `SN2N_VERBOSE=1`, `SN2N_EXTRA_DEBUG=1`.
- Test: `npm run test:list` (list all tests), `npm run test:all` (run client tests), `npm run test:all:server` (run server tests). Test HTML fixtures in `tests/fixtures/`.
- Key files: `src/main.js` (userscript wiring), `src/ui/main-panel.js` (AutoExtract + navigation retry), `server/sn2n-proxy.cjs` (Express entry), `server/services/servicenow.cjs` (HTML→blocks), `server/converters/{rich-text,table}.cjs`, `server/routes/w2n.cjs` (rate limit retry), `server/orchestration/*.cjs`.
- Patterns:
  - Userscript UI: never auto-inject on import; provide `injectXxx()` + `setupXxx(el)` and wire injectors only in `src/main.js` (see `src/ui/property-mapping-modal.js`).
  - DOM iteration: always snapshot live NodeLists with `Array.from(node.childNodes)` before modifying (avoid skipped nodes).
  - Preserve HTML (don’t early-strip tags); let `rich-text.cjs` derive annotations (UIControl, keyword, parmname, codeph).
  - Tables/newlines: use placeholder markers (e.g., `__NEWLINE__`) → normalize whitespace → restore markers (see `server/converters/table.cjs`).
  - Deep nesting: initial create limited to 2 levels. Insert `sn2n:marker` tokens + `markerMap`, create page, then `orchestrateDeepNesting()` appends deeper children and cleans markers (see `server/orchestration/*.cjs`, invoked by `w2n.cjs`).
  - Notion limits: chunk children in 100-block batches; append remaining after page create (`w2n.cjs`).
  - Images: ServiceNow images must be downloaded+uploaded to Notion `file_uploads`; fallback to external URL only for non-ServiceNow images (`sn2n-proxy.cjs:createImageBlock`).
  - Dedupe/filter: filter gray info callouts; dedupe identical blocks and images by id/URL (`server/utils/dedupe.cjs` used in `w2n.cjs`).
- **Validation fixes (v11.0.0)**: 6 issues fixed in callout/table processing:
    - Issue 1: Recursive block type detection (check children for tables/images, not just callout text)
    - Issue 2: Multi-pass DataTables unwrapping (iterate until no changes to handle nested wrappers)
    - Issue 3: Whitespace-only text node filtering (exclude blank nodes in block counting)
    - Issue 4: Image extraction from nested tables (recursively search for `<img>` in `<table>` descendants)
    - Issue 5: Table preservation priority (if table + single-image detected, keep table; don't downgrade to image)
    - Issue 6: Callout detection with underscore-separated classes (removed `\b` word boundaries from regex patterns to match `note_note`, `warning_type`, etc.)
- API surface: POST `/api/W2N` with `{ title, databaseId, contentHtml|content, properties?, url?, dryRun? }`. `dryRun` returns `{ children, hasVideos }` without creating a page. PATCH `/api/W2N/:pageId` with `{ title, contentHtml, url }` deletes all blocks and re-uploads content (requires 32-char UUID, accepts with/without hyphens). Health: `/health`, `/ping`, `/api/status`; DB: `/api/databases/:id`; logging: `/api/logging`.
- Auto-validation: Enable with `SN2N_VALIDATE_OUTPUT=1`. On each extraction, proxy validates HTML→Notion conversion with ±30% tolerance (70%-150% of expected blocks). Updates Notion properties (Error checkbox, Validation text, Stats). Failed pages auto-saved to `patch/pages-to-update/` with metadata for re-extraction. See `docs/AUTO-VALIDATION.md`.
- PATCH workflow: Use dry-run validation before PATCH (`dryRun:true`), execute PATCH with 120s timeout, verify post-PATCH validation. Script: `patch/config/batch-patch-validated.sh` (validation → PATCH → move to updated-pages). Known issue: curl may hang beyond timeout on large payloads; monitor with `ps aux | grep batch-patch` and check log files.
- Pitfalls: search for `w2n-` IDs before UI renames; wire modal injectors only in `src/main.js`; respect Notion nesting/100-block caps; use `Array.from()` with DOM; rebuild userscript after edits; PATCH operations may timeout on complex pages (monitor logs).

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

**Automatic Build & Deploy:**
The build process now automatically:
1. **Pre-build**: Removes old `dist/ServiceNow-2-Notion.user.js` to prevent VS Code caching issues
2. **Build**: Bumps version, bundles with Rollup
3. **Post-build**: Commits and pushes the new build to Git automatically

**Build & Test Cycle:**
```bash
npm run build    # 1. Removes old dist file (pre-build)
                 # 2. Bumps version
                 # 3. Generates dist/ServiceNow-2-Notion.user.js
                 # 4. Commits and pushes to Git (post-build)
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

- **AutoExtract Navigation Retry (v11.0.0):**
  - **Pattern**: Immediate retry loop when navigation fails (URL/pageId unchanged)
  - **Implementation**: `src/ui/main-panel.js` lines 1570-1670
  - **Logic**:
    1. Detect unchanged URL/pageId after clicking next button
    2. Increment `autoExtractState.navigationFailures` counter
    3. Retry navigation up to 2 times (`maxNavigationRetries`)
    4. Smart duplicate detection: expected (retry) vs unexpected (end-of-book)
    5. Show confirmation dialog if still failing after retries
  - **State**: `autoExtractState.navigationFailures` tracks consecutive failures
  - **Debug**: Use `[NAV-RETRY]` bracketed keyword for filtering logs
  - **Key Code**:
    ```js
    const maxNavigationRetries = 2;
    let navigationRetryCount = 0;
    while (navigationRetryCount < maxNavigationRetries && !navigationSucceeded) {
      navigationRetryCount++;
      // Re-click next button, wait for page load
      const navigationOccurred = await verifyNavigation(previousUrl, previousPageId);
      if (navigationOccurred) navigationSucceeded = true;
    }
    ```

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

- **Rate Limit Protection (v11.0.0):**
  - **Pattern**: Exponential backoff with separate retry counters for rate limits vs network errors
  - **Implementation**: `server/routes/w2n.cjs` (page creation retry logic)
  - **Logic**:
    1. Detect 429 status code from Notion API
    2. Use separate `rateLimitRetryCount` (max 5) vs `retryCount` (max 3)
    3. Exponential backoff: 1s, 2s, 4s, max 5s delay
    4. Preserve page creation attempts through rate limit errors
  - **Key Code**:
    ```js
    const maxRateLimitRetries = 5;
    let rateLimitRetryCount = 0;
    while (retryCount <= maxRetries || rateLimitRetryCount <= maxRateLimitRetries) {
      try {
        const createdPage = await notion.pages.create(pageCreatePayload);
        return createdPage;
      } catch (error) {
        if (error.status === 429) { // Rate limit
          rateLimitRetryCount++;
          const delay = Math.min(1000 * Math.pow(2, rateLimitRetryCount - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    ```
  - **Also Applied**: Deep nesting orchestration (`server/orchestration/deep-nesting.cjs`) uses same exponential backoff pattern

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
- **Debug Logging Pattern**: When adding temporary debug logs for issue investigation, prefix ALL related logs with a shared keyword in brackets (e.g., `[DUPLICATE-DETECTION]`, `[NAV-VERIFICATION]`, `[MARKER-DEBUG]`). This allows easy console filtering (`/\[KEYWORD\]/`) and batch removal when issue is resolved. Apply to both client (`debug()`) and server (`console.log()`) logs.

## 🧪 Testing Infrastructure

- **Test Organization:**
  - `tests/` - Client-side HTML parsing tests (run with `npm run test:all`)
  - `server/tests/` - Server-side conversion tests (run with `npm run test:all:server`)
  - `tests/fixtures/` - HTML test fixtures for validation
- **Test Runner:**
  - `scripts/run-tests.cjs` - Main test orchestrator
  - `npm run test:list` - List all available tests
  - `npm run test:all` - Run all client tests
  - `npm run test:all:server` - Run all server tests
- **Test Patterns:**
  - HTTP server tests: Spin up proxy, POST to `/api/W2N` with `dryRun: true`
  - Direct import tests: Import converter functions directly, call with mock HTML
  - Fixture-based: Load HTML from `tests/fixtures/`, verify block output
- **Key Test Files:**
  - `server/test-run-extract.cjs` - Extract full pages from ServiceNow HTML fixtures
  - `tests/test-callout-*.cjs` - Callout validation tests (Issues 1 through 5 fixes)
  - `tests/test-table-*.cjs` - Table formatting and image extraction tests

## 📋 Code-Edit Checklist

1. Search for `w2n-` ID references before renaming UI elements
2. Add `injectXxx()`/`setupXxx()` pairs for new UI components
3. Wire modal injectors in `src/main.js` only
4. Run `npm run build` and verify dist file
5. Manual smoke test in Tampermonkey
6. If client-side code changed, re-upload userscript
7. Bump version with `npm version` for behavioral changes
8. Strip private keys before Notion API calls
9. Test HTML conversion edge cases (run `npm run test:all` or `npm run test:all:server`)
10. For issue-specific debug logs, use bracketed keywords (e.g., `[ISSUE-NAME]`) for easy filtering/removal

## 🎯 Where to Start Reading

- `src/main.js`: App initialization and wiring
- `src/ui/property-mapping-modal.js`: UI modal pattern
- `server/sn2n-proxy.cjs`: HTML-to-Notion conversion logic
- `rollup.config.js`: Build config and userscript metadata
- `README.md`: High-level architecture and setup
