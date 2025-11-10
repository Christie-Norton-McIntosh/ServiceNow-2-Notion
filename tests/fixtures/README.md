# Test Fixtures

This directory contains HTML samples captured from ServiceNow pages for testing and regression validation.

## Directory Structure

```
fixtures/
├── validation-failures/     # Auto-captured HTML from pages with validation errors
│   └── [page-title]-[timestamp].html
├── manual-samples/          # Manually added test cases
│   └── [descriptive-name].html
└── README.md               # This file
```

## validation-failures/

HTML samples are **automatically captured** when a page conversion results in validation errors. Each file contains:

- **Filename format**: `[sanitized-page-title]-[ISO-timestamp].html`
- **Content**: The raw HTML sent from the userscript to the proxy server
- **Metadata comment**: First line contains page title, URL, timestamp, and validation error summary

### Purpose
- **Regression testing**: Verify that code changes don't break previously-working pages
- **Bug reproduction**: Isolate and debug specific validation failures
- **Test coverage**: Build a comprehensive test suite covering edge cases

### Usage

1. **Automated capture**: Happens automatically when validation fails (Error checkbox set)
2. **Manual testing**: Use captured HTML with dry-run scripts:
   ```bash
   # Example: Test with a specific fixture
   node tests/test-fixture.js tests/fixtures/validation-failures/add-or-modify-2025-11-09.html
   ```
3. **Regression suite**: Run all fixtures to ensure no regressions:
   ```bash
   npm run test:fixtures
   ```

## manual-samples/

Add HTML samples here for specific test cases:

```bash
# Example: Save HTML from browser console
copy(document.querySelector('.zDocsTopicPageBody').outerHTML);
# Paste into tests/fixtures/manual-samples/my-test-case.html
```

### Naming conventions
- Use descriptive kebab-case names: `nested-tables-with-images.html`
- Include comments at the top describing the test scenario
- Add to version control for team sharing

## Best Practices

1. **Review captures**: Periodically review `validation-failures/` and move interesting cases to `manual-samples/`
2. **Clean up old captures**: Remove duplicates or outdated samples after fixes
3. **Document edge cases**: Add comments to complex samples explaining the issue
4. **Git tracking**: Commit interesting samples but consider `.gitignore` for large validation-failures folder

## Configuration

The automatic capture is controlled by:
- **Server**: `server/routes/w2n.cjs` - saves HTML when `validationResult.hasErrors` is true
- **Enable/disable**: Set `SN2N_SAVE_VALIDATION_FAILURES=false` environment variable to disable
- **Directory**: Configurable via `SN2N_FIXTURES_DIR` environment variable (default: `tests/fixtures/validation-failures`)

## Example Fixture

```html
<!-- 
  Page: Add or modify risk conditions
  URL: https://docs.servicenow.com/bundle/.../define-risk-and-impact-conditions.html
  Captured: 2025-11-09T20:30:45.123Z
  Validation Errors: Marker leak: 2 visible sn2n:marker tokens found; Missing heading: Related Content
-->
<div class="zDocsTopicPageBody">
  <!-- page content -->
</div>
```

## Related Files

- `server/routes/w2n.cjs` - Validation logic and auto-capture
- `server/utils/validate-notion-page.cjs` - Validation rules
- `tests/test-fixture.js` - Script to test individual fixtures (create if needed)
- `package.json` - Add `test:fixtures` script for batch testing
