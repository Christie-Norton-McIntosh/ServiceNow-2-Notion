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
      const emoji = blk.callout.icon?.type === "emoji" ? blk.callout.icon.emoji : "";
      const color = blk.callout.color || "";
      return `callout:${txt}|${emoji}|${color}`;
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
        for (let i = 0; i < Math.min(3, blk.table.children.length); i++) {
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
  const seen = new Set();
  const out = [];
  let removed = 0;
  let filteredCallouts = 0;
  let duplicates = 0;

  for (const blk of blockArray) {
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
      
      // Filter out gray info callouts only (keep blue notes)
      if (
        blk &&
        blk.type === "callout" &&
        blk.callout &&
        blk.callout.color === "gray_background" &&
        blk.callout.icon?.type === "emoji" &&
        String(blk.callout.icon.emoji).includes("ℹ")
      ) {
        log(`🚫 Filtering gray callout: emoji="${blk.callout.icon?.emoji}", color="${blk.callout.color}"`);
        removed++;
        filteredCallouts++;
        continue;
      }

      // Special-case image dedupe by uploaded file id ONLY
      if (blk && blk.type === 'image' && blk.image) {
        const fileId = blk.image.file_upload && blk.image.file_upload.id;
        if (fileId) {
          const imageKey = `image:file:${String(fileId)}`;
          if (seen.has(imageKey)) {
            removed++;
            duplicates++;
            continue;
          }
          seen.add(imageKey);
        }
        // For external images without a file_upload id, do not dedupe here — keep both
        out.push(blk);
        continue;
      }

      const key = computeBlockKey(blk);
      if (seen.has(key)) {
        removed++;
        duplicates++;
        continue;
      }
      seen.add(key);
      out.push(blk);
    } catch (e) {
      out.push(blk);
    }
  }

  if (removed > 0) {
    log(`🔧 dedupeAndFilterBlocks: removed ${removed} total (${filteredCallouts} callouts, ${duplicates} duplicates)`);
  }

  return out;
}

module.exports = {
  computeBlockKey,
  dedupeAndFilterBlocks,
};
