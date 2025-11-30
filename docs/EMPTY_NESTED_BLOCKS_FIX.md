# Fix: Empty Nested Blocks in PATCH Endpoint (v11.0.6)

**Date:** 2025-11-11  
**Issue:** 3 pages fail PATCH update with "block has no type property" errors  
**Affected Files:**
- add-a-new-change-request-type-2025-11-11T07-13-25.html
- define-risk-assessments-2025-11-11T07-26-14.html
- model-an-azure-pipeline-in-devops-2025-11-11T08-51-49.html

## 🔍 Root Cause

After marker collection (`collectAndStripMarkers`) and block removal (`removeCollectedBlocks`), some deeply-nested list items (3-4 levels) are left with **empty children arrays containing invalid objects**:

```javascript
// INVALID: Child block exists but has no type property
{
  numbered_list_item: {
    rich_text: [...],
    children: [
      {}, // ❌ Empty object - no type property
      { type: "paragraph", ... } // ✅ Valid block
    ]
  }
}
```

**Why this happens:**

1. **HTML extraction** creates blocks with markers for deferred orchestration
2. **Marker collection** marks blocks with `_sn2n_collected = true`
3. **Block removal** deletes collected blocks via `splice()`
4. **BUT**: If a child array becomes empty OR contains objects without `type`, Notion API rejects

**Example error:**
```
body.children[5].numbered_list_item.children[2].numbered_list_item.children[0]
  .<ALL_TYPES> should be defined, instead was undefined
```

This means `children[0]` is `{}` or an object with no `type` property.

## ✅ Solution

Add recursive validation to **strip invalid blocks** before uploading to Notion:

### 1. Validation Function

Add to `server/utils/notion-format.cjs`:

```javascript
/**
 * Recursively validate and clean block structure before Notion API upload
 * Removes:
 * - Blocks without a type property
 * - Empty objects in children arrays
 * - Children arrays that become empty after cleaning
 * 
 * @param {Object|Array} blocks - Block or array of blocks to validate
 * @returns {Object|Array} Cleaned block(s)
 */
function cleanInvalidBlocks(blocks) {
  // Handle array of blocks
  if (Array.isArray(blocks)) {
    return blocks
      .filter(block => {
        // Remove null, undefined, or non-objects
        if (!block || typeof block !== 'object') {
          console.log('🗑️ [BLOCK-CLEAN] Filtered: null/undefined/non-object');
          return false;
        }
        
        // Remove blocks without type property
        if (!block.type) {
          console.log('🗑️ [BLOCK-CLEAN] Filtered: block with no type property');
          return false;
        }
        
        return true;
      })
      .map(block => cleanInvalidBlocks(block)); // Recurse into each valid block
  }
  
  // Handle single block object
  if (blocks && typeof blocks === 'object' && blocks.type) {
    const blockType = blocks.type;
    const blockContent = blocks[blockType];
    
    // Clean typed children (e.g., paragraph.children, bulleted_list_item.children)
    if (blockContent && Array.isArray(blockContent.children)) {
      blockContent.children = cleanInvalidBlocks(blockContent.children);
      
      // Remove children property if array is now empty
      if (blockContent.children.length === 0) {
        delete blockContent.children;
        console.log(`🗑️ [BLOCK-CLEAN] Removed empty ${blockType}.children array`);
      }
    }
    
    // Clean generic .children property (legacy/fallback)
    if (Array.isArray(blocks.children)) {
      blocks.children = cleanInvalidBlocks(blocks.children);
      
      // Remove children property if array is now empty
      if (blocks.children.length === 0) {
        delete blocks.children;
        console.log('🗑️ [BLOCK-CLEAN] Removed empty .children array');
      }
    }
  }
  
  return blocks;
}
```

### 2. Apply in PATCH Endpoint

In `server/routes/w2n.cjs`, add validation **after marker collection** and **before upload**:

```javascript
// After line 1373 (after removeCollectedBlocks)
log(`🗑️ Removed ${removedCount} collected blocks from top-level (will be appended by orchestrator)`);

// ADD THIS:
// Validate and clean invalid blocks before upload
const beforeCleanCount = extractedBlocks.length;
extractedBlocks = cleanInvalidBlocks(extractedBlocks);
const afterCleanCount = extractedBlocks.length;

if (beforeCleanCount !== afterCleanCount) {
  log(`🧹 Block cleaning: ${beforeCleanCount} → ${afterCleanCount} blocks (removed ${beforeCleanCount - afterCleanCount} invalid)`);
}
```

### 3. Import Required Function

At top of `server/routes/w2n.cjs`:

```javascript
const { 
  cleanInvalidBlocks // ADD THIS
} = require('../utils/notion-format.cjs');
```

### 4. Export from notion-format.cjs

At bottom of `server/utils/notion-format.cjs`:

```javascript
module.exports = {
  // ...existing exports...
  cleanInvalidBlocks, // ADD THIS
};
```

## 🧪 Test Plan

1. **Apply fix** to both files
2. **Restart server**: `npm start`
3. **Retry failed pages**:
   ```bash
   cd server
   node test-patch-endpoint.cjs ../tests/fixtures/validation-failures/add-a-new-change-request-type-2025-11-11T07-13-25.html "2a8a89fedba581f8a6e7c37a7669be76"
   node test-patch-endpoint.cjs ../tests/fixtures/validation-failures/define-risk-assessments-2025-11-11T07-26-14.html "2a8a89fedba581d4a278d70b19dc5efa"
   node test-patch-endpoint.cjs ../tests/fixtures/validation-failures/model-an-azure-pipeline-in-devops-2025-11-11T08-51-49.html "2a8a89fedba581aa9f99ec53c6c0df5f"
   ```

4. **Verify**:
   - ✅ Pages update successfully (HTTP 200)
   - ✅ No validation errors
   - ✅ Content preserved correctly
   - ✅ Nested lists render properly

5. **Move to archive** if successful:
   ```bash
   cd tests/fixtures/validation-failures
   mv add-a-new-change-request-type-2025-11-11T07-13-25.html updated-successfully-2025-11-11/
   mv define-risk-assessments-2025-11-11T07-26-14.html updated-successfully-2025-11-11/
   mv model-an-azure-pipeline-in-devops-2025-11-11T08-51-49.html updated-successfully-2025-11-11/
   ```

## 📊 Expected Impact

- **Fixes:** All 3 failed pages (nested list issues)
- **Safety:** Non-destructive - only removes invalid blocks
- **Performance:** Minimal overhead (recursive filter/map)
- **Future-proof:** Catches any similar issues in POST endpoint

## 🔄 Follow-up Tasks

1. Consider adding same validation to **POST endpoint** (`/api/W2N`) for consistency
2. Update 5 remaining untested pages in validation-failures
3. Document block validation pattern in copilot-instructions.md

## 📝 Related Files

- `server/routes/w2n.cjs` (PATCH endpoint)
- `server/utils/notion-format.cjs` (validation function)
- `server/orchestration/marker-management.cjs` (marker collection)
- `tests/fixtures/BATCH_UPDATE_RESULTS_2025-11-11.md` (failure analysis)
