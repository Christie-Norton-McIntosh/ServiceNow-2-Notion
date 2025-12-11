# v11.0.207 - Deferred Diff Analysis Implementation

## Problem Statement

The Audit diff analysis was capturing temporary `sn2n:` marker tokens that are used for orchestrating deep nesting (3+ levels). These marker tokens were appearing in the diff comparison as "missing blocks" when they were actually internal implementation details, not part of the final Notion page.

Example of the issue:
```
Missing block: "On the form, fill in the fields. (sn2n:miy0reea-hxhy94)"
```

The `(sn2n:miy0reea-hxhy94)` token is a placeholder used during the orchestration process and never appears in the final page.

## Root Cause

The diff analysis was computed during the **extraction phase** (in servicenow.cjs) BEFORE orchestration cleaned up the marker tokens. This timing issue meant the comparison included internal implementation artifacts.

## Solution Architecture

### Phase 1: Disable Early Diff (v11.0.206)
- Added `disableDiffInExtraction` flag in servicenow.cjs line 6421
- Prevents diff computation during extraction phase
- Diff is no longer included in `extractionResult.audit`

### Phase 2: Implement Deferred Diff (v11.0.207)
- **New function**: `computeDeferredDiff()` in w2n.cjs
  - Takes cleaned Notion blocks + HTML as input
  - Matches filtering logic from servicenow.cjs
  - Returns diff with missing/extra block counts and samples
  
- **Scope handling**: Declare `cleanedNotionBlocks` at function level
  - Populated after orchestration + deduplication
  - Also populated when NO markers present (fetches blocks anyway)
  - Available in property update loop
  
- **Timing**: Compute diff in property update loop
  - Runs AFTER orchestration naturally removes markers
  - Blocks are clean and final
  - Replaces missing `auditResult.diff` before using it in properties

- **Coverage**: Both marker and no-marker cases
  - With markers: Fetch blocks after deduplication (post-orchestration)
  - Without markers: Fetch blocks anyway (blocks are clean)
  - Ensures diff is always computed with final page state

## Code Changes

### servicenow.cjs
- Line 6421: Added `disableDiffInExtraction = true` flag
- Diff computation skipped with condition: `if (disableDiffInExtraction && enableAudit && ...)`
- Still returns `fixedHtml` in extraction result for deferred use

### w2n.cjs

#### New Helper Function (lines 105-276)
```javascript
function computeDeferredDiff(fixedHtml, cleanedBlocks, log)
```
- Comprehensive filtering (buttons, code, mini TOC, figures, table callouts)
- Block-by-block text extraction from HTML
- Block-by-block text extraction from Notion
- diff library support with fallback to set comparison
- Logging and error handling

#### Variable Declaration (line 1584)
```javascript
let cleanedNotionBlocks = [];
```
- Function-level scope (before orchestration)
- Populated by deduplication logic
- Available in property update loop

#### Block Fetching - Orchestration Case (lines 1721-1724)
```javascript
cleanedNotionBlocks = allBlocks;
log("✅ Post-orchestration deduplication complete");
```
- Stores final blocks after deduplication
- Inside existing try block for orchestrated content

#### Block Fetching - No-Markers Case (lines 1727-1753)
```javascript
} else {
  log("ℹ️ No markers to orchestrate (no deep nesting needed)");
  
  // FIX v11.0.207: Still need to fetch blocks for deferred diff computation
  try {
    const pageBlocks = await notion.blocks.children.list({ ... });
    cleanedNotionBlocks = pageBlocks.results || [];
    // ... fetch additional pages if needed
  } catch (blockFetchError) {
    cleanedNotionBlocks = [];
  }
}
```
- New code in else branch
- Ensures cleanedNotionBlocks populated even without orchestration
- Fetches all pages if needed for large content

#### Deferred Diff Computation (lines 2056-2070)
```javascript
// FIX v11.0.207: Compute deferred diff AFTER orchestration
if (auditResult && !auditResult.diff && extractionResult?.fixedHtml && cleanedNotionBlocks.length > 0) {
  const deferredDiff = computeDeferredDiff(extractionResult.fixedHtml, cleanedNotionBlocks, log);
  if (deferredDiff) {
    auditResult.diff = deferredDiff;
    log(`✅ Deferred diff computed: ${deferredDiff.missingBlocks} missing, ${deferredDiff.extraBlocks} extra`);
  }
}
```
- In property update loop (after orchestration completes)
- Only computes if diff doesn't exist yet
- Stores result in auditResult for use in property formatting
- Logs for debugging

## Key Improvements

1. **Marker-Free Diff**: Comparison happens after markers are naturally cleaned up
2. **Same Filtering**: Uses identical HTML filtering as extraction phase
3. **Universal Coverage**: Works for both marker and no-marker cases
4. **Clean Architecture**: Doesn't strip markers explicitly (let orchestration handle it)
5. **Accurate Validation**: Diff now reflects actual Notion page content

## Testing & Verification

The deferred diff should:
- NOT contain `(sn2n:xxxxx-yyyyy)` tokens
- Accurately reflect missing blocks (if any exist)
- Appear in Audit property without false positives
- Work for pages with 0, 1, or many markers

Monitor logs for:
- `[DEFERRED-DIFF] Computing diff after orchestration`
- `[DEFERRED-DIFF] HTML blocks` and `Notion blocks` counts
- `✅ Deferred diff computed` with accurate counts
- Audit property showing clean diff without markers

## Backward Compatibility

- No breaking changes to API
- Diff display logic unchanged (lines 2193-2224)
- Audit property format identical
- Only internal timing changes

## Related Files Modified

- `/server/routes/w2n.cjs`: Main implementation
- `/server/services/servicenow.cjs`: Disabled early diff with flag
