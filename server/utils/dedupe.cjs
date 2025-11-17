/**
 * Dedupe utilities for Notion block conversion
 * Exports computeBlockKey(blk) and dedupeAndFilterBlocks(blockArray, options)
 */

function plainTextFromRich(richArr) {
  if (!Array.isArray(richArr)) return "";
  return richArr.map((rt) => rt.text?.content || "").join("").replace(/\s+/g, " ").trim();
}

function computeBlockKey(blk) {
  if (!blk || typeof blk !== "object") return JSON.stringify(blk);
  try {
    if (blk.type === "callout" && blk.callout) {
      const txt = plainTextFromRich(blk.callout.rich_text || []);
      // Strip marker tokens for deduplication (same callout may have different markers)
      const normalizedTxt = txt.replace(/\(sn2n:[a-z0-9\-]+\)/gi, "").replace(/\s+/g, " ").trim();
      const emoji = blk.callout.icon?.type === "emoji" ? blk.callout.icon.emoji : "";
      const color = blk.callout.color || "";
      return `callout:${normalizedTxt}|${emoji}|${color}`;
    }
    if (blk.type === "image" && blk.image) {
      const fileId = blk.image.file_upload && blk.image.file_upload.id;
      const externalUrl = blk.image.external && blk.image.external.url;
      const key = fileId ? `image:file:${String(fileId)}` : `image:external:${String(externalUrl || '')}`;
      return key;
    }
    if (blk.type === "table" && blk.table) {
      const w = blk.table.table_width || 0;
      const rows = Array.isArray(blk.table.children) ? blk.table.children.length : 0;
      const normalizeCellText = (txt) =>
        String(txt || "")
          .replace(/\(sn2n:[a-z0-9\-]+\)/gi, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase()
          .substring(0, 200);
      let rowSamples = [];
      if (Array.isArray(blk.table.children)) {
        // Sample MORE rows to better distinguish tables (up to 5 rows instead of 3)
        // This helps prevent false positives when tables have similar headers
        for (let i = 0; i < Math.min(5, blk.table.children.length); i++) {
          const cells = blk.table.children[i]?.table_row?.cells || [];
          const rowText = cells
            .map((c) => {
              if (Array.isArray(c)) {
                return c.map((rt) => normalizeCellText(rt?.text?.content || "")).join("|");
              }
              return normalizeCellText(c);
            })
            .join("|");
          rowSamples.push(rowText);
        }
      }
      // Include row count in key to distinguish tables with different sizes
      // (e.g., 20-row table vs 1-row table should never be considered duplicates)
      return `table:${w}x${rows}:${rowSamples.join("||")}`;
    }
    if (blk.type === "numbered_list_item" || blk.type === "bulleted_list_item") {
      const txt = plainTextFromRich(blk[blk.type]?.rich_text || []);
      return `${blk.type}:${txt.substring(0, 200)}`;
    }
    if (blk.type === "paragraph") {
      const txt = plainTextFromRich(blk.paragraph?.rich_text || []);
      return `paragraph:${txt.substring(0, 200)}`;
    }
    if (blk.type === "code") {
      const codeTxt = blk.code?.rich_text?.map((r) => r.text?.content || "").join("") || "";
      const lang = blk.code?.language || "";
      return `code:${lang}:${codeTxt.substring(0, 200)}`;
    }
    return JSON.stringify(blk);
  } catch (e) {
    return JSON.stringify(blk);
  }
}

function dedupeAndFilterBlocks(blockArray, options = {}) {
  const { log = () => {} } = options;
  if (!Array.isArray(blockArray)) return blockArray;
  
  // Use a sliding window approach: only dedupe if identical blocks appear within N positions
  // This allows common phrases like "Submit the form." to appear in different sections
  const PROXIMITY_WINDOW = 5; // Only dedupe if duplicates are within 5 blocks of each other
  const recentBlocks = []; // Stores [key, index] pairs for the last N blocks
  const out = [];
  let removed = 0;
  let duplicates = 0;

  for (let i = 0; i < blockArray.length; i++) {
    const blk = blockArray[i];
    try {
      // Never dedupe dividers - they're always unique by position
      if (blk && blk.type === 'divider') {
        out.push(blk);
        continue;
      }
      
      // Never dedupe list items - they can legitimately appear multiple times
      // in different lists or procedures (e.g., "Open a software model record.")
      if (blk && (blk.type === 'numbered_list_item' || blk.type === 'bulleted_list_item')) {
        out.push(blk);
        continue;
      }
      
      // Never dedupe common section headings/labels that appear in multiple places
      // (e.g., "Procedure", "About this task", "Before you begin")
      if (blk && blk.type === 'paragraph') {
        const txt = plainTextFromRich(blk.paragraph?.rich_text || []);
        const isCommonHeading = /^(Procedure|About this task|Steps|Requirements?|Overview|Submit the form\.?)$/i.test(txt.trim());
        if (isCommonHeading) {
          out.push(blk);
          continue;
        }
      }
      
      // Never dedupe callouts with common STANDALONE patterns (title-only without content)
      // Also exempt "Note:" and "Before you begin" callouts from proximity-based deduplication
      // NOTE: Even exempted callouts should be checked for ADJACENT duplicates
      if (blk && blk.type === 'callout') {
        const txt = plainTextFromRich(blk.callout?.rich_text || []);
        const trimmed = txt.trim();
        // Exempt if it's JUST the title pattern with no content, OR if it starts with "Note:" or "Before you begin"
        // This prevents legitimate repeated warnings/prereqs in different sections from being deduped
        const isTitleOnly = /^(Before you begin|Role required:|Prerequisites?|Note:|Important:|Warning:)\s*$/i.test(trimmed);
        const isNoteCallout = /^Note:/i.test(trimmed);
        const isBeforeYouBeginCallout = /^Before you begin/i.test(trimmed);
        if (isTitleOnly || isNoteCallout || isBeforeYouBeginCallout) {
          const calloutType = isTitleOnly ? 'Title-only' : (isNoteCallout ? 'Note:' : 'Before you begin');
          log(`✓ ${calloutType} callout, checking for adjacent duplicates: "${trimmed.substring(0, 60)}..."`);
          // Still check for adjacent duplicates even for exempted callouts
          const key = computeBlockKey(blk);
          const adjacentDuplicate = recentBlocks.find(entry => {
            const [entryKey, entryIndex] = entry;
            const distance = i - entryIndex;
            return entryKey === key && distance <= 1;
          });
          
          if (adjacentDuplicate) {
            log(`🚫 Deduping adjacent ${calloutType} callout at index ${i}: "${trimmed.substring(0, 60)}..." (duplicate of block ${adjacentDuplicate[1]})`);
            removed++;
            duplicates++;
            continue;
          }
          
          // Not a duplicate, add to recent blocks and output
          recentBlocks.push([key, i]);
          while (recentBlocks.length > 0 && (i - recentBlocks[0][1]) > PROXIMITY_WINDOW) {
            recentBlocks.shift();
          }
          out.push(blk);
          continue;
        }
        // For other callouts with content, use normal proximity-based deduplication
        log(`→ Callout with content will be deduped: "${trimmed.substring(0, 60)}..."`);
      }
      
      // Special-case image dedupe by uploaded file id ONLY - use global dedupe for images
      if (blk && blk.type === 'image' && blk.image) {
        const fileId = blk.image.file_upload && blk.image.file_upload.id;
        if (fileId) {
          const imageKey = `image:file:${String(fileId)}`;
          // Check if this image was seen recently (in the whole document for images)
          const foundInRecent = recentBlocks.find(entry => entry[0] === imageKey);
          if (foundInRecent) {
            log(`🚫 Deduping image: already seen at index ${foundInRecent[1]}`);
            removed++;
            duplicates++;
            continue;
          }
          recentBlocks.push([imageKey, i]);
        }
        // For external images without a file_upload id, do not dedupe here — keep both
        out.push(blk);
        continue;
      }

      // Special-case table dedupe: check for immediately adjacent identical tables (within proximity window)
      // Tables can legitimately appear multiple times in different sections, so only dedupe if very close
      if (blk && blk.type === 'table' && blk.table) {
        const tableKey = computeBlockKey(blk);
        
        // Check if an identical table appears within the proximity window
        const foundInWindow = recentBlocks.find(entry => {
          const [entryKey, entryIndex] = entry;
          return entryKey === tableKey && (i - entryIndex) <= PROXIMITY_WINDOW;
        });
        
        if (foundInWindow) {
          const distance = i - foundInWindow[1];
          const preview = (() => {
            try {
              const firstRow = blk.table.children?.[0]?.table_row?.cells?.[0] || [];
              if (Array.isArray(firstRow)) {
                return firstRow.map(rt => rt?.text?.content || '').join('').substring(0, 40);
              }
              return '[no preview]';
            } catch (e) {
              return '[error]';
            }
          })();
          log(`🚫 Deduping table at index ${i}: duplicate of table at ${foundInWindow[1]} (distance: ${distance}, preview: "${preview}")`);
          removed++;
          duplicates++;
          continue;
        }
        
        // Not a duplicate, add to recent blocks
        recentBlocks.push([tableKey, i]);
        
        // Keep window size manageable for tables too
        while (recentBlocks.length > 0 && (i - recentBlocks[0][1]) > PROXIMITY_WINDOW) {
          recentBlocks.shift();
        }
        
        out.push(blk);
        continue;
      }

      const key = computeBlockKey(blk);
      
      // Special handling for callouts: stricter deduplication for immediately adjacent duplicates
      // Use different proximity windows based on block type and adjacency
      let effectiveWindow = PROXIMITY_WINDOW;
      
      // For callouts (Note, Important, Warning, etc.), check for immediately adjacent duplicates (within 1 position)
      // This catches duplicate callouts that appear right next to each other due to processing paths
      if (blk && blk.type === 'callout') {
        const calloutText = plainTextFromRich(blk.callout?.rich_text || []).substring(0, 60);
        const calloutType = blk.callout?.icon?.emoji || 'unknown';
        
        log(`🔍 [CALLOUT-DEDUPE-CHECK] Checking callout ${i}: "${calloutText}..." key="${key}"`);
        log(`🔍 [CALLOUT-DEDUPE-CHECK] Recent blocks: ${recentBlocks.map(e => `[${e[1]}: ${e[0].substring(0, 40)}]`).join(', ')}`);
        
        const adjacentDuplicate = recentBlocks.find(entry => {
          const [entryKey, entryIndex] = entry;
          const distance = i - entryIndex;
          return entryKey === key && distance <= 1; // Immediately adjacent (current or previous position)
        });
        
        if (adjacentDuplicate) {
          const distance = i - adjacentDuplicate[1];
          log(`🚫 Deduping adjacent ${calloutType} callout at index ${i}: "${calloutText}..." (duplicate of block ${adjacentDuplicate[1]}, distance: ${distance})`);
          removed++;
          duplicates++;
          continue;
        }
        log(`✓ [CALLOUT-DEDUPE-CHECK] Not a duplicate, adding to output`);
        // If not immediately adjacent, use normal window for callouts with content
        effectiveWindow = PROXIMITY_WINDOW;
      }
      
      // Check if this block appears in the recent window
      const foundInWindow = recentBlocks.find(entry => {
        const [entryKey, entryIndex] = entry;
        return entryKey === key && (i - entryIndex) <= effectiveWindow;
      });
      
      if (foundInWindow) {
        log(`🚫 Deduping block at index ${i}: duplicate of block at ${foundInWindow[1]} (distance: ${i - foundInWindow[1]})`);
        removed++;
        duplicates++;
        continue;
      }
      
      // Add to recent blocks window
      recentBlocks.push([key, i]);
      
      // Keep window size manageable - remove entries older than the window
      while (recentBlocks.length > 0 && (i - recentBlocks[0][1]) > PROXIMITY_WINDOW) {
        recentBlocks.shift();
      }
      
      out.push(blk);
    } catch (e) {
      out.push(blk);
    }
  }

  if (removed > 0) {
    log(`🔧 dedupeAndFilterBlocks: removed ${removed} duplicate(s)`);
  }

  return out;
}

module.exports = {
  computeBlockKey,
  dedupeAndFilterBlocks,
};
