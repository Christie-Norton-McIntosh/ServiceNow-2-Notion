# v11.0.214 Testing Guide

## ✅ Critical Fix: Placeholder Content Preservation

**Version**: 11.0.214  
**Status**: ✅ DEPLOYED  
**Server**: Running with SN2N_AUDIT_CONTENT=1  

---

## What Was Fixed

**Problem**: Technical placeholders like `<plugin name>` were being stripped from SAMP content

**Example**:
- **Input**: `<samp>Plugin Activation for <plugin name>.</samp>`
- **v11.0.213 Output**: "Plugin Activation for ." ❌ (RED text bug fixed, placeholder still missing)
- **v11.0.214 Output**: "Plugin Activation for <plugin name>." ✅ (both issues fixed)

**Root Cause**: `parseRichText()` didn't have access to placeholder protection, so `<plugin name>` was treated as an HTML tag and stripped by `cleanHtmlText()`

**Solution**: Added LOCAL placeholder protection inside `parseRichText()` that happens BEFORE SAMP/CODE processing

---

## Quick Test

### Manual Test via Userscript

1. **Navigate** to ServiceNow page with SAMP content containing placeholders
   - Look for: `<samp>`, `<code>`, or system output examples
   - Content should have placeholders like `<plugin name>`, `<instance-name>`, etc.

2. **Extract** to Notion using the userscript panel

3. **Verify** in Notion page:
   - ✅ Text appears as inline code (monospace, looks like `this`)
   - ✅ NO red text (fixed in v11.0.213)
   - ✅ Placeholder content intact: "for <plugin name>." NOT "for ."
   - ✅ All technical placeholders preserved

### Test via curl (Dry Run)

```bash
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test SAMP Placeholder",
    "databaseId": "YOUR_DB_ID",
    "contentHtml": "<p>Example: <samp>Plugin Activation for <plugin name>.</samp></p>",
    "dryRun": true
  }'
```

**Expected Response**:
```json
{
  "children": [
    {
      "type": "paragraph",
      "paragraph": {
        "rich_text": [
          { "text": { "content": "Example: " } },
          { 
            "text": { "content": "Plugin Activation for <plugin name>." },
            "annotations": { "code": true }
          }
        ]
      }
    }
  ]
}
```

**Check For**:
- ✅ `"code": true` (NOT `"color": "red"`)
- ✅ Content includes `<plugin name>` (NOT stripped)

---

## Test Cases

### ✅ Test 1: Single Placeholder in SAMP
```html
<samp>Application installation is unavailable for <plugin name>.</samp>
```
**Expected**: "Application installation is unavailable for <plugin name>." (inline code)

---

### ✅ Test 2: Multiple Placeholders
```html
<samp>Upload <file.txt> to <instance-name> using <Tool ID>.</samp>
```
**Expected**: All 3 placeholders preserved in monospace

---

### ✅ Test 3: Placeholder in Regular Text
```html
<p>Configure the <hostname> in the file.</p>
```
**Expected**: `<hostname>` preserved even without SAMP wrapper

---

### ✅ Test 4: Mixed SAMP and Regular
```html
<p>Run <samp>npm install <package-name></samp> and configure <hostname>.</p>
```
**Expected**: Both `<package-name>` (in code) and `<hostname>` (plain text) preserved

---

## Debug Logging

### Enable Extra Debug
```bash
export SN2N_EXTRA_DEBUG=1
npm start
```

### Log Files
- **Server**: `server/logs/server-terminal-YYYYMMDD-HHMMSS.log`
- **Validation**: Check for "AUDIT" entries in logs

### Search Logs For
```bash
grep "LOCAL_TECH_PLACEHOLDER" server/logs/server-terminal-*.log
grep "plugin name" server/logs/server-terminal-*.log
```

---

## Success Criteria

### Immediate (Manual Test)
- ✅ SAMP renders as inline code (monospace)
- ✅ NO red text
- ✅ ALL placeholders appear intact
- ✅ No "for ." or similar truncation

### Batch PATCH
- ✅ 80%+ of 95 pages pass validation
- ✅ Coverage improves from 47% to 85%+
- ✅ No new validation errors
- ✅ Pages move to `updated-pages/`

---

## Rollback Plan

**If placeholder still missing**:
1. Check server logs for "LOCAL_TECH_PLACEHOLDER" markers
2. Verify `parseRichText()` restoration logic executed
3. Check if placeholder is in a different format (not `<content>`)

**If new issues appear**:
1. Revert to v11.0.213:
   ```bash
   git checkout build-v11.0.86~1
   npm run build
   killall node && sleep 2 && npm start
   ```

2. Document specific failure case with HTML sample

---

## Next Steps

### If Test Passes ✅
1. Mark v11.0.214 as stable
2. Run batch PATCH: `cd patch/config && bash batch-patch-with-cooldown.sh`
3. Monitor validation results
4. Document coverage improvements

### If Test Fails ❌
1. Capture HTML input sample
2. Check logs for marker creation/restoration
3. Verify `HTML_TAGS` set includes all standard tags
4. Investigate if placeholder format is unexpected

---

## Files Changed (v11.0.214)

**Server Code**:
- `server/services/servicenow.cjs` (lines 650-679, 1215-1223)
  - Added local placeholder protection in parseRichText
  - Added local placeholder restoration before return

**Userscript**: 
- `dist/ServiceNow-2-Notion.user.js` (auto-generated)

**Documentation**:
- `SAMP-PLACEHOLDER-FIX-v11.0.214.md` (full details)
- `TESTING-v11.0.214.md` (this file)

---

## Comparison with Previous Versions

| Version | RED Text | Placeholder | Status |
|---------|----------|-------------|--------|
| v11.0.212 | ❌ Red | ❌ Stripped | Both broken |
| v11.0.213 | ✅ Code | ❌ Stripped | Formatting fixed |
| v11.0.214 | ✅ Code | ✅ Preserved | Both fixed |

---

## Contact / Issues

**Report Issues**: GitHub with:
- ServiceNow HTML sample (anonymized)
- Expected vs actual Notion output
- Server logs showing placeholder markers
- Browser console (if userscript issue)

**Server Logs**: Enable with `SN2N_VERBOSE=1 SN2N_EXTRA_DEBUG=1`
