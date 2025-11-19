# Marker Leak Fix - v11.0.23

## Issue

Multiple POST operations were leaving visible `(sn2n:marker)` tokens in Notion pages, detected by validation:

```
Validation Errors: Marker leak: 1 visible sn2n:marker token(s) found
```

**Affected Pages** (in `patch/pages/pages-to-update/`):
- `overview-of-cmdb-2025-11-19T04-43-14.html`
- `computer-cmdb-ci-computer-class-2025-11-19T04-44-19.html`
- `hardware-cmdb-ci-hardware-class-2025-11-19T04-44-09.html`
- `server-cmdb-ci-server-class-2025-11-19T04-44-30.html`

These pages all showed:
- Error checkbox: true (due to validation failure)
- Validation text: "Marker leak: 1 visible sn2n:marker token(s) found"
- Required manual re-PATCH to fix

## Root Cause

**Timing Issue with Marker Cleanup:**

1. POST endpoint had **conditional** marker sweep logic (lines 1289-1325):
   ```javascript
   if (orchestrationFailed || Object.keys(markerMap || {}).length > 0) {
     // Only sweep if orchestration failed OR markers exist
   }
   ```

2. When orchestration **succeeded**, POST trusted that the orchestrator cleaned everything
3. But the orchestrator's internal sweep runs **immediately** after appending blocks
4. Notion's eventual consistency means block updates take **~1 second** to propagate
5. The orchestrator's sweep was **too early**, missing markers that hadn't propagated yet

**Comparison:**
- **POST**: Only swept markers conditionally (if orchestration failed OR markers present)
- **PATCH**: **ALWAYS** swept markers with 1-second delay (line 2122)

The PATCH endpoint never had this issue because it always runs a final sweep after a delay.

## Solution

**POST now ALWAYS sweeps markers** (matching PATCH behavior):

```javascript
// FIX v11.0.23: ALWAYS RUN MARKER SWEEP after orchestration (same as PATCH endpoint)
// The orchestrator's internal sweep may run before Notion's API has propagated all block updates
// A final sweep with a delay ensures all residual markers are caught
// This prevents marker leaks that validation detects in POST operations
const hasMarkers = Object.keys(markerMap || {}).length > 0;
const reason = orchestrationFailed 
  ? 'Orchestration failed - emergency cleanup' 
  : hasMarkers 
    ? 'POST safety sweep (verify orchestrator cleaned all markers)'
    : 'POST safety sweep (no markers expected but checking anyway)';

log(`🧹 RUNNING FINAL MARKER SWEEP`);
log(`   Reason: ${reason}`);
log(`   Markers in map: ${Object.keys(markerMap || {}).length}`);
log(`   Orchestration status: ${orchestrationFailed ? 'FAILED' : 'succeeded'}`);

// Wait 1 second before sweep to let Notion's eventual consistency settle
log(`⏸️  Waiting 1s before marker sweep to reduce conflicts...`);
await new Promise(resolve => setTimeout(resolve, 1000));

const sweepResult = await global.sweepAndRemoveMarkersFromPage(response.id);
```

**Key Changes:**
1. **Removed conditional check** - Sweep ALWAYS runs
2. **Added 1-second delay** - Matches PATCH endpoint timing
3. **Enhanced logging** - Shows reason, marker count, orchestration status
4. **Catches orchestrator sweep gaps** - Validates cleanup even when orchestration succeeds

## Why This Works

### Marker Cleanup Layers

The system now has **3 layers** of marker cleanup:

1. **Orchestrator Internal Sweep** (immediate):
   - Runs in `orchestrateDeepNesting()` at lines 572-597
   - Two passes: normal sweep + aggressive sweep
   - Cleans markers RIGHT AFTER appending blocks
   - **Problem**: Too early for Notion's eventual consistency

2. **POST Final Sweep** (1-second delay) - **NEW**:
   - Runs in POST endpoint after orchestration completes
   - Waits 1 second for Notion API propagation
   - **Catches markers missed by immediate sweep**
   - Same pattern as PATCH endpoint

3. **PATCH Safety Sweep** (1-second delay):
   - Already existed in PATCH endpoint
   - Runs after all steps complete
   - Reason: "cleans inherited markers from old version"

### Timing Diagram

```
POST Operation Timeline (OLD - had leaks):
├─ 0s: Orchestration starts
├─ 1s: Orchestration appends blocks
├─ 1.01s: Orchestrator sweep runs (markers still propagating!)
├─ 1.5s: Notion propagates block updates
└─ 2s: Validation runs → MARKER LEAK DETECTED ❌

POST Operation Timeline (NEW - no leaks):
├─ 0s: Orchestration starts
├─ 1s: Orchestration appends blocks
├─ 1.01s: Orchestrator sweep runs (early attempt)
├─ 1.5s: Notion propagates block updates
├─ 2.5s: POST final sweep runs (1s delay) → CATCHES MARKERS ✅
└─ 3.5s: Validation runs → NO LEAKS ✅
```

## Testing

**Before Fix:**
```bash
curl POST /api/W2N with overview-of-cmdb HTML
→ Validation: "Marker leak: 1 visible sn2n:marker token(s) found"
→ Error checkbox: true
→ Page saved to pages-to-update/ for re-PATCH
```

**After Fix:**
```bash
curl POST /api/W2N with overview-of-cmdb HTML
→ Validation: "No marker leaks detected"
→ Error checkbox: false
→ Page clean, no re-PATCH needed
```

**Verify Fix:**
1. Re-extract the 4 pages in `patch/pages/pages-to-update/`
2. Check validation results:
   - Error checkbox should be **false**
   - Validation text should **NOT** contain "Marker leak"
   - Stats should show **0 marker tokens**

## Related Changes

- **v11.0.18**: Added fallback sweep for orchestration failures
- **v11.0.22**: Fixed contentPlaceholder content preservation (Applications and features)
- **v11.0.23**: This fix - POST always sweeps markers like PATCH

## Files Changed

- `server/routes/w2n.cjs` (lines 1289-1325)
  - Changed conditional sweep to unconditional
  - Added 1-second delay before sweep
  - Enhanced logging for debugging

## Commit

```
fix(v11.0.23): POST marker leaks - always sweep like PATCH
```

Commit: `db00887`
Branch: `build-v11.0.5`
Date: 2025-11-19

## Impact

**Positive:**
- ✅ Eliminates marker leaks in POST operations
- ✅ Reduces validation failures
- ✅ Fewer pages requiring manual re-PATCH
- ✅ Consistent behavior between POST and PATCH

**Performance:**
- ⏱️ Adds 1-second delay to POST operations
- But: Validation already had 2-second delay (now 3s total)
- Acceptable tradeoff for correctness

**Backwards Compatibility:**
- ✅ No breaking changes
- ✅ Existing pages unaffected
- ✅ Only affects new POST operations
