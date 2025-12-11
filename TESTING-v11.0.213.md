# v11.0.213 Testing Checklist

## Quick Reference

**Version**: 11.0.213
**Fixes**: 
1. RED text bug (SAMP shows as red instead of monospace code)
2. Placeholder stripping (content like `<plugin name>` was being removed)

**Build Status**: ✅ DEPLOYED
**Server Status**: ✅ RUNNING (PID 21792, port 3004)

---

## Test Cases

### ✅ Test 1: SAMP with Nested Placeholder
**ServiceNow HTML**:
```html
<samp class='ph systemoutput sysout'>Application installation is unavailable... for <plugin name></samp>
```

**Expected Notion Output**:
- Text: "Application installation is unavailable... for <plugin name>."
- Format: Inline code (monospace)
- ❌ NOT red text
- ❌ NOT "for ." (placeholder must be intact)

**How to Test**:
1. Navigate to ServiceNow page with SAMP content
2. Click "Extract to Notion" in userscript panel
3. Check Notion page for:
   - Monospace formatting (looks like `code`)
   - Full text including `<plugin name>`

---

### ✅ Test 2: SAMP Without Placeholders
**ServiceNow HTML**:
```html
<samp>export PATH=$PATH:/usr/local/bin</samp>
```

**Expected Notion Output**:
- Text: "export PATH=$PATH:/usr/local/bin"
- Format: Inline code (monospace)

---

### ✅ Test 3: Multiple SAMP Tags
**ServiceNow HTML**:
```html
<p>Run <samp>npm install</samp> to install dependencies, then <samp>npm start</samp> to launch.</p>
```

**Expected Notion Output**:
- Text: "Run npm install to install dependencies, then npm start to launch."
- Format: "npm install" and "npm start" both as inline code

---

### ✅ Test 4: SAMP in Callout
**ServiceNow HTML**:
```html
<div class="note note">
  <p>Use <samp>sudo systemctl restart <service-name></samp> to restart the service.</p>
</div>
```

**Expected Notion Output**:
- Callout type: info (gray background)
- Text: "Use sudo systemctl restart <service-name> to restart the service."
- Format: Command text as inline code
- Placeholder: `<service-name>` intact

---

## Validation Commands

### Check Server Status
```bash
lsof -ti:3004  # Should return PID (e.g., 21792)
```

### Manual Test (curl)
```bash
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test SAMP",
    "databaseId": "YOUR_DB_ID",
    "contentHtml": "<p>Test: <samp>npm install <package-name></samp></p>",
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
          { "text": { "content": "Test: " } },
          { "text": { "content": "npm install <package-name>" }, "annotations": { "code": true } }
        ]
      }
    }
  ]
}
```

**Check For**:
- ✅ `"code": true` (NOT `"color": "red"`)
- ✅ Text includes `<package-name>` (NOT stripped)

---

## Batch PATCH Testing

**Prerequisites**:
1. ✅ Server running with SN2N_AUDIT_CONTENT=1
2. ✅ 95 pages in `patch/pages/pages-to-update/`
3. ⏳ Manual test passed (SAMP renders correctly)

**Command**:
```bash
cd patch/config
bash batch-patch-with-cooldown.sh
```

**Monitor For**:
- Reduced validation failures (previous: many due to stripped content)
- Improved coverage scores (target: 90%+)
- Successful PATCH operations (pages move to updated-pages/)

**Log Location**: `patch/logs/batch-patch-YYYYMMDD-HHMMSS.log`

---

## Success Criteria

### Immediate Validation (Manual Test)
- ✅ SAMP text shows as monospace code (like `this`)
- ✅ NO red text
- ✅ Placeholders like `<plugin name>` appear intact
- ✅ No content missing between "for" and "."

### Batch PATCH Success
- ✅ At least 80% of 95 pages pass validation
- ✅ Coverage scores improve from 47% to 85%+
- ✅ No new validation errors introduced
- ✅ Pages move to updated-pages/ (not stuck in pages-to-update/)

---

## Rollback Plan

**If Issues Occur**:
1. Revert to v11.0.212:
   ```bash
   git checkout build-v11.0.86~1
   npm run build
   ```

2. Restart server:
   ```bash
   killall node
   sleep 2
   npm start
   ```

3. Document failure mode in GitHub issue

**Red Flags**:
- ❌ SAMP still shows as red text → RED color fix failed
- ❌ Placeholders still stripped → cleanHtmlText fix failed
- ❌ New validation errors → introduced regression
- ❌ Server crashes → syntax error in new code

---

## Next Steps After Testing

### If All Tests Pass:
1. ✅ Mark v11.0.213 as stable
2. ✅ Run batch PATCH on 95 pages
3. ✅ Document coverage improvements
4. ✅ Close related issues (SAMP red text, placeholder stripping)

### If Issues Found:
1. ❌ Document failure mode
2. ❌ Determine if partial fix (one bug fixed, one still broken)
3. ❌ Create focused test case for broken scenario
4. ❌ Debug with SN2N_EXTRA_DEBUG=1

---

## Files Changed

**Userscript**: `dist/ServiceNow-2-Notion.user.js` (v11.0.213)
**Server**: 
- `server/services/servicenow.cjs` (lines 1102-1113)
- `server/utils/notion-format.cjs` (lines 147-156, 277-280)

**Documentation**: `SAMP-RED-TEXT-FIX-v11.0.213.md`

---

## Contact

**Issues**: Report in GitHub with:
- ServiceNow HTML sample (anonymized)
- Expected vs actual Notion output
- Server logs (if applicable)
- Browser console logs (if userscript issue)

**Logs**: Enable debug with `SN2N_VERBOSE=1 SN2N_EXTRA_DEBUG=1`
