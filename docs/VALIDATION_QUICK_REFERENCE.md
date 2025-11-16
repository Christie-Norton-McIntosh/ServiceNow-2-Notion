# Quick Reference: Validation Scripts

## Single File Validation

```bash
# Using npm script
npm run validate path/to/file.html

# Direct execution
node scripts/validate-html-to-notion-conversion.cjs path/to/file.html

# Example
npm run validate patch/pages-to-update/example.html
```

## Batch Validation

```bash
# Using npm script
npm run validate:batch path/to/directory

# Direct execution
node scripts/batch-validate-conversions.cjs path/to/directory

# Example
npm run validate:batch patch/pages-to-update
```

## Common Workflows

### Validate Before PATCH
```bash
# Validate all files in pages-to-update
npm run validate:batch patch/pages-to-update

# Check results
cat patch/pages-to-update/validation-results.json | jq '.summary'

# Review problematic files
cat patch/pages-to-update/validation-results.json | jq '.results[] | select(.status != "pass") | .file'
```

### Test Specific File
```bash
# Validate single file with detailed output
npm run validate patch/pages-to-update/onboard-github-to-devops-change-velocity-workspace-2025-11-11T08-55-59.html
```

### Compare Before/After Fix
```bash
# Before fix
npm run validate patch/pages-to-update/problem-page.html > before.txt

# (Make fixes to server code, restart server)

# After fix
npm run validate patch/pages-to-update/problem-page.html > after.txt

# Compare
diff before.txt after.txt
```

## Understanding Results

### ✅ PASS
All content preserved correctly.

### ⚠️ WARN
Minor acceptable differences (duplicate filtering, heading level conversion, etc.).

### ❌ FAIL
Significant content missing or mismatched structure.

## Exit Codes

- `0` = Validation passed (with or without warnings)
- `1` = Validation failed (significant errors)

## Quick Tips

1. **Always validate before PATCH** - catch issues early
2. **Review JSON output** - detailed breakdown in `validation-results.json`
3. **Check warnings** - some are acceptable (see docs)
4. **Server must be running** - start with `npm start`
5. **Use absolute paths** - or run from repo root
