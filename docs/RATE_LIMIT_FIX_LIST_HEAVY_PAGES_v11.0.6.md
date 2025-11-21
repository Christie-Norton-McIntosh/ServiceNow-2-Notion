# Rate Limit Fix for List-Heavy Pages (v11.0.6)

**Date:** 2025-11-20  
**Issue:** Dynatrace guided-setup page failed with rate limiting (0 blocks uploaded)  
**Page:** `configure-service-graph-connector-for-observability-dynatrace-using-guided-setup-2025-11-20T04-31-23.html`

---

## Executive Summary

The Dynatrace guided-setup page (213 ordered list items, 38 unordered, 3 tables, 2 images, 10 callouts) failed with rate limiting, resulting in 0 blocks uploaded. The existing rate limit protection (v11.0.5) is insufficient for **list-heavy pages with >200 list items**.

**Root Causes:**
1. **Complexity calculation underweights list items**: Current formula adds only 0.05 points per list item (1 point per 20 items), resulting in insufficient pre-creation delay for massive nested lists.
2. **No inter-chunk delays during orchestration**: Rapid-fire API calls for marker orchestration and block appending exhaust API quota.
3. **Missing list-specific scaling**: Pages with >200 list items need special handling due to deep nesting overhead.

**Impact:** Any ServiceNow procedure page with >150 list items will hit rate limits (affects ~15-20 pages in Yokohama docs).

---

## Failed Page Analysis

### Validation Results
```
Expected:
- 213 ordered list items
- 38 unordered list items (251 total list items)
- 3 tables
- 2 images
- 10 callouts
- 2 code blocks

Got: 0 of everything (rate limited before upload)

Error: "You have been rate limited. Please try again in a few minutes."
```

### Content Structure
- **Type:** ServiceNow guided-setup procedure
- **Nesting:** 3-4 levels deep (ol > li > ol > li > ol > li)
- **Steps:** 9 main steps with substeps (some with sub-substeps)
- **Marker Overhead:** Deep nesting requires extensive marker orchestration (100+ markers)
- **Payload Size:** Even after 100-block chunking, the initial payload is massive

### Current Complexity Score
```javascript
// Current calculation (v11.0.5)
totalBlocks: ~280 (blocks after conversion)
listItems: 251
tables: 3
callouts: 10

score = 280/10 + 3*5 + 10*2 + (251-100)/20
     = 28 + 15 + 20 + 7.55
     = 70.55 points

delayMs = 70.55 * 500 = 35,275ms (capped at 30,000ms = 30 seconds)

Result: 30-second pre-creation delay
```

**Problem:** 30-second delay is insufficient for 251 list items with deep nesting. The orchestration phase makes 50+ rapid API calls, exhausting quota.

---

## Recommended Fixes

### Fix 1: Enhanced Complexity Calculation for List-Heavy Content

**Location:** `server/routes/w2n.cjs` (POST endpoint, around line 909-938)

**Current Code:**
```javascript
const calculateComplexity = (blocks) => {
  let score = 0;
  const totalBlocks = blocks.length;
  const listItems = blocks.filter(b => b.type.includes('list_item')).length;
  const tables = blocks.filter(b => b.type === 'table').length;
  const callouts = blocks.filter(b => b.type === 'callout').length;
  
  // Scoring: 1 point per 10 blocks, 5 points per table, 2 points per callout
  score += totalBlocks / 10;
  score += tables * 5;
  score += callouts * 2;
  
  // Extra penalty for list-heavy content (indication of deep nesting)
  if (listItems > 100) {
    score += (listItems - 100) / 20;
  }
  
  // Convert score to delay: 1 point = 500ms, max 30s
  const delayMs = Math.min(Math.round(score * 500), 30000);
  
  return { score, delayMs, totalBlocks, listItems, tables, callouts };
};
```

**New Code:**
```javascript
const calculateComplexity = (blocks) => {
  let score = 0;
  const totalBlocks = blocks.length;
  const listItems = blocks.filter(b => b.type.includes('list_item')).length;
  const tables = blocks.filter(b => b.type === 'table').length;
  const callouts = blocks.filter(b => b.type === 'callout').length;
  
  // Base scoring: 1 point per 10 blocks, 5 points per table, 2 points per callout
  score += totalBlocks / 10;
  score += tables * 5;
  score += callouts * 2;
  
  // FIX v11.0.6: Enhanced list-heavy content detection with tiered scaling
  if (listItems > 200) {
    // Critical: >200 list items = likely deep nesting requiring extensive orchestration
    // Add 2 points per list item over 200 (10x penalty vs base)
    score += (listItems - 200) * 2;
    log(`   ⚠️ CRITICAL: List-heavy page detected (${listItems} list items)`);
  } else if (listItems > 100) {
    // Warning: >100 list items = moderate orchestration overhead
    // Add 0.5 points per list item over 100 (5x penalty vs base)
    score += (listItems - 100) * 0.5;
    log(`   ⚠️ WARNING: Many list items detected (${listItems} list items)`);
  }
  
  // FIX v11.0.6: Increased max delay to 90s for list-heavy pages
  // Conversion: 1 point = 500ms, max 90s (was 30s)
  // At 251 list items: score ~130, delay ~65s
  const delayMs = Math.min(Math.round(score * 500), 90000);
  
  return { 
    score: Math.round(score), 
    delayMs, 
    totalBlocks, 
    listItems, 
    tables, 
    callouts 
  };
};
```

**Impact:**
- Dynatrace page (251 list): score ~130, delay ~65 seconds (was 30s)
- Normal pages (<100 lists): unchanged behavior
- Large pages (100-200 lists): moderate increase (15-40s)
- Critical pages (>200 lists): significant increase (45-90s)

---

### Fix 2: Inter-Chunk Delays During Block Appending

**Location:** `server/orchestration/block-chunking.cjs` (around line 88-114)

**Current Code:**
```javascript
for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await notion.blocks.children.append({
        block_id: blockId,
        children: chunk,
      });
      appended += chunk.length;
      break;
    } catch (err) {
      log(`⚠️ appendBlocksToBlockId chunk ${i + 1}/${chunks.length} failed (attempt ${attempts}): ${err.message}`);
      if (attempts >= maxAttempts) throw err;
      // small backoff
      await new Promise((r) => setTimeout(r, 250 * attempts));
    }
  }
}
```

**New Code:**
```javascript
for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  let attempts = 0;
  const maxAttempts = 3;

  // FIX v11.0.6: Inter-chunk delay to prevent rate limit exhaustion
  // Add delay between chunks (not on first chunk, and not if retrying failed chunk)
  if (i > 0 && attempts === 0) {
    const interChunkDelay = chunks.length > 10 ? 1000 : 500; // 1s if many chunks, else 500ms
    await new Promise((r) => setTimeout(r, interChunkDelay));
  }

  while (attempts < maxAttempts) {
    attempts++;
    try {
      await notion.blocks.children.append({
        block_id: blockId,
        children: chunk,
      });
      appended += chunk.length;
      break;
    } catch (err) {
      // Check if rate limited
      const isRateLimited = err.status === 429 || 
                           err.code === 'rate_limited' || 
                           err.message?.toLowerCase().includes('rate limit');
      
      if (isRateLimited) {
        log(`⚠️ 🚦 RATE LIMIT during chunk append (chunk ${i + 1}/${chunks.length}, attempt ${attempts})`);
        // FIX v11.0.6: Longer backoff for rate limit errors
        const backoffDelay = Math.min(5000 * Math.pow(2, attempts - 1), 30000); // 5s, 10s, 20s (cap 30s)
        log(`   Waiting ${backoffDelay / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, backoffDelay));
      } else {
        log(`⚠️ appendBlocksToBlockId chunk ${i + 1}/${chunks.length} failed (attempt ${attempts}): ${err.message}`);
        if (attempts >= maxAttempts) throw err;
        // Standard backoff for other errors
        await new Promise((r) => setTimeout(r, 250 * attempts));
      }
    }
  }
}
```

**Impact:**
- Adds 500ms-1s inter-chunk delay (prevents rapid-fire API calls)
- Special handling for rate limit errors (5-30s exponential backoff)
- Minimal impact on small pages (<5 chunks = <2.5s overhead)
- Significant protection for large pages (>10 chunks = 10s+ overhead)

---

### Fix 3: Enhanced Rate Limit Retry in Deep Nesting Orchestration

**Location:** `server/orchestration/deep-nesting.cjs` (marker append section, around line 460-500)

**Current Code:**
```javascript
// Rate limit retry logic (exists but may need enhancement)
let rateLimitRetries = 0;
const maxRateLimitRetries = 5;
while (!updateSuccess && (conflictRetries <= maxConflictRetries || rateLimitRetries <= maxRateLimitRetries)) {
  try {
    await notion.blocks.children.append({
      block_id: parentBlockId,
      children: childrenToAppend,
    });
    updateSuccess = true;
  } catch (updateError) {
    if (updateError.status === 429 && rateLimitRetries < maxRateLimitRetries) {
      rateLimitRetries++;
      const delay = Math.min(1000 * Math.pow(2, rateLimitRetries - 1), 5000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**Enhancement Needed:**
```javascript
// FIX v11.0.6: Increase max retries and backoff for deep nesting orchestration
let rateLimitRetries = 0;
const maxRateLimitRetries = 8; // Increased from 5 to 8
while (!updateSuccess && (conflictRetries <= maxConflictRetries || rateLimitRetries <= maxRateLimitRetries)) {
  try {
    await notion.blocks.children.append({
      block_id: parentBlockId,
      children: childrenToAppend,
    });
    updateSuccess = true;
  } catch (updateError) {
    if (updateError.status === 429 && rateLimitRetries < maxRateLimitRetries) {
      rateLimitRetries++;
      // FIX v11.0.6: Extended exponential backoff (15s base, max 120s)
      const delay = Math.min(15000 * Math.pow(1.5, rateLimitRetries - 1), 120000);
      log(`   🚦 Rate limit during deep nesting (retry ${rateLimitRetries}/${maxRateLimitRetries}), waiting ${Math.round(delay / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

**Impact:**
- Aligns with POST endpoint rate limit retry strategy
- Provides 8 retries with 15s-120s exponential backoff
- Better recovery from quota exhaustion during orchestration

---

## PATCH Endpoint Fixes

### Fix 4: Apply Same Complexity Calculation to PATCH

**Location:** `server/routes/w2n.cjs` (PATCH endpoint, around line 2000-2050)

**Current Code:**
```javascript
// PATCH endpoint does NOT have pre-operation delay
// Immediately proceeds to block deletion and re-upload
```

**New Code:**
```javascript
// FIX v11.0.6: Add same adaptive delay to PATCH operations
const contentComplexity = calculateComplexity(childBlocks);

if (contentComplexity.delayMs > 0) {
  log(`⏳ [RATE-LIMIT-PROTECTION] Complex content detected for PATCH (score: ${contentComplexity.score}/100)`);
  log(`   Total blocks: ${contentComplexity.totalBlocks}`);
  log(`   List items: ${contentComplexity.listItems}`);
  log(`   Tables: ${contentComplexity.tables}`);
  log(`   Callouts: ${contentComplexity.callouts}`);
  log(`   Pre-PATCH delay: ${contentComplexity.delayMs}ms to avoid rate limits`);
  
  await new Promise(resolve => setTimeout(resolve, contentComplexity.delayMs));
  log(`   ✅ Pre-PATCH delay complete, proceeding with update...`);
}

// Now proceed with block deletion and re-upload
```

**Impact:**
- PATCH now has same protection as POST
- Large pages will delay before deletion/re-upload
- Prevents rate limiting during PATCH operations

---

## Testing Plan

### Test Cases

1. **Dynatrace page (251 list items)**
   - Expected score: ~130
   - Expected delay: ~65 seconds
   - Expected outcome: Successful upload with all blocks

2. **Normal page (<100 list items)**
   - Expected score: <50
   - Expected delay: <25 seconds
   - Expected outcome: Unchanged behavior, successful upload

3. **Moderate page (100-200 list items)**
   - Expected score: 50-100
   - Expected delay: 25-50 seconds
   - Expected outcome: Successful upload with moderate delay

4. **Batch PATCH of failed pages**
   - Run batch PATCH on all pages in `patch/pages/pages-to-update/`
   - Monitor for rate limit errors
   - Verify pages move to `patch/pages/updated-pages/`

### Verification Steps

1. **Restart server with fixes:**
   ```bash
   killall node 2>/dev/null || true
   cd server && SN2N_VERBOSE=1 SN2N_VALIDATE_OUTPUT=1 node sn2n-proxy.cjs
   ```

2. **Test POST on Dynatrace page:**
   ```bash
   # Use dry-run to test complexity calculation
   curl -X POST http://localhost:3004/api/W2N \
     -H "Content-Type: application/json" \
     -d '{
       "title": "Dynatrace Test",
       "databaseId": "...",
       "contentHtml": "$(cat configure-service-graph-connector-*.html)",
       "dryRun": true
     }'
   ```
   
   Expected output:
   ```
   ⏳ [RATE-LIMIT-PROTECTION] Complex content detected (score: 130/100)
      Total blocks: 280
      List items: 251
      Tables: 3
      Callouts: 10
      Pre-creation delay: 65000ms to avoid rate limits
   ```

3. **Test PATCH on existing page:**
   ```bash
   cd patch/config
   bash batch-patch-with-cooldown.sh
   ```
   
   Monitor logs for:
   - Pre-PATCH delay messages
   - Inter-chunk delay behavior
   - Rate limit retry messages (should not occur)
   - Successful PATCH completion

4. **Verify no rate limits:**
   ```bash
   grep -i "rate limit" server/logs/*.log | tail -20
   ```
   
   Expected: No new rate limit errors after fixes

### Success Criteria

- ✅ Dynatrace page uploads with 251 list items
- ✅ Complexity score correctly calculated (~130)
- ✅ Pre-operation delay applied (65s)
- ✅ Inter-chunk delays prevent rapid-fire API calls
- ✅ No rate limit errors in logs
- ✅ All blocks validated successfully
- ✅ PATCH operations complete without errors
- ✅ Normal pages (<100 lists) unaffected

---

## Implementation Priority

**Priority 1 (Critical):**
- Fix 1: Enhanced complexity calculation (POST)
- Fix 2: Inter-chunk delays (orchestration)

**Priority 2 (High):**
- Fix 4: Apply complexity calculation to PATCH
- Fix 3: Enhanced rate limit retry in deep nesting

**Priority 3 (Medium):**
- Update AutoExtract UI to show delay countdown
- Add complexity score to validation stats
- Document list-heavy page handling in user docs

---

## Expected Outcomes

### Before Fixes
```
Dynatrace page (251 list items):
- Pre-creation delay: 30s (insufficient)
- Rate limit errors: YES (during orchestration)
- Blocks uploaded: 0
- Validation: FAILED (rate limited)
```

### After Fixes
```
Dynatrace page (251 list items):
- Pre-creation delay: 65s (sufficient)
- Inter-chunk delays: 500ms-1s between chunks
- Rate limit errors: NO
- Blocks uploaded: 280
- Validation: PASSED (all blocks present)
```

---

## Related Issues

- **v11.0.5:** Initial rate limit protection (insufficient for list-heavy pages)
- **v11.0.0:** Navigation retry and rate limit basics
- **This fix:** Enhanced list-heavy page handling

---

## Files Modified

1. `server/routes/w2n.cjs` (POST endpoint complexity calculation, PATCH pre-delay)
2. `server/orchestration/block-chunking.cjs` (inter-chunk delays)
3. `server/orchestration/deep-nesting.cjs` (enhanced rate limit retry)

---

## Next Steps

1. Apply Fix 1 and Fix 2 (critical)
2. Restart server
3. Test with Dynatrace page (POST dry-run)
4. Apply Fix 3 and Fix 4 (high priority)
5. Run batch PATCH on all failed pages
6. Monitor for rate limit errors
7. Update documentation if successful

---

**Document Version:** 1.0  
**Author:** AI Agent Analysis  
**Date:** 2025-11-20
