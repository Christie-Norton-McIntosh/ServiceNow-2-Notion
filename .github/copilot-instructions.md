
# ServiceNow-2-Notion — Copilot Instructions (2025)

These instructions are for AI coding agents working in the ServiceNow-2-Notion repository. Follow these concise, actionable guidelines for immediate productivity and safe edits.

## �️ Big Picture Architecture

- **Frontend**: Tampermonkey userscript (bundled from ES6 modules in `src/`) extracts ServiceNow content and sends it to a local proxy server.
- **Backend**: Node.js/Express server (`server/`) receives HTML, converts to Notion blocks, and creates Notion pages via API.
- **Build**: Rollup bundles all ES6 modules into `dist/ServiceNow-2-Notion.user.js` (IIFE for Tampermonkey).
- **Data Flow**: ServiceNow page → Userscript extraction → Proxy server → HTML→Notion conversion → Notion page creation.

## 📁 Key Components & Entry Points

- `src/main.js`: App orchestration, UI wiring, and extraction coordination.
- `src/ui/*.js`: Modal components (always use `injectXxx()`/`setupXxx()` pattern; never auto-inject on import).
- `src/content/*.js`: ServiceNow content and metadata extraction logic.
- `src/api/*.js`: Integrations (Notion API, proxy communication).
- `server/sn2n-proxy.cjs`: Express server, HTML-to-Notion block conversion.
- `rollup.config.js`: Build config and userscript metadata.

## 🔧 Critical Developer Workflows

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
```

**Post-Update Procedures:**
```bash
npm run build    # Rebuild userscript
npm start        # Restart proxy server
```

## 🎨 Project-Specific Patterns

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
- **HTML-to-Notion Block Conversion:**
  - Recursive parsing, mixed content, code block extraction, nested lists (2-level), tables, images, rich text formatting

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
6. Bump version with `npm version` for behavioral changes
7. Strip private keys before Notion API calls
8. Test HTML conversion edge cases

## 🎯 Where to Start Reading

- `src/main.js`: App initialization and wiring
- `src/ui/property-mapping-modal.js`: UI modal pattern
- `server/sn2n-proxy.cjs`: HTML-to-Notion conversion logic
- `rollup.config.js`: Build config and userscript metadata
- `README.md`: High-level architecture and setup
