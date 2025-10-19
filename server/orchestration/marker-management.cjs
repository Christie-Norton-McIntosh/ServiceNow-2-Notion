// server/orchestration/marker-management.cjs
// Handles marker collection, stripping, and block management for deep nesting

// Helper to get global functions
function getGlobals() {
  return {
    log: global.log || console.log,
  };
}

/**
 * Generate a unique marker for deep nesting
 * @returns {string} Unique marker
 */
function generateMarker() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Collect and strip markers from blocks, building a map for orchestration
 * @param {Array} blocks - Array of blocks to process
 * @param {Object} map - Existing marker map to build upon
 * @returns {Object} Updated marker map
 */
function collectAndStripMarkers(blocks, map = {}, depth = 0) {
  if (!Array.isArray(blocks)) return map;
  const indent = '  '.repeat(depth);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b && typeof b === "object") {
      if (b._sn2n_marker) {
        const m = String(b._sn2n_marker);
        console.log(`${indent}🔖 collectAndStripMarkers: Found marker "${m}" at depth ${depth}, index ${i}, type: ${b.type}`);
        // Collect markers at all depths for orchestration
        // Blocks will be appended to their marker location via API after page creation
        if (!map[m]) map[m] = [];
        map[m].push(b);
        // mark this block as collected so we can remove it from the
        // initial children before sending to Notion (avoids duplicates and 3+ level nesting)
        b._sn2n_collected = true;
        console.log(`${indent}🔖   Marked block as collected (will be removed from initial payload)`);
        delete b._sn2n_marker;
      }
      const type = b.type;
      if (type && b[type] && Array.isArray(b[type].children)) {
        collectAndStripMarkers(b[type].children, map, depth + 1);
      }
      if (Array.isArray(b.children)) {
        collectAndStripMarkers(b.children, map, depth + 1);
      }
    }
  }
  return map;
}

/**
 * Remove collected blocks (marked by _sn2n_collected) from an array of blocks
 * @param {Array} blocks - Array of blocks to clean
 * @returns {number} Number of blocks removed
 */
function removeCollectedBlocks(blocks, depth = 0) {
  if (!Array.isArray(blocks)) return 0;
  const indent = '  '.repeat(depth);
  let removed = 0;
  console.log(`${indent}🗑️ removeCollectedBlocks: Checking ${blocks.length} blocks at depth ${depth}`);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (!b || typeof b !== "object") continue;
    if (b._sn2n_collected) {
      console.log(`${indent}🗑️   Removing block at index ${i}, type: ${b.type} [COLLECTED]`);
      blocks.splice(i, 1);
      removed++;
      continue;
    }
    // Recurse into typed children areas if present
    const type = b.type;
    if (type && b[type] && Array.isArray(b[type].children)) {
      const childRemoved = removeCollectedBlocks(b[type].children, depth + 1);
      if (childRemoved > 0) {
        console.log(`${indent}🗑️   Removed ${childRemoved} blocks from ${type}.children of block at index ${i}`);
      }
      removed += childRemoved;
    }
    if (Array.isArray(b.children)) {
      const childRemoved = removeCollectedBlocks(b.children, depth + 1);
      if (childRemoved > 0) {
        console.log(`${indent}🗑️   Removed ${childRemoved} blocks from .children of block at index ${i}`);
      }
      removed += childRemoved;
    }
  }
  console.log(`${indent}🗑️ removeCollectedBlocks: Total removed at depth ${depth}: ${removed}`);
  return removed;
}

/**
 * Remove a marker token from a rich_text array even if it is split across elements.
 * Returns a new sanitized rich_text array (does not mutate input).
 * @param {Array} richArray - Rich text array to process
 * @param {string} marker - Marker to remove
 * @returns {Array} Cleaned rich text array
 */
function removeMarkerFromRichTextArray(richArray, marker) {
  if (!Array.isArray(richArray)) return [];
  const token = `(sn2n:${marker})`;

  // Local clone helper (don't rely on cloneRichText being in scope)
  function _clone(rt) {
    if (!rt || typeof rt !== "object") return null;
    const cloned = { ...rt };
    cloned.annotations = rt.annotations ? { ...rt.annotations } : {};
    if (rt.text && typeof rt.text === "object") cloned.text = { ...rt.text };
    if (typeof cloned.plain_text !== "string" && cloned.text?.content) {
      cloned.plain_text = cloned.text.content;
    }
    return cloned;
  }

  // Quick path: if any single element equals the token, drop it.
  const anyExact = richArray.some(
    (rt) => rt?.text?.content && rt.text.content.trim() === token
  );
  if (anyExact) {
    return richArray
      .filter((rt) => !(rt?.text?.content && rt.text.content.trim() === token))
      .map(_clone)
      .filter(Boolean);
  }

  // Otherwise we need to scan concatenated content and remove the token across boundaries while preserving annotations.
  // Build list of contents and track element boundaries.
  const parts = richArray.map((rt, idx) => ({
    idx,
    text: rt?.text?.content || "",
    raw: rt,
  }));
  const concat = parts.map((p) => p.text).join("");
  const pos = concat.indexOf(token);
  if (pos === -1) {
    // Nothing to remove; return sanitized clones using local _clone
    return richArray
      .map(_clone)
      .filter(
        (rt) =>
          rt &&
          rt.text &&
          typeof rt.text.content === "string" &&
          (rt.text.content.trim().length > 0 || !!rt.text.link)
      );
  }

  // Remove token by reconstructing the rich_text sequence with the token removed.
  const before = concat.slice(0, pos);
  const after = concat.slice(pos + token.length);

  // Re-slice into new rich_text pieces: keep existing annotations where possible by taking whole source elements
  // but trim leading/trailing content as needed.
  const newArray = [];
  let cursor = 0;
  for (const p of parts) {
    const len = p.text.length;
    const segStart = cursor;
    const segEnd = cursor + len;
    cursor = segEnd;

    // Determine portion of this element that remains (relative to concat)
    const keepParts = [];
    if (segEnd <= pos || segStart >= pos + token.length) {
      // Entire element is outside token range — keep whole element
      newArray.push(_clone(p.raw));
      continue;
    }

    // Element overlaps token — keep head and/or tail portions
    const headLen = Math.max(0, Math.min(len, Math.max(0, pos - segStart)));
    const tailLen = Math.max(
      0,
      Math.min(len, Math.max(0, segEnd - (pos + token.length)))
    );

    if (headLen > 0) {
      const headText = p.text.slice(0, headLen);
      const clone = _clone(p.raw);
      clone.text = { ...clone.text, content: headText };
      newArray.push(clone);
    }
    if (tailLen > 0) {
      const tailText = p.text.slice(len - tailLen);
      const clone = _clone(p.raw);
      clone.text = { ...clone.text, content: tailText };
      newArray.push(clone);
    }
  }

  // Finally sanitize and return using local rules (avoid external clone dependency)
  return newArray
    .map((rt) => _clone(rt))
    .filter(
      (rt) =>
        rt &&
        rt.text &&
        typeof rt.text.content === "string" &&
        (rt.text.content.trim().length > 0 || !!rt.text.link)
    );
}

/**
 * Sanitize rich text array by ensuring proper structure
 * @param {Array} richText - Rich text array to sanitize
 * @returns {Array} Sanitized rich text array
 */
function sanitizeRichTextArray(richText) {
  if (!Array.isArray(richText)) return [];
  return richText.filter(rt => 
    rt && 
    rt.text && 
    typeof rt.text.content === 'string' && 
    (rt.text.content.trim().length > 0 || !!rt.text.link)
  );
}

module.exports = {
  generateMarker,
  collectAndStripMarkers,
  removeCollectedBlocks,
  removeMarkerFromRichTextArray,
  sanitizeRichTextArray,
};