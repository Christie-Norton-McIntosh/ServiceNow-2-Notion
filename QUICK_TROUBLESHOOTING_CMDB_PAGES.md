# Quick Troubleshooting Guide — CMDB Pages Stuck in Validation Loop

## TL;DR

These 4 pages are stuck because they have **structural issues** (missing tables/callouts). They need either:
1. **Root cause investigation** (table/callout detection broken), OR
2. **Manual cleanup** (delete and restart)

---

## Immediate Diagnostics (Run These Now)

### Step 1: Run Server with Debug Output
```bash
# Terminal 1: Start server with maximum verbosity
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion
killall node 2>/dev/null || true
sleep 2
SN2N_VERBOSE=1 SN2N_EXTRA_DEBUG=1 npm start
```

### Step 2: Test One Page (Dry-Run Extraction)
```bash
# Terminal 2: Extract and convert without creating
# Use the computer class page (simpler, has known issue)

CONTENT=$(cat patch/pages/pages-to-update/computer-cmdb-ci-computer-class-2025-11-16T21-46-58.html | jq -Rs .)

curl -s -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d "{
    \"title\":\"Test Computer Class\",
    \"databaseId\":\"282a89fedba5815e91f0db972912ef9f\",
    \"contentHtml\":$CONTENT,
    \"dryRun\":true
  }" | jq '.' | tee /tmp/computer-dryrun.json
```

### Step 3: Check Dry-Run Output
```bash
# Examine the extracted blocks
cat /tmp/computer-dryrun.json | jq '.data.children[] | {type, properties}' | head -50

# Count block types
cat /tmp/computer-dryrun.json | jq '.data.children | group_by(.type) | map({type: .[0].type, count: length}) | sort_by(.count)'
```

### Step 4: Look for Key Issues
```bash
# Check for missing tables
cat /tmp/computer-dryrun.json | jq '[.data.children[] | select(.type == "table")] | length'
# Expected: 2 or 1 (we're seeing 0 or wrong count)

# Check for missing callouts  
cat /tmp/computer-dryrun.json | jq '[.data.children[] | select(.type == "callout")] | length'
# Expected: 2 for workspace pages, we're seeing 0

# Check for marker leaks
cat /tmp/computer-dryrun.json | jq -r '.data.children[] | select(.type == "paragraph") | .paragraph.rich_text[] | select(.text.content | contains("sn2n:marker")) | .text.content' | head -5
# If any output: marker leak detected

# Check validation result
cat /tmp/computer-dryrun.json | jq '.data.validationResult'
```

---

## Pattern Matching

### If You See: Table Count 0 or Wrong
```json
"validationResult": {
  "expectedCount": {"tables": 2},
  "actualCount": {"tables": 0},
  "hasErrors": true
}
```

**Diagnosis:** Table extraction broken for this HTML structure

**Check:**
1. Is the HTML using `<table>` or `<div class="table-wrap">`?
2. Are there nested DataTables?
3. Check server logs for table extraction errors

**Fix:**
- Look in `server/services/servicenow.cjs` for DataTables detection
- Check if multi-pass unwrapping logic is working
- Add debug logs to table extraction

---

### If You See: Callout Count 0 or Wrong
```json
"validationResult": {
  "expectedCount": {"callouts": 2},
  "actualCount": {"callouts": 0},
  "hasErrors": true
}
```

**Diagnosis:** Callout detection broken for this HTML structure

**Check:**
1. Search source HTML for callout markup (class names)
2. Look for patterns like `note_note`, `warning_type`, `note_important`
3. Check if markup has underscores or other patterns

**Fix:**
- Look in `server/converters/rich-text.cjs` for callout regex
- Check pattern against actual HTML classes
- Test regex: `grep -i "class.*\(note\|warning\|caution\|tip\)" input.html`

---

### If You See: Marker Tokens in Output
```
"text": {
  "content": "sn2n:marker_1234_xyz"
}
```

**Diagnosis:** Marker leak — orchestration didn't clean up after append

**Check:**
1. Did PATCH succeed?
2. Did orchestration complete?
3. Were markers removed from rich_text?

**Fix:**
- Check `server/orchestration/marker-management.cjs`
- Verify removal logic runs after append
- May need to manually clean up in Notion + re-PATCH

---

## Decision Tree: What to Do

```
Dry-run shows missing tables?
  → YES: Table extraction broken, needs code fix (Priority 1)
  → NO: Go to next

Dry-run shows missing callouts?
  → YES: Callout detection broken, needs code fix (Priority 2)
  → NO: Go to next

Dry-run has marker leaks?
  → YES: Orchestration incomplete, needs investigation
  → NO: Go to next

Dry-run looks clean but validation still fails?
  → YES: Check validation tolerance bands
  → NO: Should work! Try creating/patching

Validation tolerance is the issue?
  → YES: Pages might be legitimately complex (80+ tables in computer class)
  → Consider: Disable validation for this batch, manual review later
```

---

## Quick Fixes (If Issues Are Found)

### Fix 1: Table Detection (server/services/servicenow.cjs)

Look for the DataTables detection logic:
```javascript
// Find: DataTables/wrapper detection
if ($elem.hasClass('dataTables_wrapper') || $elem.hasClass('table-wrap')) {
  // Extract table(s) from wrapper
}
```

**Common issue:** Only finding first table, missing nested ones

**Test fix:**
```javascript
// Multi-pass: iterate until no changes
let found = true;
while (found) {
  found = false;
  $elem.find('.dataTables_wrapper').each(() => {
    // unwrap and mark found = true
  });
}
```

---

### Fix 2: Callout Detection (server/converters/rich-text.cjs)

Look for callout regex patterns:
```javascript
// Find: callout class detection
const calloutClass = /note_note|warning_type|caution/i;
```

**Common issue:** Pattern too strict or doesn't match actual classes

**Test fix:** Make regex more permissive
```javascript
// More permissive pattern
const calloutClass = /note|warning|caution|tip|alert|important/i;
```

Then test against HTML:
```bash
grep -o 'class="[^"]*"' patch/pages/pages-to-update/*.html | sort -u | grep -i note
```

---

### Fix 3: Temporarily Bypass Validation

If you need these pages to proceed while investigating:

```bash
# Edit server/routes/w2n.cjs, temporarily disable validation
// Around line 200-250, find validation check
if (validationFailed) {
  // TEMPORARILY: log but don't fail
  console.log('[TEMP-SKIP] Validation failed but proceeding:', validationErrors);
  // Comment out the throw or return error
}
```

**Then:**
```bash
npm run build  # rebuild userscript
npm start      # restart server
# Try PATCHing the pages again
```

---

## What NOT to Do

❌ **DON'T:** Keep retrying PATCH without investigating root cause — they'll keep failing  
❌ **DON'T:** Delete pages from Notion without backup — use manual-fix-first approach  
❌ **DON'T:** Modify HTML files — validation metadata is already captured  
❌ **DON'T:** Change validation tolerance globally — this might mask real issues  

---

## After You Fix

### If It's a Code Issue
1. Make the fix
2. Run `npm run build && npm start`
3. Test with dry-run again
4. Once dry-run passes, manually clear error flags in Notion
5. Try PATCH again on these 4 pages

### If It's a Validation Tolerance Issue  
1. Update tolerance bands in validation code
2. Rebuild and restart
3. Clear error flags
4. Retry PATCHes

### If It's a "Pages Are Complex" Issue
1. Accept the variance (85%-250% expansion is normal for deep nesting)
2. Run validation check manually
3. Approve exceptions
4. Move pages to updated-pages manually

---

## Notio Page IDs (For Reference)

- Computer class (v2): `2ada89fe-dba5-81c2-a32f-c934974370cf`
- Explore CMDB: `2ada89fe-dba5-81f9-8b54-de4f81aae2b1`
- Home view: `2ada89fe-dba5-8166-ada4-d17f12438ef7`

You can check these directly in Notion to see what's actually there.

---

## Estimated Time to Resolution

- **Diagnosis (dry-run):** 5 minutes
- **Root cause identification:** 5-10 minutes  
- **Fix implementation:** 15-45 minutes (depending on complexity)
- **Verification:** 10 minutes
- **Total:** 35-70 minutes

---

**Next Action:** Run Step 1 (server debug) and Step 2 (dry-run test) above. Share the output and we can identify the exact issue.

