// server/orchestration/deep-nesting.cjs
// Handles deep nesting orchestration and marker-based content placement

const { appendBlocksToBlockId, deepStripPrivateKeys } = require('./block-chunking.cjs');
const { removeMarkerFromRichTextArray, sanitizeRichTextArray } = require('./marker-management.cjs');

// Helper to get global functions
function getGlobals() {
  return {
    notion: global.notion,
    log: global.log || console.log,
  };
}

/**
 * Clean marker tokens from blocks that are NOT in the marker map
 * This prevents duplicate content from orphaned markers
 * BUT preserves markers that still need to be found as parents
 * @param {Array} blocks - Array of blocks to clean
 * @param {Array} allMarkers - All markers that exist in the marker map (should NOT be cleaned)
 * @returns {Array} Cleaned blocks
 */
function cleanOrphanedMarkersFromBlocks(blocks, allMarkers = []) {
  if (!Array.isArray(blocks)) return blocks;
  
  // Convert to Set for faster lookup
  const markerSet = new Set(allMarkers);
  
  return blocks.map(block => {
    if (!block || typeof block !== 'object') return block;
    
    const blockType = block.type;
    if (!blockType || !block[blockType]) return block;
    
    const blockData = block[blockType];
    
    // Clean markers from rich_text if present
    if (Array.isArray(blockData.rich_text)) {
      const richText = blockData.rich_text;
      // Find all marker patterns (sn2n:XXXXX) in the text
      const fullText = richText.map(rt => rt?.text?.content || '').join('');
      const markerPattern = /\(sn2n:[a-z0-9-]+\)/gi;
      const matches = fullText.match(markerPattern);
      
      if (matches && matches.length > 0) {
        let cleanedRichText = richText;
        // Remove only markers that are NOT in the marker map
        matches.forEach(markerToken => {
          // Extract marker name from (sn2n:XXXXX) format
          const markerName = markerToken.slice(6, -1); // Remove (sn2n: and )
          
          // Only clean if this marker is NOT in the map (orphaned marker)
          if (!markerSet.has(markerName)) {
            cleanedRichText = removeMarkerFromRichTextArray(cleanedRichText, markerName);
          }
        });
        blockData.rich_text = sanitizeRichTextArray(cleanedRichText);
      }
    }
    
    // Recursively clean children if present
    if (Array.isArray(blockData.children)) {
      blockData.children = cleanOrphanedMarkersFromBlocks(blockData.children, allMarkers);
    }
    
    return block;
  });
}

/**
 * Find parent list item by marker in a page hierarchy
 * @param {string} rootBlockId - Root block ID to search in
 * @param {string} marker - Marker to find
 * @returns {Object|null} Parent info with parentId and paragraphId
 */
async function findParentListItemByMarker(rootBlockId, marker) {
  const { notion, log } = getGlobals();
  if (!notion) throw new Error("Notion client not initialized");
  const token = `sn2n:${marker}`;
  
  log(`🔍 BFS START: Searching for marker ${token} starting from ${rootBlockId}`);
  log(`🔍 BFS: Full marker value: "${marker}"`);
  log(`🔍 BFS: Token format: "(${token})"`);
  log(`🔍 [MARKER-SEARCH] Starting BFS for marker: sn2n:${marker}`);

  async function listChildren(blockId, cursor, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await notion.blocks.children.list({
          block_id: blockId,
          page_size: 100,
          start_cursor: cursor,
        });
        return res;
      } catch (error) {
        const isRetryable = error.message && (
          error.message.includes('socket hang up') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('timeout') ||
          error.message.includes('ETIMEDOUT')
        );
        
        if (isRetryable && attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff: 1s, 2s, 4s (max 5s)
          log(`⚠️ BFS: Retryable error on attempt ${attempt}/${retries} for block ${blockId}: ${error.message}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          log(`❌ BFS: Failed to fetch children for block ${blockId} after ${attempt} attempts: ${error.message}`);
          throw error; // Re-throw after all retries exhausted or non-retryable error
        }
      }
    }
  }

  const queue = [rootBlockId];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      log(`🔍 BFS: Examining ${children.length} children of ${current} (looking for ${token})`);
      for (const child of children) {
        try {
          if (
            child.type === "numbered_list_item" ||
            child.type === "bulleted_list_item" ||
            child.type === "callout"
          ) {
            // First, check the block's own rich_text for the token
            try {
              const ownPayload = child[child.type] || {};
              const ownRich = Array.isArray(ownPayload.rich_text)
                ? ownPayload.rich_text
                : [];
              const ownPlain = ownRich
                .map((rt) => rt?.text?.content || "")
                .join(" ");
              log(`🔍 BFS: Checking ${child.type} ${child.id}, text="${ownPlain.substring(0, 100)}"`);
              if (ownPlain.includes(token)) {
                log(`✅ BFS: FOUND marker ${token} in ${child.type} ${child.id}`);
                return { parentId: child.id, paragraphId: null };
              }
            } catch (e) {
              log(`⚠️ BFS: Error checking ${child.type} ${child.id}: ${e.message}`);
              // ignore and continue
            }

            if (child.has_children) {
              log(`🔍 BFS: ${child.type} ${child.id} has_children=true, searching its children...`);
              let cCursor = undefined;
              do {
                const childList = await notion.blocks.children.list({
                  block_id: child.id,
                  page_size: 100,
                  start_cursor: cCursor,
                });
                cCursor = childList.has_more
                  ? childList.next_cursor
                  : undefined;
                const subChildren = childList.results || [];
                log(`🔍 BFS: Found ${subChildren.length} children in ${child.type} ${child.id}`);
                for (const sc of subChildren) {
                  try {
                    const scPayload = sc[sc.type] || sc.paragraph || {};
                    const r = Array.isArray(scPayload.rich_text)
                      ? scPayload.rich_text
                      : [];
                    const plain = r
                      .map((rt) => rt?.text?.content || "")
                      .join(" ");
                    log(`🔍 BFS: Checking child ${sc.type} ${sc.id}, text="${plain.substring(0, 80)}"`);
                    if (plain.includes(token)) {
                      // If the child with the marker is itself a list item or callout, return the child's ID as parentId
                      // (we want to append TO the child, not to its parent)
                      if (sc.type === "numbered_list_item" || sc.type === "bulleted_list_item" || sc.type === "callout") {
                        return { parentId: sc.id, paragraphId: null };
                      }
                      
                      // Otherwise (e.g., paragraph child), return parent list-item id and matching child id
                      return { parentId: child.id, paragraphId: sc.id };
                    }
                  } catch (e) {
                    // continue on errors for individual children
                  }
                }
              } while (cCursor);
            }
          }

          if (child.has_children) queue.push(child.id);
        } catch (err) {
          log("⚠️ findParentListItemByMarker inner error:", err && err.message);
        }
      }
    } while (cursor);
  }

  log(`❌ [MARKER-SEARCH] Marker NOT FOUND after searching ${visited.size} blocks: sn2n:${marker}`);
  log(`❌ [MARKER-SEARCH] Searched blocks: ${Array.from(visited).join(', ')}`);
  return null;
}

/**
 * Orchestrate deep nesting by placing marked blocks in their correct locations
 * @param {string} pageId - Page ID to orchestrate
 * @param {Object} markerMap - Map of markers to blocks
 * @returns {Object} Result with total appended count
 */
async function orchestrateDeepNesting(pageId, markerMap) {
  const { notion, log } = getGlobals();
  if (!markerMap || Object.keys(markerMap).length === 0) return { appended: 0 };
  let totalAppended = 0;
  
  // CRITICAL: Sort marker keys by the GLOBAL collection index of their first block
  // This ensures markers are processed in DOM order, so sibling blocks appear in correct sequence
  const markerKeys = Object.keys(markerMap).sort((a, b) => {
    const blocksA = markerMap[a] || [];
    const blocksB = markerMap[b] || [];
    const indexA = blocksA[0]?._sn2n_global_collection_index ?? 999999;
    const indexB = blocksB[0]?._sn2n_global_collection_index ?? 999999;
    return indexA - indexB;
  });
  
  log(`🔧 Orchestrator: Starting with ${markerKeys.length} markers in map (sorted by global collection index):`);
  markerKeys.forEach(m => {
    const blocks = markerMap[m] || [];
    const firstBlockGlobalIndex = blocks[0]?._sn2n_global_collection_index;
    const firstBlockLocalIndex = blocks[0]?._sn2n_collection_order;
    log(`  🔖 Marker "${m}": ${blocks.length} block(s), global_index=${firstBlockGlobalIndex}, local_index=${firstBlockLocalIndex}`);
  });
  
    for (const marker of markerKeys) {
    let blocksToAppend = markerMap[marker] || [];
    if (blocksToAppend.length === 0) continue;
    
    // [IMAGE-DEBUG] Log if this marker has image blocks
    const imageCount = blocksToAppend.filter(b => b && b.type === 'image').length;
    if (imageCount > 0) {
      log(`🖼️ [IMAGE-DEBUG] Marker "${marker}" has ${imageCount} image block(s) out of ${blocksToAppend.length} total`);
    }
    
    try {
      const parentInfo = await findParentListItemByMarker(pageId, marker);
      const parentId = parentInfo ? parentInfo.parentId : null;
      const paragraphId = parentInfo ? parentInfo.paragraphId : null;
      
      if (!parentId) {
        log(
          `⚠️ Orchestrator: parent not found for marker sn2n:${marker}. Appending to page root instead.`
        );
        if (imageCount > 0) {
          log(`🖼️ [IMAGE-DEBUG] Parent not found! ${imageCount} image(s) will be appended to page root as fallback`);
        }
        // Clean orphaned markers (preserve all markers in the map) and ensure no private keys
        blocksToAppend = cleanOrphanedMarkersFromBlocks(blocksToAppend, markerKeys);
        deepStripPrivateKeys(blocksToAppend);
        await appendBlocksToBlockId(pageId, blocksToAppend);
        totalAppended += blocksToAppend.length;
        continue;
      }

      log(
        `✅ Orchestrator: Found parent ${parentId} for marker sn2n:${marker}. Will append ${blocksToAppend.length} block(s).`
      );
      
      if (imageCount > 0) {
        log(`🖼️ [IMAGE-DEBUG] Parent found! Will append ${imageCount} image(s) to parent ${parentId}`);
      }
      
      // Log marker details for debugging
      log(`🔖 Orchestrator: Marker details - marker="${marker}" (original format, may include element ID)`);
      
      // Log what content we're about to append for debugging
      blocksToAppend.forEach((block, idx) => {
        let contentPreview = '';
        try {
          const blockType = block.type;
          if (blockType && block[blockType]) {
            const richText = block[blockType].rich_text;
            if (Array.isArray(richText) && richText.length > 0) {
              contentPreview = richText.map(rt => rt?.text?.content || '').join('').substring(0, 100);
            } else if (blockType === 'table' && block[blockType].children) {
              contentPreview = `[table: ${block[blockType].table_width} cols x ${block[blockType].children.length} rows]`;
            } else if (blockType === 'image') {
              const imgUrl = block[blockType].external?.url || block[blockType].file?.url || '[no URL]';
              contentPreview = `[image: ${imgUrl.substring(0, 80)}]`;
            }
          }
        } catch (e) {
          contentPreview = '[unable to extract]';
        }
        log(`  📦 Block ${idx + 1}: type=${block.type}, content="${contentPreview}${contentPreview.length >= 100 ? '...' : ''}"`);
      });      // Before appending, perform an append-time dedupe check for table blocks
      // to avoid duplicating tables that may already exist under the parent.
      try {
        // helper: compute a lightweight signature for table blocks
        const computeTableSignature = (blk) => {
          try {
            if (!blk || blk.type !== 'table' || !blk.table) return null;
            const w = blk.table.table_width || 0;
            const rows = Array.isArray(blk.table.children)
              ? blk.table.children.length
              : 0;
            const normalizeCell = (txt) =>
              String(txt || '')
                .replace(/\(sn2n:[a-z0-9\-]+\)/gi, '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase()
                .substring(0, 200);

            let firstRow = '';
            if (Array.isArray(blk.table.children) && blk.table.children[0]) {
              const cells = blk.table.children[0].table_row?.cells || [];
              firstRow = cells
                .map((c) => {
                  if (Array.isArray(c)) {
                    return c
                      .map((rt) => normalizeCell(rt?.text?.content || ''))
                      .join('|');
                  }
                  return normalizeCell(c);
                })
                .join('|');
            }
            return `table:${w}x${rows}:${firstRow}`;
          } catch (e) {
            return null;
          }
        };

        // If there are table blocks to append, fetch existing children of the parent
        // and compute existing table signatures to filter out duplicates.
        const tablesToAppend = blocksToAppend.filter((b) => b && b.type === 'table');
        if (tablesToAppend.length > 0) {
          const existingSignatures = new Set();
          // list children of parent (may be page or block)
          let cursor = undefined;
          do {
            const listing = await notion.blocks.children.list({
              block_id: parentId,
              page_size: 100,
              start_cursor: cursor,
            });
            cursor = listing.has_more ? listing.next_cursor : undefined;
            const results = listing.results || [];
            for (const r of results) {
              try {
                if (r.type === 'table') {
                  const sig = computeTableSignature(r);
                  if (sig) existingSignatures.add(sig);
                }
              } catch (e) {
                // ignore individual child errors
              }
            }
          } while (cursor);

          // Filter out any blocksToAppend whose table signature already exists
          const beforeCount = blocksToAppend.length;
          blocksToAppend = blocksToAppend.filter((b) => {
            if (!b || b.type !== 'table') return true;
            const sig = computeTableSignature(b);
            if (!sig) return true;
            if (existingSignatures.has(sig)) {
              log(`🔎 Orchestrator dedupe: skipping append of duplicate table (${sig}) for marker sn2n:${marker}`);
              return false;
            }
            return true;
          });
          const removed = beforeCount - blocksToAppend.length;
          if (removed > 0) {
            log(`🔧 Orchestrator dedupe: removed ${removed} duplicate block(s) before append for marker sn2n:${marker}`);
          }
        }
      } catch (e) {
        log('⚠️ Orchestrator dedupe check failed:', e && e.message);
        // fall through to normal append behavior
      }

      // Clean orphaned marker tokens (preserve ALL markers in the map)
      // This prevents duplicates from markers that aren't parents themselves
      // but KEEPS markers that need to be found later as parents
      // Example: If appending callout with "(sn2n:XYZ)" where XYZ is also in markerMap,
      //          keep XYZ so it can be found as a parent later
      log(`🧹 Orchestrator: cleaning orphaned markers from ${blocksToAppend.length} block(s) before append (preserving ${markerKeys.length} map markers)`);
      blocksToAppend = cleanOrphanedMarkersFromBlocks(blocksToAppend, markerKeys);

      // CRITICAL: Sort blocks by _sn2n_dom_order to preserve original DOM sequence
      // This ensures "Tool ID" related paragraphs appear in the correct order
      try {
        // First, log what we received FROM the marker map
        log(`🔢 [ORDER-DEBUG] Received ${blocksToAppend.length} blocks from markerMap[${marker}]`);
        blocksToAppend.forEach((blk, idx) => {
          const order = blk._sn2n_dom_order;
          const collectionOrder = blk._sn2n_collection_order;
          const allKeys = Object.keys(blk).filter(k => k.startsWith('_sn2n_'));
          const preview = (() => {
            try {
              const rt = blk[blk.type]?.rich_text;
              if (Array.isArray(rt)) return rt.map(r => r.text?.content || '').join('').substring(0, 60);
            } catch (e) { /* ignore */ }
            return '[no preview]';
          })();
          log(`🔢 [ORDER-DEBUG]   Block ${idx} BEFORE sort: dom_order=${order}, collection_order=${collectionOrder}, _sn2n_ keys=[${allKeys.join(', ')}], type=${blk.type}, preview="${preview}"`);
        });
        
        blocksToAppend.sort((a, b) => {
          const orderA = a._sn2n_dom_order ?? 999999;
          const orderB = b._sn2n_dom_order ?? 999999;
          return orderA - orderB;
        });
        log(`🔢 [ORDER-DEBUG] Sorted ${blocksToAppend.length} blocks by _sn2n_dom_order`);
        blocksToAppend.forEach((blk, idx) => {
          const order = blk._sn2n_dom_order;
          const preview = (() => {
            try {
              const rt = blk[blk.type]?.rich_text;
              if (Array.isArray(rt)) return rt.map(r => r.text?.content || '').join('').substring(0, 60);
            } catch (e) { /* ignore */ }
            return '[no preview]';
          })();
          log(`🔢 [ORDER-DEBUG]   Block ${idx} AFTER sort: order=${order}, type=${blk.type}, preview="${preview}"`);
        });
      } catch (e) {
        log(`⚠️ [ORDER-DEBUG] Error sorting blocks by DOM order: ${e.message}`);
      }

      // Ensure no private helper keys are present before appending under parent
      deepStripPrivateKeys(blocksToAppend);
      const result = await appendBlocksToBlockId(parentId, blocksToAppend);
      totalAppended += result.appended || 0;
      log(
        `✅ Orchestrator: appended ${
          result.appended || 0
        } blocks for marker sn2n:${marker}`
      );
      
      // Attempt to clean up the inline marker from the paragraph we used to locate the parent
      if (paragraphId) {
        try {
          const retrieved = await notion.blocks.retrieve({
            block_id: paragraphId,
          });
          const existingRt = retrieved.paragraph?.rich_text || [];
          const newRt = removeMarkerFromRichTextArray(existingRt, marker);
          const joinedOld = existingRt
            .map((r) => r.text?.content || "")
            .join(" ");
          const joinedNew = newRt.map((r) => r.text?.content || "").join(" ");
          if (joinedOld !== joinedNew) {
            const safeNewRt = sanitizeRichTextArray(newRt);
            await notion.blocks.update({
              block_id: paragraphId,
              paragraph: { rich_text: safeNewRt },
            });
            log(
              `✅ Orchestrator: removed marker from paragraph ${paragraphId}`
            );
          }
        } catch (e) {
          log(
            "⚠️ Orchestrator: failed to remove marker from paragraph:",
            e && e.message
          );
        }
      }

      // If the marker was found on the block's own rich_text (paragraphId === null),
      // attempt to retrieve and update the block to remove the inline marker.
      // This handles list-items, callouts, and other block types with rich_text.
      if (!paragraphId) {
        let retries = 3;
        let delay = 1000;
        let success = false;
        
        while (retries > 0 && !success) {
          try {
            const block = await notion.blocks.retrieve({ block_id: parentId });
            const blockType = block.type;
            const payload = block[blockType] || {};
            const existingRt = Array.isArray(payload.rich_text)
              ? payload.rich_text
              : [];
            const newRt = removeMarkerFromRichTextArray(existingRt, marker);
            const joinedOld = existingRt
              .map((r) => r.text?.content || "")
              .join(" ");
            const joinedNew = newRt.map((r) => r.text?.content || "").join(" ");
            if (joinedOld !== joinedNew) {
              const safeNewRt = sanitizeRichTextArray(newRt);
              await notion.blocks.update({
                block_id: parentId,
                [blockType]: { rich_text: safeNewRt },
              });
              log(`✅ Orchestrator: removed marker from ${blockType} ${parentId}`);
              success = true;
            } else {
              success = true; // No change needed
            }
          } catch (e) {
            retries--;
            if (retries > 0) {
              log(`⚠️ Orchestrator: marker removal failed (${retries} retries left), waiting ${delay}ms: ${e && e.message}`);
              await new Promise(resolve => setTimeout(resolve, delay));
              delay *= 2; // Exponential backoff
            } else {
              log(
                "⚠️ Orchestrator: failed to remove marker from block after all retries:",
                e && e.message
              );
            }
          }
        }
      }
    } catch (err) {
      const errorMsg = err && err.message;
      log(
        `❌ Orchestrator error for marker sn2n:${marker}:`,
        errorMsg
      );
      
      // Check if this is an archived block error
      if (errorMsg && (errorMsg.includes("archived") || errorMsg.includes("archive"))) {
        log("⚠️ ARCHIVED BLOCK DETECTED - The page was archived during processing.");
        log("⚠️ Please unarchive the page in Notion and run the tool again.");
        log("⚠️ Skipping further orchestration attempts for this marker.");
        // Don't try fallback append - it will also fail
        continue;
      }
      
      // For other errors, try fallback append to page root
      try {
        await appendBlocksToBlockId(pageId, blocksToAppend);
      } catch (e) {
        log("❌ Orchestrator fallback append failed:", e && e.message);
      }
    }
    
    // Add a small delay between orchestration rounds to allow Notion API to propagate changes
    // This helps ensure newly-appended blocks (like callouts) are visible in the next BFS search
    if (Object.keys(markerMap).indexOf(marker) < Object.keys(markerMap).length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // After orchestrating individual markers, run a final sweep to remove any residual marker tokens
  try {
    const sweep = await sweepAndRemoveMarkersFromPage(pageId);
    if (sweep && sweep.updated) {
      log(
        `🔍 Sweeper finished: updated ${sweep.updated} blocks to remove residual markers`
      );
    }
  } catch (e) {
    log("⚠️ Orchestrator: sweeper failed:", e && e.message);
  }

  return { appended: totalAppended };
}

/**
 * Sweep the page children and remove any remaining (sn2n:...) markers from rich_text
 * This is append-only safe: it only updates blocks to remove visible marker tokens.
 * @param {string} rootPageId - Root page ID to sweep
 * @returns {Object} Result with updated count
 */
async function sweepAndRemoveMarkersFromPage(rootPageId) {
  const { notion, log } = getGlobals();
  if (!notion) throw new Error("Notion client not initialized");
  const tokenPrefix = "(sn2n:";

  async function listChildren(blockId, cursor) {
    return await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
  }

  const queue = [rootPageId];
  const visited = new Set();
  let updated = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      for (const child of children) {
        try {
          // Check for rich_text on the block's typed payload
          const t = child.type;
          // Support multiple block types that have rich_text
          const payload = child[t] || child.paragraph || child.callout || child.to_do || child.toggle || {};
          const rich = Array.isArray(payload.rich_text)
            ? payload.rich_text
            : [];
          const plain = rich.map((r) => r?.text?.content || "").join("");
          if (plain.includes("sn2n:") || plain.includes(tokenPrefix)) {
            // Attempt to remove any marker occurrence(s)
            // We'll try to remove all tokens found for any marker-like substring
            // Find all markers in the plain text matching sn2n:xxxx
            const markerRegex = /\(sn2n:[^)]+\)/g;
            const matches = plain.match(markerRegex) || [];
            let newRich = rich;
            for (const m of matches) {
              // remove each marker using existing helper
              const markerName =
                (m || "").replace(/^\(|\)$/g, "").split(":")[1] || null;
              if (markerName) {
                newRich = removeMarkerFromRichTextArray(newRich, markerName);
              } else {
                // fallback: remove literal m from concatenated content by a general pass
                newRich = newRich.map((rt) => {
                  if (!rt || !rt.text || typeof rt.text.content !== "string")
                    return rt;
                  const cleaned = rt.text.content.replace(m, "");
                  return { ...rt, text: { ...rt.text, content: cleaned } };
                });
              }
            }

            const joinedOld = rich.map((r) => r.text?.content || "").join(" ");
            const joinedNew = newRich
              .map((r) => r.text?.content || "")
              .join(" ");
            if (joinedOld !== joinedNew) {
              // Use newRich directly (it's produced by removeMarkerFromRichTextArray or a simple map)
              const safeNewRt = Array.isArray(newRich) ? newRich : [];
              const updateBody = {};
              updateBody[child.type] = { rich_text: safeNewRt };
              try {
                await notion.blocks.update({
                  block_id: child.id,
                  [child.type]: { rich_text: safeNewRt },
                });
                updated++;
                log(`🔧 Sweeper: removed marker(s) from block ${child.id}`);
              } catch (e) {
                log(
                  `⚠️ Sweeper: failed to update block ${child.id}:`,
                  e && e.message
                );
              }
            }
          }

          if (child.has_children) queue.push(child.id);
        } catch (e) {
          log("⚠️ Sweeper inner error:", e && e.message);
        }
      }
    } while (cursor);
  }

  return { updated };
}

module.exports = {
  findParentListItemByMarker,
  orchestrateDeepNesting,
  sweepAndRemoveMarkersFromPage,
};