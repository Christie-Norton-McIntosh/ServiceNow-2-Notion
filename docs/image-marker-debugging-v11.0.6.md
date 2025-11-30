# Enhanced Image Marker Debugging (v11.0.6)

## Issue
For page "Add a document to a contract", child images are not being placed at marker locations. Markers are visible during extraction but are then removed without placing the child images.

## Root Cause Analysis

### Expected Flow:
1. Images are added to `listItemBlock.bulleted_list_item.children` with `_sn2n_marker`
2. `collectAndStripMarkers()` collects images into markerMap and marks them as `_sn2n_collected`
3. `removeCollectedBlocks()` removes collected images from initial payload
4. Page is created WITHOUT images (correct - avoids 4-level nesting)
5. `orchestrateDeepNesting()` finds parent list item by searching for marker token
6. Images are appended to parent list item via API

### Suspected Problem:
Step 5 fails - the orchestrator cannot find the marker in the created page, so images either:
- Get appended to page root as fallback, OR
- Are silently dropped

### Possible Causes:
1. **Marker token removed prematurely**: The marker `(sn2n:XXXXX)` might be getting stripped from the list item's rich_text before orchestration runs
2. **Marker not in searchable location**: The marker might be in a location the BFS search doesn't check
3. **Timing issue**: The page might not be fully propagated when BFS search runs
4. **Marker format mismatch**: The marker format in rich_text might not match what BFS is searching for

## Enhanced Debugging (v11.0.6)

Added comprehensive logging to track image orchestration:

### 1. Image Block Detection in Orchestrator
```javascript
const imageCount = blocksToAppend.filter(b => b && b.type === 'image').length;
if (imageCount > 0) {
  log(`🖼️ [IMAGE-DEBUG] Marker "${marker}" has ${imageCount} image block(s) out of ${blocksToAppend.length} total`);
}
```

### 2. Parent Found/Not Found Tracking
```javascript
if (!parentId) {
  log(`⚠️ Orchestrator: parent not found for marker sn2n:${marker}. Appending to page root instead.`);
  if (imageCount > 0) {
    log(`🖼️ [IMAGE-DEBUG] Parent not found! ${imageCount} image(s) will be appended to page root as fallback`);
  }
}
```

### 3. Image URL Logging
```javascript
else if (blockType === 'image') {
  const imgUrl = block[blockType].external?.url || block[blockType].file?.url || '[no URL]';
  contentPreview = `[image: ${imgUrl.substring(0, 80)}]`;
}
```

### 4. BFS Marker Search Logging
```javascript
log(`🔍 [MARKER-SEARCH] Starting BFS for marker: sn2n:${marker}`);
// ... search logic ...
log(`❌ [MARKER-SEARCH] Marker NOT FOUND after searching ${visited.size} blocks: sn2n:${marker}`);
log(`❌ [MARKER-SEARCH] Searched blocks: ${Array.from(visited).join(', ')}`);
```

## Debugging Steps

### 1. Enable Verbose Logging
```bash
SN2N_VERBOSE=1 npm start
```

### 2. Extract the Failing Page
Look for these log patterns in order:

**A. During Extraction** (server/services/servicenow.cjs):
```
🔍 [INLINE-IMAGE-ATTACH] Added marker (sn2n:XXXXX) for N deferred image(s)
🔍 [INLINE-IMAGE-ATTACH] Added N inline images to simple list item's children
```
→ Confirms images were marked and attached

**B. During Collection** (server/orchestration/marker-management.cjs):
```
🔖 collectAndStripMarkers: Found marker "XXXXX" at depth N, index M, type: image
🔖   Content preview: "[image: https://...]"
```
→ Confirms images were collected into markerMap

**C. During Orchestration** (server/orchestration/deep-nesting.cjs):
```
🖼️ [IMAGE-DEBUG] Marker "XXXXX" has N image block(s)
🔍 [MARKER-SEARCH] Starting BFS for marker: sn2n:XXXXX
```

Then either:
```
✅ Orchestrator: Found parent BLOCK_ID for marker sn2n:XXXXX
🖼️ [IMAGE-DEBUG] Parent found! Will append N image(s) to parent BLOCK_ID
  📦 Block 1: type=image, content="[image: https://...]"
✅ Orchestrator: appended N blocks for marker sn2n:XXXXX
```
OR:
```
❌ [MARKER-SEARCH] Marker NOT FOUND after searching X blocks: sn2n:XXXXX
❌ [MARKER-SEARCH] Searched blocks: [block-id-1, block-id-2, ...]
⚠️ Orchestrator: parent not found for marker sn2n:XXXXX. Appending to page root instead.
🖼️ [IMAGE-DEBUG] Parent not found! N image(s) will be appended to page root as fallback
```

### 3. Analyze the Logs

**If marker is NOT FOUND:**
- Check if marker token `(sn2n:XXXXX)` appears in any of the searched blocks
- Verify the list item was created in the initial payload
- Check if marker was stripped prematurely by sweeper or deduplication

**If marker IS FOUND but images still missing:**
- Check for errors during `appendBlocksToBlockId()`
- Verify images weren't filtered out by table dedupe logic
- Check post-orchestration deduplication logs

## Next Steps

1. **Run extraction with verbose logging** to capture full flow
2. **Share the logs** focusing on the sections above
3. **Check Notion page** to see if images ended up at page root vs list items

## Potential Fixes (to be applied after diagnosis)

### Fix 1: If marker is being stripped too early
Delay marker cleanup until AFTER orchestration completes for ALL markers

### Fix 2: If marker format doesn't match
Ensure consistent marker format between creation and search

### Fix 3: If BFS doesn't search deep enough
Extend search to check all possible locations (nested paragraphs, etc.)

### Fix 4: If timing issue
Add delay or retry logic to BFS search
