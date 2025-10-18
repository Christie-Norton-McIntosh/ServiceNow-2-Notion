/**
 * @fileoverview Table Converter for Notion blocks
 * 
 * This module provides utilities for converting HTML tables to Notion's table format,
 * handling complex table structures, captions, headers, and content processing.
 * 
 * Key Features:
 * - HTML table parsing with thead/tbody structure preservation
 * - Table caption extraction and conversion to heading blocks
 * - Rich text processing for table cell content
 * - Image handling and bullet point conversion
 * - Table deduplication to prevent duplicate content
 * - Support for nested lists within table cells
 * 
 * Dependencies:
 * - server/utils/notion-format.cjs (cleanHtmlText)
 * - server/converters/rich-text.cjs (convertRichTextBlock)
 * 
 * @module converters/table
 * @since 8.2.5
 */

const { cleanHtmlText } = require("../utils/notion-format.cjs");

/**
 * Converts HTML table content to Notion table block array.
 * 
 * This function processes HTML table markup and converts it to Notion's table format,
 * preserving structure, headers, and content formatting. It handles table captions,
 * thead/tbody sections, nested lists, images, and complex formatting within cells.
 * 
 * @async
 * @param {string} tableHtml - HTML string containing the table markup to convert
 * @param {object} [options={}] - Conversion options for customizing behavior
 * @param {boolean} [options.preserveImages=false] - Whether to preserve images (default: convert to bullets)
 * @param {boolean} [options.extractCaptions=true] - Whether to extract table captions as headings
 * @param {boolean} [options.processLists=true] - Whether to convert nested lists to bullet points
 * 
 * @returns {Promise<Array<object>|null>} Array of Notion blocks (heading + table), or null if no valid table found
 * 
 * @example
 * // Convert simple HTML table
 * const tableBlocks = await convertTableBlock(`
 *   <table>
 *     <thead><tr><th>Name</th><th>Value</th></tr></thead>
 *     <tbody><tr><td>Item 1</td><td>100</td></tr></tbody>
 *   </table>
 * `);
 * // Returns: [{ type: "table", table: { has_column_header: true, children: [...] } }]
 * 
 * @example
 * // Table with caption becomes heading + table
 * const tableBlocks = await convertTableBlock(`
 *   <table>
 *     <caption>Product Comparison</caption>
 *     <tr><td>Feature A</td><td>Available</td></tr>
 *   </table>
 * `);
 * // Returns: [
 * //   { type: "heading_3", heading_3: { rich_text: [...] } },
 * //   { type: "table", table: { children: [...] } }
 * // ]
 * 
 * @throws {Error} If table processing fails due to malformed HTML
 * @see {@link deduplicateTableBlocks} for removing duplicate tables from arrays
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
 * Removes duplicate table blocks from an array by comparing cell content.
 * 
 * This function identifies and removes duplicate table blocks by comparing their
 * cell content. Two tables are considered duplicates if they have identical
 * cell content structure, regardless of block metadata or IDs.
 * 
 * @param {Array<object>} blocks - Array of Notion blocks that may contain table blocks
 * 
 * @returns {Array<object>} Filtered array with duplicate table blocks removed
 * 
 * @example
 * const blocks = [
 *   { type: "paragraph", paragraph: { rich_text: [...] } },
 *   { type: "table", table: { children: [{ table_row: { cells: [["A"], ["B"]] } }] } },
 *   { type: "table", table: { children: [{ table_row: { cells: [["A"], ["B"]] } }] } }, // Duplicate
 *   { type: "table", table: { children: [{ table_row: { cells: [["C"], ["D"]] } }] } }
 * ];
 * const unique = deduplicateTableBlocks(blocks);
 * // Returns: [paragraph, first table, different table] (duplicate table removed)
 * 
 * @see {@link convertTableBlock} for creating table blocks from HTML
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

/**
 * @typedef {object} NotionTableBlock
 * @property {string} object - Always "block"
 * @property {string} type - Always "table"
 * @property {object} table - Table configuration and content
 * @property {number} table.table_width - Number of columns in the table
 * @property {boolean} table.has_column_header - Whether first row is treated as header
 * @property {boolean} table.has_row_header - Whether first column is treated as header
 * @property {Array<object>} table.children - Array of table_row blocks
 */

/**
 * @typedef {object} NotionTableRow
 * @property {string} object - Always "block"
 * @property {string} type - Always "table_row"
 * @property {object} table_row - Row content
 * @property {Array<Array<object>>} table_row.cells - Array of cell content (rich_text arrays)
 */

/**
 * @typedef {object} TableConversionOptions
 * @property {boolean} [preserveImages=false] - Whether to preserve images (default: convert to bullets)
 * @property {boolean} [extractCaptions=true] - Whether to extract table captions as headings
 * @property {boolean} [processLists=true] - Whether to convert nested lists to bullet points
 */

// Export table conversion utilities
module.exports = {
  /** @type {function(string, TableConversionOptions=): Promise<Array<object>|null>} */
  convertTableBlock,
  /** @type {function(Array<object>): Array<object>} */
  deduplicateTableBlocks
};
