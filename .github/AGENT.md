# AGENT Guide — ServiceNow-2-Notion

This document expands the `.github/copilot-instructions.md` with runnable examples and commands for AI agents and maintainers.

1. Useful search commands

- Find all UI ids and references:

  ```bash
  rg "w2n-" -n src || true
  ```

- Find where a modal is injected or used:
  ```bash
  rg "inject.*modal|showPropertyMappingModal" -n src || true
  ```

2. Wiring a modal injector (example)

- Pattern: the modal should export `injectXxx()` and `setupXxx()`. The main app wires an injector so other modules can open the modal without importing it eagerly.

Example snippet (to add in `src/main.js`):

```javascript
// ...existing code...
import { showPropertyMappingModal } from "./ui/property-mapping-modal.js";
import { setPropertyMappingModalInjector } from "./ui/overlay-progress.js";

// during initialization
setPropertyMappingModalInjector(showPropertyMappingModal);
// ...existing code...
```

3. How to add a new UI component

- Create `src/ui/my-widget.js` that exports `injectMyWidget()` (creates DOM) and `setupMyWidget(el)` (wires handlers).
- Do not auto-append to `document.body` on import. Only append inside `injectMyWidget()`.
- Call `injectMyWidget()` from `src/main.js` or wire it to a button injector.

4. Build & manual smoke test (recommended sequence)

```bash
npm install
npm run build
# open dist/ServiceNow-2-Notion.user.js and install in Tampermonkey
# Visit a ServiceNow page and verify:
# - main panel appears with title "📚 ServiceNow to Notion"
# - Configure Property Mapping opens the mapping modal
# - Icon & Cover opens the image modal
```

5. Common quick fixes (examples)

- If a modal opens on page load unexpectedly: search for `document.body.appendChild(` in `src/ui` and ensure the append happens only inside `inject...()`.
- If a UI id is missing and `updateUIFromConfig()` references it: search for the id and re-add the DOM node to the main panel or fallback container.

6. Debugging tips

- Enable detailed logs: in `src/config.js` toggle `debug` or use the advanced settings modal's `debugMode`.
- Inspect `window.ServiceNowToNotion` in the console to access the app instance and call helper methods when testing.

7. When in doubt

- Refer to `refactor/W2N-SN2N.user.js.original.md` for the original monolithic implementation and exact UI markup if behavior needs to be preserved.

Append any examples you want me to expand and I'll add them here.

8. Example: persist panel position using localStorage

Place this logic in `src/ui/main-panel.js` near the panel initialization (inside `injectMainPanel()` or `setupMainPanel()`):

```javascript
// restore position if present
const POS_KEY = "w2n-panel-pos";
function restorePanelPosition(panel) {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return;
    const { left, top } = JSON.parse(raw);
    if (typeof left === "number") panel.style.left = `${left}px`;
    if (typeof top === "number") panel.style.top = `${top}px`;
    panel.style.right = "auto";
  } catch (e) {}
}

function savePanelPosition(panel) {
  try {
    const rect = panel.getBoundingClientRect();
    const data = { left: Math.round(rect.left), top: Math.round(rect.top) };
    localStorage.setItem(POS_KEY, JSON.stringify(data));
  } catch (e) {}
}

// call restorePanelPosition(panel) after appending the panel
// and call savePanelPosition(panel) when drag ends (pointerup) or on close
```

9. Build after edits (required)

After any code change that touches `src/`, `rollup.config.js`, or package files, run these commands and verify the bundle was regenerated:

```bash
npm ci
npm run build
```

Include the build verification line (e.g., "created dist/ServiceNow-2-Notion.user.js in XXXms") in your PR description.

10. Version bump (required)

Always bump the `package.json` version when making changes that affect behavior or the public surface. Use `npm version` to update and create a git tag automatically. Examples:

```bash
# bugfix
npm version patch

# feature
npm version minor

# breaking
npm version major
```

After running `npm version ...`, include the new version in the PR title and description.
