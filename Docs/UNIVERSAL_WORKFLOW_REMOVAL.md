Universal Workflow removal

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
