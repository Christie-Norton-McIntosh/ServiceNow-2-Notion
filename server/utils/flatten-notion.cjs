/**
 * @file Flatten Notion blocks to text for comparison
 * @module utils/flatten-notion
 * 
 * Deterministically flatten Notion blocks to a single text stream
 * for comparison with source HTML content.
 */

/**
 * Extract plain text from rich_text array
 * @param {Object} block - Notion block
 * @param {string} type - Block type
 * @returns {string} Plain text content
 */
function richTextToPlain(block, type) {
  const rt = (block[type] && block[type].rich_text) || block.rich_text || [];
  return rt.map(t => t.plain_text || '').join('');
}

/**
 * Recursively flatten Notion blocks to text
 * @param {Array} blocks - Array of Notion blocks
 * @returns {string} Flattened text content
 */
function flattenBlocks(blocks) {
  const out = [];
  
  function walk(list) {
    for (const b of list) {
      const type = b.type;
      let txt = '';
      
      if (type?.startsWith('heading')) {
        txt = richTextToPlain(b, type);
        out.push('\n' + txt + '\n');
      } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        txt = richTextToPlain(b, type);
        out.push(txt + '\n');
      } else if (type === 'paragraph' || type === 'quote' || type === 'callout' || type === 'code') {
        txt = richTextToPlain(b, type);
        out.push(txt + '\n');
      } else {
        txt = richTextToPlain(b, type);
        if (txt) out.push(txt + '\n');
      }
      
      if (b.has_children && Array.isArray(b.children)) {
        walk(b.children);
      }
    }
  }
  
  walk(blocks || []);
  return out.join('').trim();
}

module.exports = { flattenBlocks };
