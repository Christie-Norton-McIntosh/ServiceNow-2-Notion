## ServiceNow-2-Notion — Copilot Instructions

These instructions are optimized for AI coding agents (Copilot-style) working in the ServiceNow-2-Notion repository. Keep guidance concise and actionable; prefer small, safe edits and always run the build after changes.

Goal

- Produce maintainable ES6 modules that bundle into a single Tampermonkey userscript (`dist/ServiceNow-2-Notion.user.js`) using Rollup.

Quick facts

- Entry point: `src/main.js` — orchestrates UI, content extraction, and API calls.
- UI components: `src/ui/*.js` (modals use `inject...()` and `setup...()` patterns and should only append to DOM when injected).
- Content extractors: `src/content/*` — metadata/content extraction logic lives here.
- API layer: `src/api/*` — `proxy-api.js` (M2N proxy), `database-api.js` (Notion ops), `workflow-api.js` (Universal Workflow integration).
- Build: `npm run build` (dev), `npm run build:prod` (minified prod), `npm run dev` (watch).

When editing

- Small, focused changes only. Prefer adding modules or functions rather than large rewrites.
- Modals and overlays must not auto-inject on import. Use provided `injectXxx()` functions and wire injectors from `src/main.js`.
- UI elements referenced elsewhere must exist in the DOM (e.g., `#w2n-notion-panel`, `#w2n-indicator-martian`, `#w2n-selected-database-label`). Search for `w2n-` IDs before removing or renaming elements.

Patterns & conventions (practical examples)

- Initialization: modules follow a pair: `injectFoo()` (creates and appends DOM) and `setupFoo(element)` (wires handlers and marks element with `dataset.w2nInit = "1"`). Example: `src/ui/property-mapping-modal.js`.
- Overlay wiring: `src/ui/overlay-progress.js` accepts an injector for the property-mapping modal — set the injector in `src/main.js` so progress UI can open modals without importing them eagerly.
- Global app accessor: use `window.ServiceNowToNotion.app()` to access the central app instance if available — used by UI actions to trigger save/extract flows.

Build & debug workflow

- Run tests: there are no automated tests currently; validate via build + manual browser test.
- Build locally: `npm install` then `npm run build`. Use `npm run dev` during active changes to rebuild on file save.
- After building, open `dist/ServiceNow-2-Notion.user.js` and load into Tampermonkey for runtime verification.
- Enable debug: toggle `debugMode: true` in advanced settings modal or set `debug` flags in `src/config.js` to get detailed console logs.

Integration & external services

- Proxy server: `src/api/proxy-api.js` expects an M2N proxy (local dev server in `S2N-PROXY/` historically). If calling remote services, mock or stub network calls during unit testing.
- Notion: `src/api/database-api.js` encapsulates Notion operations; be careful when changing property mapping logic — tests are manual and integration-heavy.

Common pitfalls

- Accidentally importing modal modules at top-level causes them to auto-insert UI. Always call their `inject` functions from `src/main.js` or an on-demand handler.
- UI id mismatches: many modules reference `w2n-` ids. Use grep for `w2n-` to find cross-file dependencies before renaming.
- Position/drag behavior: the main panel used fixed `right` positioning originally. When adding drag behavior, convert `right` -> `left` at drag start to allow free movement (see `src/ui/main-panel.js`).

Code-edit checklist

1. Search for `w2n-` ids and references before changing UI element names.
2. Update or add `inject...()` and `setup...()` for new UI components.
3. Wire modal injectors through `src/main.js` instead of importing at top-level.
4. Run `npm run build`; inspect `dist/ServiceNow-2-Notion.user.js`.
5. Manual smoke test in a browser via Tampermonkey.

Where to look first

- `src/main.js` — app wiring and entry point
- `src/ui/*` — UI components and modal patterns
- `src/api/*` — external integrations and network logic
- `refactor/` — original monolithic userscript — useful when porting UI/behavior
- `README.md` — high-level overview and build commands

If unsure, ask the maintainer for

- preferred behavior for persisted UI state (panel position persistence)
- remote proxy URL used in development vs production

After edits

- Always run `npm run build` and report any build errors before proposing PRs.

Build after edits (required)

After every non-trivial edit (code, UI, build config), run:

```bash
npm ci
npm run build
```

- Confirm `dist/ServiceNow-2-Notion.user.js` was regenerated and include that verification in your PR description.

Versioning (required)

- Bump `package.json` version for every change that modifies behavior or public surface. Use semantic versioning. Example commands:

```bash
# patch (bugfix)
npm version patch

# minor (feature)
npm version minor

# major (breaking)
npm version major
```

- Include the new version number in the PR title (example: `chore(release): 7.1.1`).

Please review and tell me if you want examples expanded (e.g., exact grep commands, or a short snippet showing how to wire an injector in `src/main.js`).
