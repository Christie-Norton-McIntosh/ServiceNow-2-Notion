## ServiceNow-2-Notion — Copilot Instructions

These instructions are optimized for AI coding agents (Copilot-style) working in the ServiceNow-2-Notion repository. Keep guidance concise and actionable; prefer small, safe edits and always run the build after changes.

### 🎯 Project Architecture

**Browser Userscript + Proxy Server Architecture**

- **Frontend**: Tampermonkey userscript extracts ServiceNow content, sends to local proxy server
- **Backend**: Node.js/Express server converts HTML to Notion blocks, creates pages via Notion API
- **Build**: Rollup bundles ES6 modules into single `dist/ServiceNow-2-Notion.user.js` userscript
- **Data Flow**: ServiceNow page → Userscript extraction → Proxy server → HTML→Notion conversion → Notion page creation

### 📁 Key Components & Entry Points

- `src/main.js` — App orchestration, UI wiring, content extraction coordination
- `src/ui/*.js` — Modal components with `injectXxx()`/`setupXxx()` pattern (never auto-inject on import)
- `src/content/*.js` — ServiceNow content/metadata extraction logic
- `src/api/*.js` — External service integrations (Notion API, proxy communication)
- `server/sn2n-proxy.cjs` — Express server with HTML-to-Notion block conversion
- `rollup.config.js` — Bundles ES6 modules into Tampermonkey-compatible IIFE

### 🔧 Critical Developer Workflows

**Build & Test Cycle** (required after every code change):

```bash
npm run build                    # Generate dist/ServiceNow-2-Notion.user.js
# Load into Tampermonkey, test on ServiceNow page
```

**Server Development** (auto-restarts on changes):

```bash
npm start                        # Starts proxy server with nodemon watch
# Server listens on port 3004, auto-restarts on server/ file changes
```

**Version Management** (required for all behavioral changes):

```bash
npm version patch/minor/major    # Updates package.json + rollup.config.js
```

**Post-Update Procedures** (required after each code change):

```bash
npm run build                    # Rebuild the userscript
npm start                        # Restart the proxy server
```

### 🎨 Project-Specific Patterns

**UI Component Pattern** (exemplified in `src/ui/property-mapping-modal.js`):

```javascript
// ❌ Never auto-inject on import
// ✅ Always use inject/setup pair
export function injectPropertyMappingModal() {
  // Create and append DOM elements
}
export function setupPropertyMappingModal(element) {
  // Wire event handlers, mark with dataset.w2nInit = "1"
}
```

**Modal Injector Wiring** (in `src/main.js`):

```javascript
import { setPropertyMappingModalInjector } from "./ui/overlay-progress.js";
import { showPropertyMappingModal } from "./ui/property-mapping-modal.js";

// Wire injector to avoid eager imports
setPropertyMappingModalInjector(showPropertyMappingModal);
```

**Global App Access** (used by UI actions):

```javascript
const app = window.ServiceNowToNotion?.app?.();
```

**HTML-to-Notion Block Conversion** (server-side recursive parsing):

- Handles mixed content (text + code blocks) in containers
- Extracts `<pre>` elements as separate code blocks with language detection
- Processes nested lists up to Notion's 2-level depth limit
- Converts tables with thead/tbody structure and image handling
- Preserves rich text formatting (bold, italic, code, links, colors)

### 🔍 Integration Points & Dependencies

**ServiceNow Integration**:

- Content extraction from iframe-heavy ServiceNow documentation pages
- Metadata parsing from page structure and URL patterns
- Handles ServiceNow's dynamic content loading

**Notion API Integration**:

- Page creation with custom properties and rich text content
- Database schema introspection and property mapping
- Image upload for covers/icons via Notion's file upload API
- Block deduplication and deep nesting orchestration

**Proxy Server Communication**:

- Local Express server (port 3004) for HTML→Notion conversion
- CORS-enabled for browser userscript communication
- Environment-based configuration (.env files)


### ⚡️ Server Restart & Startup Best Practices

- **Always kill lingering node processes before restarting** (`killall node` or `pkill -f sn2n-proxy.cjs`).
- **Use a single nodemon instance** to avoid overlapping restarts and port conflicts.
- **Avoid synchronous file I/O in startup paths** (e.g., reading/writing large files, logs, or .env files synchronously).
- **Add robust error handling for all async code**—wrap all async startup logic in try/catch and log errors.
- **Add a short delay between stop/start if restarting rapidly** to avoid port binding race conditions.

### ⚠️ Common Pitfalls & Required Checks

**Before UI Changes**:

- Search for `w2n-` IDs across codebase to find dependencies
- Never import modal modules at top-level (causes auto-injection)
- Wire modal injectors through `src/main.js` only

**Build Validation**:

- Always run `npm run build` after changes
- Verify `dist/ServiceNow-2-Notion.user.js` exists and is updated
- Manual Tampermonkey testing required (no automated tests)

**Server Development**:

- Use `npm start` for auto-restart during server changes
- Server processes HTML with complex recursive block parsing
- Debug with `SN2N_VERBOSE=1` environment variable
- Handle Notion's 100-block limit with chunking and retries

**Code Quality**:

- Strip private `_sn2n_` keys before sending to Notion API
- Use marker-based deep nesting for complex content structures
- Implement deduplication for tables and callouts to avoid duplicates

### 📋 Code-Edit Checklist

1. Search for `w2n-` ID references before renaming UI elements
2. Add `injectXxx()`/`setupXxx()` pairs for new UI components
3. Wire modal injectors through `src/main.js` (never import modals directly)
4. Run `npm run build` and verify dist file generation
5. Manual smoke test in Tampermonkey on ServiceNow page
6. Bump version with `npm version` for behavioral changes
7. Strip private keys from blocks before Notion API calls
8. Test HTML conversion edge cases (tables, lists, code blocks)

### 🎯 Where to Start Reading

- `src/main.js` — App initialization and component wiring
- `src/ui/property-mapping-modal.js` — Exemplifies UI component patterns
- `server/sn2n-proxy.cjs` — HTML-to-Notion conversion logic
- `rollup.config.js` — Build configuration and userscript metadata
- `README.md` — High-level architecture and setup instructions
