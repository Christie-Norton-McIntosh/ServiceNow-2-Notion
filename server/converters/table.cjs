/**
 * Table Converter for Notion blocks
 * Extracted from sn2n-proxy.cjs
 *
 * Exports:
 *   - convertTableBlock
 *   - deduplicateTableBlocks
 *
 * Dependencies:
 *   - server/utils/notion-format.cjs
 */

// TODO: Move table parsing, thead/tbody handling, image extraction, deep-nesting, and deduplication logic from sn2n-proxy.cjs

/**
 * Converts HTML table to Notion table block array.
 * @param {string|object} input - HTML string or parsed node
 * @param {object} [options] - Conversion options
 * @returns {Array} Notion table block array
 */

const { cleanHtmlText } = require("../utils/notion-format.cjs");

/**
 * Converts HTML table to Notion table block array.
 * @param {string|object} tableHtml - HTML string of the table
 * @param {object} [options] - Conversion options
 * @returns {Promise<Array>} Notion table block array
 */
async function convertTableBlock(tableHtml, options = {}) {
  // Remove table dropdown/filter elements
  let cleanedTableHtml = tableHtml.replace(
    /<div[^>]*class="[^\"]*zDocsFilterTableDiv[^\"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );
  cleanedTableHtml = cleanedTableHtml.replace(
    /<div[^>]*class="[^\"]*smartTable[^\"]*"[^>]*>[\s\S]*?<\/div>/gi,
    ""
  );

  // Replace any remaining img tags with bullet symbols before processing cells
  if (/<img[^>]*>/i.test(cleanedTableHtml)) {
    cleanedTableHtml = cleanedTableHtml.replace(/<img[^>]*>/gi, " • ");
  }

  // Extract table caption if present
  const captionRegex = /<caption[^>]*>([\s\S]*?)<\/caption>/i;
  const captionMatch = cleanedTableHtml.match(captionRegex);
  const blocks = [];
  if (captionMatch) {
    let captionContent = captionMatch[1];
    captionContent = captionContent.replace(
      /<span[^>]*class="[^\"]*table--title-label[^\"]*"[^>]*>[\s\S]*?<\/span>/gi,
      ""
    );
    const captionText = cleanHtmlText(captionContent);
    if (captionText) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: captionText } }],
        },
      });
    }
  }

  // Extract thead and tbody sections separately
  const theadRegex = /<thead[^>]*>([\s\S]*?)<\/thead>/gi;
  const tbodyRegex = /<tbody[^>]*>([\s\S]*?)<\/tbody>/gi;
  const theadMatch = theadRegex.exec(cleanedTableHtml);
  const tbodyMatch = tbodyRegex.exec(cleanedTableHtml);

  // Helper to process table cell content
  async function processTableCellContent(html) {
    if (!html) return [{ type: "text", text: { content: "" } }];
    // Replace images with bullet
    html = html.replace(/<img[^>]*>/gi, " • ");
    // Remove lists, replace <li> with bullets
    if (/<[uo]l[^>]*>/i.test(html)) {
      let processedHtml = html.replace(/<\/?[uo]l[^>]*>/gi, "");
      processedHtml = processedHtml.replace(/<li[^>]*>/gi, "\n• ");
      processedHtml = processedHtml.replace(/<\/li>/gi, "");
      processedHtml = processedHtml.replace(/\n\s*\n/g, "\n");
      processedHtml = processedHtml.replace(/^\s+/, "");
      processedHtml = processedHtml.replace(/\s+$/, "");
      // Use rich text block conversion for list items too
      const { convertRichTextBlock } = require("./rich-text.cjs");
      return convertRichTextBlock(processedHtml);
    }
    // Use rich text block conversion for all other cell content
    const { convertRichTextBlock } = require("./rich-text.cjs");
    return convertRichTextBlock(cleanHtmlText(html));
  }

  // Extract table rows from thead
  const theadRows = [];
  if (theadMatch) {
    const theadContent = theadMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(theadContent)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        cells.push(await processTableCellContent(cellContent));
      }
      if (cells.length > 0) theadRows.push(cells);
    }
  }

  // Extract table rows from tbody
  const tbodyRows = [];
  if (tbodyMatch) {
    const tbodyContent = tbodyMatch[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tbodyContent)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        const cellContent = cellMatch[1];
        cells.push(await processTableCellContent(cellContent));
      }
      if (cells.length > 0) tbodyRows.push(cells);
    }
  }

  // Fallback: process all <tr> if no thead/tbody
  let rows = [];
  if (theadRows.length > 0 || tbodyRows.length > 0) {
    rows = [...theadRows, ...tbodyRows];
  } else {
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(cleanedTableHtml)) !== null) {
      const rowContent = rowMatch[1];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells = [];
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
        cells.push(await processTableCellContent(cellMatch[1]));
      }
      if (cells.length > 0) rows.push(cells);
    }
  }

  const tableWidth = Math.max(...rows.map((row) => row.length), 0);
  if (tableWidth === 0) return blocks.length > 0 ? blocks : null;

  // Create Notion table block
  const tableBlock = {
    object: "block",
    type: "table",
    table: {
      table_width: tableWidth,
      has_column_header: theadRows.length > 0,
      has_row_header: false,
      children: [],
    },
  };
  rows.forEach((row) => {
    const tableRow = {
      object: "block",
      type: "table_row",
      table_row: { cells: [] },
    };
    for (let i = 0; i < tableWidth; i++) {
      tableRow.table_row.cells.push(row[i] || [{ type: "text", text: { content: "" } }]);
    }
    tableBlock.table.children.push(tableRow);
  });
  blocks.push(tableBlock);
  return blocks;
}

/**
 * Deduplicate Notion table blocks.
 * @param {Array} blocks - Array of Notion table blocks
 * @returns {Array} Deduplicated table blocks
 */

/**
 * Deduplicate Notion table blocks by comparing cell content.
 * @param {Array} blocks - Array of Notion table blocks
 * @returns {Array} Deduplicated table blocks
 */
function deduplicateTableBlocks(blocks) {
  if (!Array.isArray(blocks)) return blocks;
  const seen = new Set();
  return blocks.filter((block) => {
    if (block.type !== "table") return true;
    const key = JSON.stringify(block.table.children.map(row => row.table_row.cells));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  convertTableBlock,
  deduplicateTableBlocks
};
