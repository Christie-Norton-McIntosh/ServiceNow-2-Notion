# Server Tests

This directory contains test scripts and debugging utilities for the ServiceNow-2-Notion proxy server.

## Smoke Tests

Run the tests against a running local proxy server (default http://localhost:3004/api/W2N).

### Usage

```bash
# Start the proxy
npm run start

# In another terminal, run the smoke tests
node server/tests/proxy-smoke-test.js
```

### Environment Variables
- `SN2N_PROXY_URL` - optional, full URL to the W2N endpoint. Example: http://localhost:3004/api/W2N

### Notes
- Tests use `dryRun=true` to avoid creating Notion pages
- The fixtures are inline in the test script and cover key custom handling code paths: callouts with lists, duplicate image deduping, table+figure extraction, HTML entity decoding, and rich_text splitting
- The test script prints PASS/FAIL for each scenario and exits with non-zero code on failures

---

## Debug Scripts

Debug scripts are used for troubleshooting specific issues during development:

- `debug-duplicate-image.cjs` - Debug duplicate image detection logic
- `debug-duplicate-image-2.cjs` - Additional duplicate image debugging

**Note**: These scripts are for development use only and are not part of the test suite.
