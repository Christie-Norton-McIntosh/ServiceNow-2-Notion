# PATCH Timeout Investigation

**Date**: November 12, 2025  
**Version**: 11.0.5  
**Issue**: 3 of 81 pages consistently timeout during PATCH operations (>120s)

## Problematic Files

| File | Size | Blocks | Lists | Tables | Images | HTML Tags |
|------|------|--------|-------|--------|--------|-----------|
| generic-policies-in-devops-config | 93K | 383 | 171 UL | 1 | 0 | 2,455 |
| reusable-itsm-virtual-agent-pre-built-topic-blocks | 47K | 106 | 18 UL, 4 OL | 9 | 4 | 946 |
| use-the-servicenow-devops-extension-for-azure-devops | 46K | 59 | 11 UL, 6 OL | 3 | 16 | 882 |

## Page IDs

- `generic-policies`: 2a8a89fe-dba5-8149-bb6b-f5cec836bdfa
- `reusable-itsm`: 2a8a89fe-dba5-816b-8372-eeab29500819
- `azure-devops`: 2a8a89fe-dba5-812d-864e-f7efad745dcf

## Key Findings

### 1. Dry-Run Performance (FAST ✅)

All 3 files complete dry-run validation successfully in <1 second:
- generic-policies: 0.27s
- reusable-itsm: 7.1s  
- azure-devops: 18.8s

**No markers detected** in dry-run (deep nesting won't trigger).

### 2. PATCH Operation Complexity (SLOW ❌)

The PATCH workflow involves **extensive API operations**:

#### Step 1: Delete All Existing Blocks
```javascript
// Fetch all blocks (paginated, 100 per page)
// For 383 blocks: ~4 fetch requests
do {
  await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
} while (hasMore);

// Delete each block individually
// For 383 blocks: 383 delete API calls
// Rate limit protection: 100ms delay every 10 deletes
// Estimated time: 3-5 seconds + rate limit retries
for (block of existingBlocks) {
  await notion.blocks.delete({ block_id: block.id });
  if (i % 10 === 0) await delay(100);
}
```

#### Step 2: Upload Fresh Content
```javascript
// Upload in chunks of 100
// For 383 blocks: 4 append requests
// Rate limit protection: 100ms delay between chunks
// Estimated time: 1-2 seconds + rate limit retries
for (chunk of chunks) {
  await notion.blocks.children.append({ block_id: pageId, children: chunk });
  await delay(100);
}
```

#### Step 3: Deep Nesting Orchestration
```javascript
// Only runs if markers were collected (none in our case)
// But still attempts orchestration check
if (markerMap.length > 0) {
  await orchestrateDeepNesting(pageId, markerMap);
}
```

#### Step 3.5: Marker Sweep
```javascript
// ALWAYS runs, even with no markers
// Recursively fetches and searches ALL blocks
// For 383 blocks: Multiple paginated API calls
// Estimated time: 2-5 seconds
await sweepAndRemoveMarkersFromPage(pageId);
```

#### Step 4: Post-Validation
```javascript
// Waits for Notion's eventual consistency
await delay(2000);  // 2-second mandatory delay

// Recursively fetches all blocks for validation
// For 383 blocks: 4+ API calls (paginated)
// Estimated time: 3-5 seconds
await validateNotionPage(notion, pageId, options);
```

### 3. Estimated Total Time

**Base case (no rate limits):**
- Fetch existing: 0.5s
- Delete 383 blocks: 4s
- Upload 4 chunks: 0.5s
- Marker sweep: 3s
- Validation delay: 2s
- Validation fetch: 2s
- **Total: ~12 seconds**

**With rate limiting (429 errors):**
- Each 429 triggers exponential backoff: 1s → 2s → 4s → 5s
- Multiple operations = multiple retry opportunities
- Accumulated delays can easily exceed 60-120 seconds

### 4. Why Timeouts Occur

1. **Notion API Rate Limiting**: The delete + append + sweep + validation sequence hits rate limits
2. **Exponential Backoff**: Each retry adds significant time (max 5s per retry)
3. **Cumulative Effect**: Multiple operations × multiple retries = timeout
4. **No Progress Indication**: Curl sees no data for 120s and times out
5. **Marker Sweep Overhead**: Runs on every PATCH, even when no markers exist

### 5. File-Specific Factors

**generic-policies (93K, 383 blocks):**
- Highest block count requiring 4 batch operations
- 171 nested lists add HTML complexity
- 2,455 HTML tags require extensive parsing
- **Primary issue**: Sheer volume of API calls

**reusable-itsm (47K, 106 blocks):**
- 9 tables with complex cell content
- Table processing includes:
  - Image extraction from cells
  - Nested content parsing
  - Whitespace normalization with markers
- **Primary issue**: Table processing complexity

**azure-devops (46K, 59 blocks):**
- 16 images requiring download + upload to Notion
- Each image:
  - Downloaded from ServiceNow
  - Uploaded to Notion file_uploads
  - Fallback to external URL if fails
- **Primary issue**: Image download/upload operations

## Why Dry-Run Succeeds

Dry-run bypasses ALL Notion API operations:
- ✅ No deletion
- ✅ No uploads
- ✅ No orchestration
- ✅ No marker sweep
- ✅ No validation
- ✅ Pure HTML → JSON transformation

Result: Completes in <1 second vs 120+ seconds for full PATCH.

## Solution Analysis

### Option 1: Increase Timeout (Quick Fix)
```bash
# In batch-patch-validated.sh
timeout_seconds=300  # 5 minutes instead of 130s
curl_timeout=240     # 4 minutes instead of 120s
```
**Pros:** Simple, no code changes  
**Cons:** Doesn't fix root cause, may still timeout on complex pages

### Option 2: Optimize Marker Sweep (Recommended)
```javascript
// In w2n.cjs PATCH endpoint
if (markerMap && Object.keys(markerMap).length > 0) {
  // Only run marker sweep if markers were collected
  await sweepAndRemoveMarkersFromPage(pageId);
} else {
  log(`✅ No markers collected, skipping marker sweep`);
}
```
**Pros:** Saves 2-5 seconds on every PATCH with no markers  
**Cons:** Won't help if markers exist

### Option 3: Make Post-Validation Optional for PATCH
```javascript
// In w2n.cjs PATCH endpoint
const shouldValidate = process.env.SN2N_VALIDATE_PATCH === '1';
if (shouldValidate) {
  await delay(2000);
  await validateNotionPage(notion, pageId, options);
}
```
**Pros:** Saves 4-7 seconds per PATCH  
**Cons:** Loses validation feedback

### Option 4: Batch Delete Operations (Complex)
Notion API doesn't support batch delete, but could:
- Delete blocks in parallel (with rate limit management)
- Skip fetching children for blocks we're deleting anyway
```javascript
// Parallel delete with concurrency limit
const deletionPromises = existingBlocks.map((block, i) => 
  rateLimitedDelete(block.id, i)
);
await Promise.all(deletionPromises);
```
**Pros:** Could reduce deletion time by 50-70%  
**Cons:** Complex rate limit management, risk of hitting limits faster

### Option 5: Progress Streaming (Advanced)
Stream progress updates to prevent curl timeout:
```javascript
// Send periodic progress updates
res.write(`data: {"status": "deleting", "progress": ${i}/${total}}\n\n`);
```
**Pros:** Keeps connection alive, provides real-time feedback  
**Cons:** Changes API contract, requires client-side handling

## Recommendations

### Immediate Actions (Low-Hanging Fruit)

1. **Conditional Marker Sweep** (Option 2)
   - Skip sweep when no markers collected
   - Easy win: 2-5 seconds saved per PATCH
   - Zero risk

2. **Increase Timeouts** (Option 1)
   - Batch script: 300s total, 240s curl
   - Handles edge cases without code changes

### Medium-Term Improvements

3. **Optional Post-Validation**
   - Add `SN2N_VALIDATE_PATCH` env var
   - Default to off for PATCH operations
   - Enable only for debugging

4. **Reduce Validation Delay**
   - Current: 2000ms delay
   - Reduce to 1000ms or make configurable
   - Notion consistency is usually <1s for simple operations

### Long-Term Optimizations

5. **Parallel Delete Operations**
   - Implement concurrent deletion with rate limit management
   - Could reduce deletion time by 50%+

6. **Smart Validation**
   - Skip recursive fetch if block count is known
   - Use pagination metadata instead of fetching all blocks

## Current Mitigation

**Quarantine Strategy:**
- Batch script automatically moves timeout files to `problematic-files/`
- 78 of 81 pages successfully migrated (96% success rate)
- 3 problematic files can be manually retried with increased timeout
- OR: Apply optimizations above and re-run

## Testing Next Steps

1. Implement conditional marker sweep
2. Test with one problematic file
3. Measure time savings
4. If still timeout, implement optional validation
5. Re-test and document results

---

**Status**: Investigation Complete  
**Next Action**: Implement Option 2 (Conditional Marker Sweep)  
**Owner**: Christie Norton-McIntosh  
**Priority**: Medium (96% already migrated)
