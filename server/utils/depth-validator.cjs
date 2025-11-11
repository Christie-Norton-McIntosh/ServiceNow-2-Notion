/**
 * Validate nesting depth and mark blocks that exceed Notion's 2-level limit
 * This ensures blocks at depth 3+ get orchestrated rather than rejected by Notion API
 * 
 * CRITICAL: We count from depth 1 (top-level blocks are depth 0)
 * - depth 0: Top-level blocks (OK)
 * - depth 1: Children of top-level (OK - first nesting level)
 * - depth 2: Children of depth 1 (OK - second nesting level, Notion's limit)
 * - depth 3+: TOO DEEP - must be marked for orchestration
 */
function markDeepNestedBlocks(blocks, depth = 0) {
  if (!Array.isArray(blocks)) return;
  
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !block.type) continue;
    
    const blockType = block.type;
    const blockContent = block[blockType];
    
    // If we're at depth 1 and this block has children, those children are at depth 2 (OK)
    // But if those depth-2 children have children, THOSE are at depth 3 (TOO DEEP!)
    // So we mark at depth 2: any children at depth 2 that have children need their children marked
    if (depth === 2 && blockContent && Array.isArray(blockContent.children) && blockContent.children.length > 0) {
      const marker = generateMarker(block._sn2n_element_id || null);
      console.log(`🏷️ [DEPTH-FIX] Block at depth ${depth} has ${blockContent.children.length} children at depth ${depth + 1} (TOO DEEP!)`);
      console.log(`🏷️ [DEPTH-FIX] Marking with marker "${marker}" for orchestration`);
      
      // Mark each child for collection
      for (const child of blockContent.children) {
        if (child && typeof child === 'object' && child.type) {
          child._sn2n_marker = marker;
          console.log(`🏷️ [DEPTH-FIX]   Marked ${child.type} block at depth ${depth + 1}`);
        }
      }
    }
    
    // Recurse into children (always check deeper levels)
    if (blockContent && Array.isArray(blockContent.children)) {
      markDeepNestedBlocks(blockContent.children, depth + 1);
    }
  }
}

// Helper to generate marker (inline version)
function generateMarker(elementId = null) {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  if (elementId && typeof elementId === 'string' && elementId.trim().length > 0) {
    const cleanId = elementId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${cleanId}__${timestamp}-${random}`;
  }
  return `${timestamp}-${random}`;
}

module.exports = { markDeepNestedBlocks };
