# Recurring Page Failures Analysis — CMDB Pages (Nov 16, 2025)

## Problem Summary

Four CMDB pages are **repeatedly failing validation** after creation/PATCH attempts. They have persistent validation errors and are stuck in the `patch/pages/pages-to-update/` directory.

---

## Pages & Failures

### 1. Computer [cmdb_ci_computer] class — v2 (2025-11-16T21-46-58)
- **Page ID:** `2ada89fe-dba5-81c2-a32f-c934974370cf`
- **URL:** `/docs/.../class-computer.html`
- **Validation Errors:** 
  - ❌ **Table count mismatch: expected 2, got 1**
- **Block Count:** Expected 35 → Got 84 (140% expansion)
- **Status:** Failing repeatedly

### 2. Computer [cmdb_ci_computer] class — v1 (2025-11-15T06-55-14)
- **Page ID:** `2aca89fe-dba5-81e4-9f38-d8d3e5bdcc50`
- **URL:** `/docs/.../class-computer.html` (same page, older capture)
- **Validation Errors:**
  - ❌ **Table count mismatch: expected 2, got 1**
  - ⚠️ Block count high: expected 35, got 89 (254% expansion)
  - ⚠️ Extra list items: expected 36, got 38 (+2)
- **Status:** Failing repeatedly

### 3. Explore CMDB Workspace (2025-11-16T21-46-17)
- **Page ID:** `2ada89fe-dba5-81f9-8b54-de4f81aae2b1`
- **URL:** `/docs/.../exploring-cmdb-workspace.html`
- **Validation Errors:**
  - ❌ **Table count mismatch: expected 1, got 0** (table missing!)
  - ❌ **Callout count too low: expected 2, got 0** (callouts missing!)
- **Block Count:** Expected 42 → Got 49 (117% expansion)
- **Status:** Critical missing content

### 4. Home view in CMDB Workspace (2025-11-16T21-46-40)
- **Page ID:** `2ada89fe-dba5-8166-ada4-d17f12438ef7`
- **URL:** `/docs/.../cmdb-workspace-home-view.html`
- **Validation Errors:**
  - ❌ **Callout count too low: expected 2, got 0** (callouts missing!)
- **Block Count:** Expected 78 → Got 102 (131% expansion)
- **Status:** Missing callout content

---

## Root Cause Analysis

### Pattern 1: Table Count Mismatch
**Pages 1 & 2 (Computer class)**
- Both are **DataTables** with complex nested content
- Table count drops from 2 → 1 or missing entirely
- Likely cause: **Nested table unwrapping issue** or **table detection failure**

**Page 3 (Explore CMDB)**
- Table entirely missing (expected 1, got 0)
- Likely cause: **Table not being extracted** from source HTML

### Pattern 2: Callout Count Mismatch
**Pages 3 & 4 (Workspace pages)**
- Expected callouts: 2, Got: 0
- Likely cause: **Callout detection failure** or **markup changed between extraction and conversion**

### Pattern 3: Block Count Expansion (85%-254%)
**All pages show significant expansion**
- Expected ~35-78 blocks → Got 49-102 blocks
- This is **normal for deep nesting**, but combined with missing tables/callouts suggests **orchestration incomplete**

---

## Likely Issues

### Issue 1: Table Detection & Unwrapping
**Symptom:** Table count drops by 50% or goes to 0
**Root cause options:**
- DataTables wrapper not being unwrapped correctly
- Nested `<table>` elements within DataTables not being found
- Multiple tables being treated as one
- Table not being recognized as a valid Notion table block

**Files to check:**
- `server/converters/table.cjs` — Table extraction logic
- `server/services/servicenow.cjs` — DataTables unwrapping (multi-pass logic)

### Issue 2: Callout Detection Failure
**Symptom:** Expected 2 callouts, got 0
**Root cause options:**
- Callout class detection not working for this HTML
- Callout markup is different/wrapped differently
- Regex pattern doesn't match the source HTML structure

**Files to check:**
- `server/converters/rich-text.cjs` — Callout detection patterns
- `server/services/servicenow.cjs` — Callout block detection

### Issue 3: Deep Nesting Orchestration Incomplete
**Symptom:** Block count expands 100%+, but validation still fails
**Root cause options:**
- Orchestration markers not being cleaned up after append
- Marker leak (visible `sn2n:marker` tokens in output)
- Orchestration PATCH not completing before validation runs
- Children appended at wrong nesting level

**Files to check:**
- `server/orchestration/deep-nesting.cjs` — Marker cleanup
- `server/orchestration/marker-management.cjs` — Marker insertion/removal

---

## Diagnostic Steps

### 1. Check Server Logs
```bash
# Run with maximum debugging
SN2N_VERBOSE=1 SN2N_EXTRA_DEBUG=1 npm start

# Then run one page through dry-run
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Computer Class",
    "databaseId":"282a89fedba5815e91f0db972912ef9f",
    "contentHtml":"<content>",
    "dryRun":true
  }'
```

### 2. Check for Marker Leaks
```bash
# Look for visible sn2n:marker tokens in Notion page
# Check Error property in Notion for "Marker leak" message
```

### 3. Extract Individual Block Data
```bash
# Get dry-run output and check:
# - Are tables being detected?
# - Are callouts being detected?
# - Are markers present in rich_text?
```

---

## Why They Keep Failing

### Cycle: Create → Validation Fails → Auto-save to pages-to-update

1. **Initial Creation** — Page created with issues
2. **Validation Runs** — Issues detected
3. **Auto-save on Failure** — Page saved to `pages-to-update/` with error metadata
4. **Retry Attempt** — Same PATCH operation attempted
5. **Same Issues** — Table/callout detection still broken
6. **Back to pages-to-update** — Cycle repeats

This creates a **"stuck page"** state where the page won't move forward until the underlying issue is fixed.

---

## Solutions

### Short Term (Unblock These Pages)

**Option A: Manual Fix in Notion**
- Delete and recreate from fresh extraction
- Fix content manually in Notion
- Remove from pages-to-update

**Option B: Bypass Validation**
```bash
# Run PATCH without validation
curl -X PATCH http://localhost:3004/api/W2N/2ada89fe-dba5-81c2-a32f-c934974370cf \
  -H "Content-Type: application/json" \
  -d '{
    "contentHtml":"<new content>",
    "skipValidation":true
  }'
```

### Long Term (Fix Root Causes)

**Priority 1: Table Detection**
- Review `server/services/servicenow.cjs` DataTables unwrapping logic
- Add test cases for nested tables within DataTables
- Verify multi-pass unwrapping is working

**Priority 2: Callout Detection**
- Review regex patterns in callout detection
- Add debug logging for class matching
- Test against actual ServiceNow HTML markup

**Priority 3: Orchestration Cleanup**
- Verify markers are being removed after append
- Add marker leak detection/reporting
- Check validation is running after orchestration completes

---

## Questions for Investigation

1. **Were these pages recently changed?** The computer class has v1 (2025-11-15) and v2 (2025-11-16), suggesting they keep being re-extracted.

2. **Does the HTML contain unusual markup?** CMDB docs might have different table structures than other ServiceNow docs.

3. **Is the validation too strict?** The tolerance bands (70%-150% blocks) might be too tight for these complex pages.

4. **Did something break recently?** Check git log for changes to:
   - Table extraction logic
   - Callout detection
   - Orchestration

---

## Next Steps

**Recommend:**
1. Check server logs with verbose output during dry-run extraction
2. Identify which converter is failing (table or callout)
3. Add targeted debug logging
4. Create test fixture with this HTML for regression testing
5. Fix root cause
6. Clear this batch and retry

**Timeline:** 
- Root cause analysis: 15-30 minutes
- Fix implementation: 30-60 minutes  
- Retry and verification: 10-15 minutes

---

## Files Involved

**Conversion/Detection:**
- `server/services/servicenow.cjs` — Block orchestration, DataTables, callout detection
- `server/converters/table.cjs` — Table cell extraction
- `server/converters/rich-text.cjs` — Callout markup detection

**Orchestration:**
- `server/orchestration/deep-nesting.cjs` — Marker-based orchestration
- `server/orchestration/marker-management.cjs` — Marker lifecycle

**API Integration:**
- `server/routes/w2n.cjs` — PATCH endpoint, validation invocation

---

**Status:** Diagnostic guide created. Ready to investigate and fix root causes.

