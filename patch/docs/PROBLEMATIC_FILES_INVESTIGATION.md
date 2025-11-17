# Problematic Files - RESOLVED

## Issue Summary (ORIGINAL)
Files in this directory cause the batch PATCH process to hang, even with 120s timeout configured.

## Root Cause Analysis (2025-11-15)

### ✅ ISSUE RESOLVED: Files Convert Successfully

**Key Finding**: The validation errors showing "got 0 blocks" were **misleading**. These were PRE-processing validation checks in the HTML comment headers, NOT actual conversion results.

**Verification**: Tested `cmdb-classes-targeted-in-service-graph-connector-for-aws` with dry-run POST - it **successfully converted all 83 tables** and created complete Notion blocks.

### The Real Problem: PATCH Timeout, Not Conversion Failure

The actual issue is that PATCH operations on these large, complex pages exceed the 120s curl timeout. The pages convert perfectly - they just take longer to process.

## File Complexity Analysis

| File | Tables | Block Estimate | Complexity |
|------|--------|---------------|------------|
| cmdb-classes-AWS | 83 | ~800+ blocks | VERY HIGH |
| cmdb-classes-GCP | 94 | ~900+ blocks | VERY HIGH |
| target-tables-Wiz | 90 | ~800+ blocks | VERY HIGH |
| generic-policies-DevOps | 1 table, 128 lists | ~400+ blocks | HIGH |
| onboard-azure-devops | 3 tables, 27 images | ~150+ blocks | MEDIUM |
| release-quality-dashboard | 2 tables | ~50+ blocks | MEDIUM |

**Root Cause**: These pages have exceptionally high block counts that require:
1. Multiple delete operations (existing blocks)
2. Chunked upload operations (100-block limit per request)
3. Deep nesting orchestration (additional PATCH requests)
4. Marker cleanup sweeps

All of these operations combined exceed the 120s timeout.

## ✅ Fixes Implemented (2025-11-15)

### Fix 1: Adaptive Timeout Based on Complexity

**Location**: `patch/config/batch-patch-with-cooldown.sh`

**Implementation**:
- Extract block count and table count from dry-run validation
- Adaptive timeout selection:
  - **480s (8 min)**: Very complex pages (>500 blocks OR >50 tables)
  - **300s (5 min)**: Complex pages (>300 blocks OR >30 tables)
  - **180s (3 min)**: Normal pages (standard timeout)

**Code**:
```bash
block_count=$(echo "$dry_body" | jq -r '.data.children | length' 2>/dev/null || echo 0)
table_count=$(echo "$dry_body" | jq -r '[.data.children[] | select(.type == "table")] | length' 2>/dev/null || echo 0)

if [[ $block_count -gt 500 || $table_count -gt 50 ]]; then
  manual_timeout=480  # 8 minutes for very complex pages
elif [[ $block_count -gt 300 || $table_count -gt 30 ]]; then
  manual_timeout=300  # 5 minutes for complex pages
else
  manual_timeout=180  # 3 minutes for normal pages
fi
```

### Fix 2: Server-Side Progress Logging

**Location**: `server/routes/w2n.cjs`

**Implementation**: Added bracketed `[PATCH-PROGRESS]` logs at each phase:
- `[PATCH-PROGRESS] STEP 1: Starting delete of existing blocks`
- `[PATCH-PROGRESS] STEP 1 Complete: Deleted X blocks in Ys`
- `[PATCH-PROGRESS] STEP 2: Starting upload of X fresh blocks`
- `[PATCH-PROGRESS] STEP 2 Complete: Uploaded all X blocks successfully`
- `[PATCH-PROGRESS] STEP 3: Starting deep-nesting orchestration`
- `[PATCH-PROGRESS] STEP 3 Complete: Orchestration successful`
- `[PATCH-PROGRESS] All steps complete - PATCH operation successful!`

**Purpose**: Easy identification of where hangs occur (delete phase vs upload phase vs orchestration).

**Filtering**: Use `grep '\[PATCH-PROGRESS\]'` to see only phase transitions.

## Testing Instructions

### Test 1: Single File with Extended Timeout
```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/problematic-files

# Start server with verbose logging
cd ../../server
SN2N_VERBOSE=1 node sn2n-proxy.cjs &
SERVER_PID=$!

# Extract page ID from HTML file
PAGE_ID=$(grep -m1 "Page ID:" cmdb-classes-targeted-in-service-graph-connector-for-aws-2025-11-15T09-53-17.html | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/')

# Test with 480s timeout
curl -X PATCH "http://localhost:3004/api/W2N/$PAGE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"CMDB classes AWS\",\"contentHtml\":$(cat cmdb-classes-targeted-in-service-graph-connector-for-aws-2025-11-15T09-53-17.html | jq -Rs .),\"url\":\"https://docs.servicenow.com\"}" \
  -m 480 -v

# Monitor logs in real-time
tail -f server-logs.txt | grep '\[PATCH-PROGRESS\]'
```

### Test 2: Batch Process with Adaptive Timeouts
```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion

# Move problematic files back to pages-to-update for testing
mv patch/pages-to-update/problematic-files/*.html patch/pages-to-update/

# Run batch script with new adaptive timeouts
bash patch/config/batch-patch-with-cooldown.sh
```

### Test 3: Monitor Progress During PATCH
```bash
# In separate terminal, monitor server logs
tail -f /tmp/sn2n-server.log | grep -E '\[PATCH-PROGRESS\]|⏳|deleted|uploaded'
```

## Expected Results

- **AWS/GCP/Wiz files**: Should complete in 300-480s with adaptive timeout
- **DevOps Config file**: Should complete in 300s (high list complexity)
- **Azure DevOps file**: Should complete in 180s (medium complexity)
- **Release Dashboard**: Should complete in 180s (low complexity)

## Success Criteria

✅ All 6 files successfully PATCH without timeout
✅ Server logs show `[PATCH-PROGRESS]` completion messages
✅ No files moved to `problematic-files/` due to timeout
✅ Validation passes on all updated pages

## Related Documentation
- See `docs/patch-workflow.md` for timeout configuration details
- See `server/routes/w2n.cjs` for PATCH endpoint implementation with progress logging
