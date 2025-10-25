# Tests and Scripts

Ad-hoc tests and small repro scripts live here. They’re split between:

- `tests/` — client-style or HTTP-based scripts that may call the local proxy at `http://localhost:3004`
- `server/tests/` — server-side scripts that import modules from `server/**` directly (no HTTP required)

You can run them individually with `node`, or via the minimal test runner.

## Quick start

1) List all discovered test scripts

   npm run test:list

2) Run all tests without starting the proxy

   npm run test:all

3) Start the proxy and then run all tests (for HTTP-based scripts in `tests/`)

   npm run test:all:server

## Minimal runner (scripts/run-tests.cjs)

The runner discovers files matching `test-*.cjs` in both `tests/` and `server/tests/`.

Flags and usage:

- List only

  node scripts/run-tests.cjs --list

- Start the proxy automatically, then run tests

  node scripts/run-tests.cjs --with-server

- Stop on first failure

  node scripts/run-tests.cjs --bail

- Run a subset by glob pattern

  node scripts/run-tests.cjs tests/test-callout-*.cjs
  node scripts/run-tests.cjs server/tests/test-*.cjs

- Run a single test file

  node scripts/run-tests.cjs server/tests/test-actual-html.cjs

Exit code is non-zero if any test fails.

## Running individual scripts directly

- HTTP/dry-run example (proxy required):

  npm start
  node tests/test-callout.cjs

- Server-only example (no HTTP):

  node server/tests/test-actual-html.cjs

## When do I need the proxy?

- Scripts under `tests/` that POST to `/api/W2N` (even with `dryRun: true`) require the proxy running on `http://localhost:3004`.
- Scripts under `server/tests/` generally run without the proxy and import modules directly (e.g., converters, services).

Tip: If you use `--with-server`, the runner will start the proxy, wait briefly, run tests, then stop it.

## Environment notes

- Proxy server reads `.env` in project root or `server/` for configuration. For dry-run tests, a Notion token is not required.
- macOS/zsh users: the documented commands are copyable as-is.

## Troubleshooting

- Connection refused (ECONNREFUSED): start the proxy (`npm start`) or use `--with-server`.
- Module not found inside `server/tests/`: ensure relative imports use `../` to reference `server/*` modules (these are already updated).
- Hanging tests: some scripts make network requests; confirm the proxy is running and reachable.

## File organization

- tests/
  - test-*.cjs — HTTP-based or client-style repros
- server/tests/
  - test-*.cjs — server-only repros importing from `server/**`

If you add a new script, name it `test-your-topic.cjs` so the runner will discover it automatically.

