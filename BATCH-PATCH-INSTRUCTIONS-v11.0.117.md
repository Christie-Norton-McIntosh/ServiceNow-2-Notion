# Next Steps: Running Batch PATCH with All Fixes

**Version**: v11.0.116 + v11.0.117  
**Build**: 11.0.156  
**Date**: December 6, 2025

---

## ✅ Pre-Requisites (Completed)

- ✅ v11.0.116: PATCH property retry logic implemented
- ✅ v11.0.117: Menu cascade preprocessing implemented  
- ✅ Build v11.0.156: Generated and tested
- ✅ All basic tests passing (4/4)
- ✅ Integration test verified menu cascade preprocessing working

---

## 🚀 Step 1: Prepare for Batch PATCH

### 1a. Ensure Server is Ready

```bash
# Kill any existing Node processes
killall node

# Verify killed
ps aux | grep node  # Should show no sn2n-proxy.cjs

# Start server with full validation
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion
npm start
```

**Expected Output**:
```
✅ servicenowService.extractContentFromHtml: function
✅ W2N router configured with HOT-RELOAD wrapper (POST + PATCH)
✅ SN2N proxy listening on port 3004
```

### 1b. Verify Pages Are Ready

```bash
# Check how many pages are waiting for PATCH
ls -la /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/ | wc -l

# Expected: 37-49 pages (depending on what's in queue)
```

---

## 🔄 Step 2: Run Batch PATCH

### 2a. With Logging & Cooldown

```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion

# Run batch PATCH with validation
cd patch/config
bash batch-patch-with-cooldown.sh
```

**What This Does**:
1. Starts server with validation: `SN2N_AUDIT_CONTENT=1`
2. Processes pages in chunks of 3 with 10s cooldown
3. Validates after each PATCH
4. Moves successful pages to `updated-pages/`
5. Leaves failed pages in `pages-to-update/` for retry
6. Logs to stdout + `/tmp/batch-patch-latest.log`

### 2b. Monitor Progress

**In another terminal**:
```bash
# Watch batch progress in real-time
tail -f /tmp/batch-patch-latest.log | grep -E "(PATCH|Validation|Error|Success|Coverage)"

# Or: Watch page movement
watch -n 5 'echo "To Update:"; ls /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/ | wc -l; echo "Updated:"; ls /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/updated-pages/ | wc -l'
```

---

## ✨ Step 3: What to Expect

### 3a. Server Logs (First Page)

You should see:

```
🧪 Dry run mode - returning extracted blocks without updating page
✅ Extracted 7 blocks from HTML
📊 [AUDIT] Notion blocks: 7
📊 [AUDIT] Content coverage: 72.4% (threshold: 75-108%)
📊 [AUDIT] Result: ❌ FAIL

✅ [MENU-CASCADE] Converted to plain text: "Self Service > System Definition"
✅ [MENU-CASCADE] Converted to plain text: "Self Service > System UI"
✅ [MENU-CASCADE-PREPROCESS] Processed 2 menu cascade element(s)

✅ [PATCH-PROPERTY-RETRY] Success (after 1 retry)
```

**Key Signs**:
- ✅ `[MENU-CASCADE-PREPROCESS]` messages = fix is running
- ✅ `[PATCH-PROPERTY-RETRY]` messages = retry logic working
- Coverage >= 75% = validation passing

### 3b. Expected Results Summary

**Successful Pages**:
- Menu cascade pages: Coverage 72.5% → ~100% ✅
- Property-only failures: Now updating correctly ✅
- "Script includes and customization": Should PASS ✅

**Failed Pages** (if any):
- Logged with reasons
- Stay in `pages-to-update/` for manual investigation
- Can retry later with fixes

---

## 🎯 Step 4: Key Metrics to Track

### 4a. PATCH Success Rate

```
Expected: 75-90% pages pass on first run
(previously: ~0% properties were updating)
```

### 4b. Coverage Improvement

```
"Script includes and customization":
  Before: 72.5% ❌
  After:  ~100% ✅
```

### 4c. Menu Cascade Pages

```
Expected improvement: 2-5 pages
All should show menu paths preserved and coverage >= 75%
```

---

## 📊 Step 5: Post-Batch Analysis

### 5a. Check Results

```bash
# How many pages updated successfully?
ls /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/updated-pages/ | wc -l

# How many still need work?
ls /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/ | wc -l

# Check specific page
ls patch/pages/updated-pages/*script-includes-and-customization*
```

### 5b. View Details of Failed Pages

```bash
# List failed pages
ls patch/pages/pages-to-update/

# Check specific page metadata
head -50 patch/pages/pages-to-update/<page-filename>.html | grep "<!--"
```

### 5c. Summary Statistics

```bash
# Get batch summary from logs
tail -100 /tmp/batch-patch-latest.log | grep -E "(Total|Passed|Failed|Coverage|Error)" | tail -20
```

---

## 🔍 Step 6: Debugging If Issues Arise

### 6a. Server Not Responding

```bash
# Check if server is running
lsof -i :3004

# If not, restart
killall node
npm start
```

### 6b. No Menu Cascade Logs

```bash
# Verify fix is in code
grep -n "preprocessMenuCascades" server/services/servicenow.cjs

# Verify it's being called
grep -n "FIX v11.0.117" server/services/servicenow.cjs
```

### 6c. PATCH Still Failing

```bash
# Check retry logic
grep -n "PATCH-PROPERTY-RETRY" server/routes/w2n.cjs

# Verify property updates in logs
tail -200 server/logs/server-terminal-*.log | grep -i "property\|update\|notion"
```

---

## ✅ Step 7: Success Criteria

### All Objectives Met If:

1. ✅ "Script includes and customization" page:
   - Validation: PASSED ✅
   - Coverage: >= 75% (was 72.5%)
   - Menu paths: "Self Service > System Definition" preserved

2. ✅ Menu cascade pages (2-5 total):
   - All show coverage >= 75%
   - Moved to `updated-pages/`
   - Notion properties updated correctly

3. ✅ PATCH operations:
   - Property updates applied reliably
   - Retry logic working (visible in logs)
   - Batch script detects failures

4. ✅ No regressions:
   - Other pages still working
   - No new validation failures
   - Build quality maintained

---

## ⏮️ Rollback (If Needed)

### If Batch PATCH Causes Issues

```bash
# Stop current operation
# (Ctrl+C in batch script terminal)

# Kill server
killall node

# Revert to previous version from git
git checkout HEAD~1 server/services/servicenow.cjs
git checkout HEAD~1 server/routes/w2n.cjs
git checkout HEAD~1 server/converters/rich-text.cjs

# Rebuild
npm run build

# Restart server
npm start

# Pages in updated-pages/ can be re-PATCHED
```

---

## 📝 Batch PATCH Command Reference

### Quick Start

```bash
# Full batch with logging
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/config
bash batch-patch-with-cooldown.sh
```

### Advanced Options

```bash
# With extra debug output
SN2N_VERBOSE=1 bash batch-patch-with-cooldown.sh

# With debug order tracking
SN2N_DEBUG_ORDER=1 bash batch-patch-with-cooldown.sh

# Dry-run only (test without updating)
DRY_RUN=1 bash batch-patch-with-cooldown.sh
```

---

## 🎯 Expected Timeline

- **Setup**: ~2 minutes
- **First batch**: ~3-5 minutes (3 pages, 10s cooldown)
- **Full run**: ~30-60 minutes (37-50 pages)
- **Analysis**: ~10 minutes

**Total**: ~1-2 hours

---

## 🎓 Key Points to Remember

1. **Server must be running** during batch PATCH
2. **Pages move** automatically to `updated-pages/` on success
3. **Logs are your friend** - check them for `[MENU-CASCADE]` and `[PATCH-PROPERTY-RETRY]`
4. **Coverage >= 75%** is the success metric
5. **Notion properties** should update: Validation, Coverage, Status, Content Comparison

---

## 📞 Contacts for Help

### Reference Documents
- `SESSION-SUMMARY-v11.0.116-v11.0.117.md` - Overview of all fixes
- `VERIFICATION-COMPLETE-Menu-Cascade-Fix-v11.0.117.md` - Verification details
- `MENU-CASCADE-FIX-STRATEGY-v11.0.117.md` - Detailed strategy

### Commands to Help Debug
```bash
# See what's happening in real-time
tail -f /tmp/batch-patch-latest.log

# Monitor server processing
ps aux | grep node

# Check Notion connectivity
curl -s http://localhost:3004/api/status

# Manual test extraction
node test-menu-cascade-extraction.cjs
```

---

## ✨ You're Ready to Go!

All fixes are implemented and verified. Time to run the batch PATCH and see the improvements in action.

**Run**: `cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/config && bash batch-patch-with-cooldown.sh`

**Expected Result**: 75-90% of pages should pass validation after PATCH! ✅

---

**Build Version**: 11.0.156  
**Fixes Included**: v11.0.116 (PATCH retry) + v11.0.117 (Menu cascade)  
**Ready**: ✅ YES

