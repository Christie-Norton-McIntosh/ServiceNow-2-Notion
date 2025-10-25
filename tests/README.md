# Tests Folder

This directory consolidates ad-hoc test scripts and HTML samples.

- Root-level tests here are standalone scripts that hit the local proxy (`http://localhost:3004`) or validate parsing/splitting logic.
- Server-specific unit-like scripts live in `../server/tests/` and import server modules via relative paths.

## Running examples

- Run a simple dry-run conversion:
  
  node tests/test-callout.cjs

- Run a server-side converter test (no HTTP):
  
  node server/tests/test-actual-html.cjs

Note: Some scripts expect the local proxy to be running:

  npm start

