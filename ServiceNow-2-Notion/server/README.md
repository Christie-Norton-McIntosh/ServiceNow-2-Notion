# SN2N Proxy — Developer README

This document describes the lightweight development proxy that mediates requests between the userscript and the Notion API. It also defines a recommended, stable JSON response contract that the proxy exposes so clients (the userscript, tests, or other tools) can rely on a consistent shape.

## Quick start

- Copy your Notion integration token to `server/.env` as `NOTION_TOKEN=ntn_...` (this file is ignored by git). Alternately, export `NOTION_TOKEN` in your shell before starting the proxy.
  Start the server:

From the repository root, use one of the following patterns depending on your needs.

1. Run once with node (foreground):

```sh
# from repo root
node server/sn2n-proxy.cjs
```

2. Run in background (zsh / macOS) and capture logs to `server/sn2n-proxy.out`:

```sh
# export your token (or add to server/.env)
export NOTION_TOKEN="ntn_..."
# start in background and redirect output
nohup node server/sn2n-proxy.cjs > server/sn2n-proxy.out 2>&1 &
# follow logs
tail -f server/sn2n-proxy.out
```

3. Development with automatic restarts (nodemon):

```sh
# install nodemon globally or in server/ (optional)
npx nodemon --watch server --exec "node server/sn2n-proxy.cjs"
```

4. Production process manager (pm2 example):

```sh
# start and keep alive with pm2
pm2 start server/sn2n-proxy.cjs --name sn2n-proxy --output server/sn2n-proxy.out --error server/sn2n-proxy.err
```

Health check and quick verification

```sh
# Ping the running proxy
curl -sS http://localhost:3004/ping
# Service status
curl -sS http://localhost:3004/api/status
```

Notes:

- The proxy listens on `PORT` (default 3004). If you keep `NOTION_TOKEN` set the proxy will attempt to create pages in Notion when you POST to `/api/W2N`.
- For quick conversion testing without creating pages, POST the payload with `dryRun: true` and the proxy will return converted Notion blocks instead of creating a page.
- Logs are written to `server/sn2n-proxy.out` (or your chosen log path when using pm2/nohup).

## Recommended JSON response contract

All endpoints should return JSON. Use this canonical success/error contract to make client parsing simple and robust.

- Success response (standard):

```json
{
  "success": true,
  "data": {
    /* resource-specific payload */
  },
  "meta": {
    /* optional pagination or debug metadata */
  }
}
```

- Error response (standard):

```json
{
  "success": false,
  "error": "Short machine-friendly message",
  "message": "Human-friendly explanation",
  "details": {
    /* optional error body from upstream API */
  }
}
```

Notes:

- Keep `error` short and constant for programmatic checks (e.g. `NOTION_CLIENT_UNINITIALIZED`).
- Use `message` for user-facing text that may include guidance.
- Include `details` when surfacing upstream API responses to aid debugging in development.

## Endpoint examples

- GET /health

Success example:

```json
{
  "status": "ok",
  "version": "dev",
  "notion": { "tokenConfigured": true, "clientInitialized": true },
  "ts": "2025-09-30T03:21:35.672Z"
}
```

- GET /api/databases

Success example (list):

```json
{
  "success": true,
  "data": {
    "results": [{ "id": "<id>", "title": "My DB", "url": "https://..." }],
    "has_more": false
  }
}
```

- GET /api/databases/:id

Success example (schema):

```json
{
  "success": true,
  "data": {
    "id": "24ca89fe-dba5-806f-91a6-e831a6efe344",
    "title": "ServiceNow-2-Notion (API DB)",
    "properties": {
      /* Notion-style properties map */
    },
    "url": "https://www.notion.so/...",
    "schema": {
      /* typed schema summary if available */
    }
  }
}
```

Error example (Notion client not initialized):

```json
{
  "success": false,
  "error": "NOTION_CLIENT_UNINITIALIZED",
  "message": "Notion API client not initialized. Ensure NOTION_TOKEN is set in server/.env or environment.",
  "details": null
}
```

## Client-side guidance

Clients (the userscript) should:

- Check `response.success === true` before assuming a `data` payload.
- If `success` is false, prefer `error` for programmatic handling and `message` for UI display.
- Use `meta` for pagination and keep local caches keyed by `id`.

## Runtime logging control

The proxy exposes runtime logging toggles:

- GET /api/logging -> { success: true, data: { verbose: boolean } }
- POST /api/logging { verbose: boolean } -> { success: true, data: { verbose: boolean } }

The userscript's Advanced Settings UI toggles this endpoint which sets an in-process verbose flag. This is intended for development and not for production.

## Notes and recommendations

- Standardize on the `success/data/meta` shape across endpoints. The proxy currently returns a few shapes (legacy support) — normalize them where possible and return the canonical shape to avoid client compatibility code.
- Keep secrets out of git and ensure `server/.env` is ignored. Use environment variables in CI/deploy systems.
- For production or CI runs, prefer supplying `NOTION_TOKEN` via process environment rather than dotenv files.

---

If you'd like, I can update the proxy implementation to always return the canonical `success/data/meta` shape and add a small compatibility shim so older clients continue to work. Want me to do that next?
SN2N proxy — quick reference

This folder contains the local dev proxy used to help the userscript interact with Notion.

Main runnable scripts

- `sn2n-proxy.cjs` — runnable CommonJS dev proxy (used during development).
- `sn2n-proxy.js` — lightweight proxy variant.
- `m2n-proxy-full.js` — reference/full proxy implementation (kept for completeness).

Common endpoints

- GET /health
  - Returns service status and Notion token presence.
- GET /ping
  - Simple pong endpoint.
- GET /api/status
  - Service metadata (uptime, version).
- GET /api/logging
  - Returns { success: true, verbose: boolean } reflecting runtime verbose logging.
- POST /api/logging
  - Accepts JSON { verbose: boolean } to toggle server-side verbose logging at runtime.
- POST /api/W2N
  - Main endpoint used by the userscript to create a Notion page. See code for expected payload fields.
- POST /fetch-and-upload
  - Downloads an image and uploads to Notion (returns fileUploadId).
- POST /upload-to-notion
  - Accepts base64 or dataURI file uploads and uploads to Notion via the file_uploads flow.
- GET /api/databases
  - Lists databases the integration can access (with optional search q parameter).
- GET /api/databases/:id
  - Returns typed schema and basic database info.
- GET /api/databases/:id/schema
  - Returns the typed property schema for a database (same as /api/databases/:id/schema).

Toggling verbose logs

- For the runnable proxy (`sn2n-proxy.cjs`) you can toggle verbose runtime logging without restarting by calling:
  - GET /api/logging (to read current state)
  - POST /api/logging with JSON `{ "verbose": true }` to enable
  - POST /api/logging with JSON `{ "verbose": false }` to disable
- For the reference files in `refactor/` and `server/m2n-proxy-full.js`, verbose output is suppressed unless you explicitly set environment variables when running Node:
  - `SN2N_VERBOSE=1 node server/m2n-proxy-full.js` or
  - `SN2N_REF_DEBUG=1 node server/m2n-proxy-full.js`

Notes

- The `refactor/` directory contains monolithic/original versions kept for reference. They are intentionally quiet by default. Enable the debug flags above if you need to run them interactively.
- For production use, prefer `sn2n-proxy.cjs` and set a real `NOTION_TOKEN` in `.env` or environment variables.
