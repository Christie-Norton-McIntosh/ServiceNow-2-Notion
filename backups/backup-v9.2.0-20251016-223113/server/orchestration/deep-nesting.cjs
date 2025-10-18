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
 * Find parent list item by marker in a page hierarchy
 * @param {string} rootBlockId - Root block ID to search in
 * @param {string} marker - Marker to find
 * @returns {Object|null} Parent info with parentId and paragraphId
 */
async function findParentListItemByMarker(rootBlockId, marker) {
  const { notion, log } = getGlobals();
  if (!notion) throw new Error("Notion client not initialized");
  const token = `sn2n:${marker}`;

  async function listChildren(blockId, cursor) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });
    return res;
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
      for (const child of children) {
        try {
          if (
            child.type === "numbered_list_item" ||
            child.type === "bulleted_list_item"
          ) {
            // First, check the list-item's own rich_text for the token
            try {
              const ownPayload = child[child.type] || {};
              const ownRich = Array.isArray(ownPayload.rich_text)
                ? ownPayload.rich_text
                : [];
              const ownPlain = ownRich
                .map((rt) => rt?.text?.content || "")
                .join(" ");
              if (ownPlain.includes(token)) {
                return { parentId: child.id, paragraphId: null };
              }
            } catch (e) {
              // ignore and continue
            }

            if (child.has_children) {
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
                for (const sc of subChildren) {
                  try {
                    const scPayload = sc[sc.type] || sc.paragraph || {};
                    const r = Array.isArray(scPayload.rich_text)
                      ? scPayload.rich_text
                      : [];
                    const plain = r
                      .map((rt) => rt?.text?.content || "")
                      .join(" ");
                    if (plain.includes(token)) {
                      // return both the parent list-item id and the matching child id
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
  
  for (const marker of Object.keys(markerMap)) {
    let blocksToAppend = markerMap[marker] || [];
    if (blocksToAppend.length === 0) continue;
    
    try {
      log(`🔄 Orchestrator: locating parent for marker sn2n:${marker}`);
      const parentInfo = await findParentListItemByMarker(pageId, marker);
      const parentId = parentInfo ? parentInfo.parentId : null;
      const paragraphId = parentInfo ? parentInfo.paragraphId : null;
      
      if (!parentId) {
        log(
          `⚠️ Orchestrator: parent not found for marker sn2n:${marker}. Appending to page root instead.`
        );
        // Ensure no private keys on blocks before appending to page root
        deepStripPrivateKeys(blocksToAppend);
        await appendBlocksToBlockId(pageId, blocksToAppend);
        totalAppended += blocksToAppend.length;
        continue;
      }

      log(
        `🔄 Orchestrator: appending ${blocksToAppend.length} block(s) to parent ${parentId} for marker sn2n:${marker}`
      );
      
      // Before appending, perform an append-time dedupe check for table blocks
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

      // If the marker was found on the list-item's own rich_text (paragraphId === null),
      // attempt to retrieve and update the list-item block to remove the inline marker.
      if (!paragraphId) {
        try {
          const listItem = await notion.blocks.retrieve({ block_id: parentId });
          const payload = listItem[listItem.type] || {};
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
              [listItem.type]: { rich_text: safeNewRt },
            });
            log(`✅ Orchestrator: removed marker from list-item ${parentId}`);
          }
        } catch (e) {
          log(
            "⚠️ Orchestrator: failed to remove marker from list-item:",
            e && e.message
          );
        }
      }
    } catch (err) {
      log(
        `❌ Orchestrator error for marker sn2n:${marker}:`,
        err && err.message
      );
      try {
        await appendBlocksToBlockId(pageId, blocksToAppend);
      } catch (e) {
        log("❌ Orchestrator fallback append failed:", e && e.message);
      }
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
          const payload = child[t] || child.paragraph || {};
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