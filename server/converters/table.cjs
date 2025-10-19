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
 * - Image extraction from table cells and placement as separate blocks
 * - Table deduplication to prevent duplicate content
 * - Support for nested lists within table cells
 * 
 * Dependencies:
 * - server/utils/notion-format.cjs (cleanHtmlText)
 * - server/converters/rich-text.cjs (convertRichTextBlock)
 * - server/utils/url.cjs (convertServiceNowUrl, isValidImageUrl)
 * 
 * @module converters/table
 * @since 8.2.5
 */

const { cleanHtmlText } = require("../utils/notion-format.cjs");
const { convertServiceNowUrl, isValidImageUrl } = require("../utils/url.cjs");

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

  // Images in tables will be extracted and placed as separate blocks after the table
  // (removed the global image-to-bullet replacement)
  
  // Array to collect all images found in table cells
  const extractedImages = [];

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
    
    // Load HTML into Cheerio for better parsing
    const cheerio = require('cheerio');
    const $ = cheerio.load(html, { decodeEntities: true });
    
    // Extract images - check both standalone img tags and figures with figcaption
    // Use non-global regex and match() instead of exec() to avoid regex state issues
    const figures = html.match(/<figure[^>]*>[\s\S]*?<\/figure>/gi) || [];
    
    // Track which images will actually be included in Notion upload
    const validImageUrls = new Set();
    
    // Process each figure
    for (const figureHtml of figures) {
      // Extract img src from within figure
      const imgMatch = /<img[^>]*src=["']([^"']*)["'][^>]*>/i.exec(figureHtml);
      if (imgMatch) {
        let src = imgMatch[1];
        const originalSrc = src; // Track original URL to match against HTML
        
        // Extract figcaption text
        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figureHtml);
        const caption = captionMatch ? cleanHtmlText(captionMatch[1]) : '';
        
        // Convert ServiceNow URLs to proper format
        src = convertServiceNowUrl(src);
        
        // Only add valid image URLs
        if (src && isValidImageUrl(src)) {
          extractedImages.push({ src, alt: caption });
          validImageUrls.add(originalSrc); // Track original URL for matching
        }
      }
    }
    
    // Check for standalone img tags (not in figures)
    const standaloneImages = html.match(/<img[^>]*src=["']([^"']*)["'][^>]*>/gi) || [];
    const figureImgCount = figures.length;
    
    // Only process standalone images that are not already in figures
    if (standaloneImages.length > figureImgCount) {
      // Process standalone images...
    }
    
    // Replace figures/images with appropriate placeholders
    // Use "See [caption]" or "See image below" only if the image is being included in Notion
    // Otherwise use bullet placeholder
    let processedHtml = html;
    
    // Replace entire figure elements with appropriate placeholder
    processedHtml = processedHtml.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (match) => {
      // Check if this figure's image is valid and will be included
      const imgMatch = /<img[^>]*src=["']([^"']*)["'][^>]*>/i.exec(match);
      const isValidImage = imgMatch && validImageUrls.has(imgMatch[1]);
      
      if (isValidImage) {
        // Image will be included - use descriptive placeholder
        const captionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(match);
        if (captionMatch) {
          const caption = cleanHtmlText(captionMatch[1]);
          return ` See "${caption}" `;
        }
        return ' See image below ';
      } else {
        // Image won't be included - use bullet placeholder
        return ' • ';
      }
    });
    
    // Replace any remaining standalone img tags with bullet placeholder
    if (/<img[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(/<img[^>]*>/gi, ' • ');
    }
    
    // Handle note callouts in table cells - add newlines before and after
    // Pattern: <div class="note note note_note">...</div>
    if (/<div[^>]*class=["'][^"']*note note_note[^"']*["'][^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(
        /<div[^>]*class=["'][^"']*note note_note[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
        (match, content) => {
          // Preserve HTML tags in note content instead of stripping to plain text
          const $note = cheerio.load(content, { decodeEntities: true });
          const noteHtml = $note('body').html().replace(/\s+/g, ' ').trim();
          // Only add newline before if note is at the start or after a closing tag
          // This prevents mid-sentence line breaks when note follows inline text
          return ` ${noteHtml} `;
        }
      );
    }
    
    // Handle code blocks in table cells - replace <pre> with inline code markers
    // Code blocks can't be nested in table cells, so we convert them to inline code
    if (/<pre[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(
        /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
        (match, content) => {
          // Extract code content and wrap in inline code markers
          const $code = cheerio.load(content, { decodeEntities: true });
          const codeText = $code.text().replace(/\s+/g, ' ').trim();
          return `<code>${codeText}</code>`;
        }
      );
    }
    
    // Strip any remaining placeholders (from preprocessing)
    processedHtml = processedHtml.replace(/___PRE_PLACEHOLDER_\d+___/g, '');
    processedHtml = processedHtml.replace(/__CODE_PLACEHOLDER__/g, '');
    processedHtml = processedHtml.replace(/___\w+_PLACEHOLDER_*\w*___/gi, '');
    
    // Reload Cheerio with processed HTML (after figure/image replacement)
    // Strategy: For cells with multiple <p> tags, we need to:
    // 1. Preserve the HTML tags inside paragraphs (for uicontrol formatting)
    // 2. Add newlines between paragraphs (for soft returns)
    // 3. Pass the HTML to rich-text converter which handles formatting
    
    let textContent = '';
    
    // Check if cell has paragraph tags
    const paragraphMatches = processedHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi);
    
    if (paragraphMatches && paragraphMatches.length > 1) {
      // Multiple paragraphs - split on </p> and add newlines between them
      // This preserves the HTML inside each <p> tag
      textContent = processedHtml
        .replace(/<\/p>\s*<p[^>]*>/gi, '</p>__NEWLINE__<p>')  // Mark newlines with placeholder
        .replace(/<\/?p[^>]*>/gi, '');  // Remove <p> tags but keep content
    } else if (paragraphMatches && paragraphMatches.length === 1) {
      // Single paragraph - check if there's text before it (mixed content)
      const textBeforeP = /^([^<]+)<p/i.exec(processedHtml);
      if (textBeforeP) {
        // Mixed content: text followed by <p>
        textContent = processedHtml.replace(/<p[^>]*>/gi, '__NEWLINE__').replace(/<\/p>/gi, '');
      } else {
        // Just a single <p> wrapper
        textContent = processedHtml.replace(/<\/?p[^>]*>/gi, '');
      }
    } else {
      // No paragraph tags
      textContent = processedHtml;
    }
    
    // Normalize whitespace in the HTML (collapse formatting whitespace but preserve tags)
    // This removes indentation from source HTML without stripping tags
    textContent = textContent
      .replace(/\s*\n\s*/g, ' ')  // Replace newlines (with surrounding whitespace) with single space
      .replace(/\s{2,}/g, ' ')    // Collapse multiple spaces to single space
      .trim();
    
    // Restore intentional newlines from paragraph boundaries
    textContent = textContent.replace(/__NEWLINE__/g, '\n');
    
    // Remove lists, replace <li> with bullets
    if (/<[uo]l[^>]*>/i.test(processedHtml)) {
      processedHtml = processedHtml.replace(/<\/?[uo]l[^>]*>/gi, "");
      processedHtml = processedHtml.replace(/<li[^>]*>/gi, "__NEWLINE__• ");
      processedHtml = processedHtml.replace(/<\/li>/gi, "");
      
      // For list content, preserve HTML tags (for uicontrol, links, etc.) and normalize whitespace
      const $list = cheerio.load(processedHtml, { decodeEntities: true });
      const listParagraphs = [];
      $list('p, div.p').each((i, elem) => {
        // Use .html() instead of .text() to preserve formatting tags like <span class="uicontrol">
        let html = $list(elem).html();
        if (html && html.trim()) {
          // Normalize whitespace but keep HTML tags
          html = html.replace(/\s+/g, ' ').trim();
          listParagraphs.push(html);
        }
      });
      
      textContent = listParagraphs.length > 0
        ? listParagraphs.join('__NEWLINE__')
        : $list('body').html().replace(/\s+/g, ' ').trim();
      
      // Normalize whitespace
      textContent = textContent
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      
      // Restore newlines
      textContent = textContent.replace(/__NEWLINE__/g, '\n');
      
      // Use rich text block conversion for list items
      const { convertRichTextBlock } = require("./rich-text.cjs");
      return convertRichTextBlock(textContent);
    }
    
    // For cells with multiple bullet items (not from HTML lists), add soft returns between them
    // Match pattern: bullet followed by space and text, then another bullet
    // Example: "• Item 1 • Item 2" becomes "• Item 1\n• Item 2"
    if (/•[^•]+•/.test(textContent)) {
      // Add newline before each bullet that's not at the start
      textContent = textContent.replace(/([^\n])(\s*•\s*)/g, '$1__NEWLINE__$2');
      textContent = textContent.replace(/^\s+/, ""); // Clean leading whitespace
      textContent = textContent.replace(/__NEWLINE__/g, '\n'); // Restore newlines
    }
    
    // Use rich text block conversion for all other cell content
    const { convertRichTextBlock } = require("./rich-text.cjs");
    return convertRichTextBlock(textContent);
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
  
  // Add extracted images as separate image blocks after the table
  if (extractedImages.length > 0) {
    console.log(`📸 Extracted ${extractedImages.length} images from table cells`);
    for (const image of extractedImages) {
      const imageBlock = {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: {
            url: image.src
          }
        }
      };
      
      // Add caption if alt text exists
      if (image.alt) {
        imageBlock.image.caption = [
          {
            type: "text",
            text: {
              content: image.alt
            }
          }
        ];
      }
      
      blocks.push(imageBlock);
      console.log(`📸 Added image block: ${image.src.substring(0, 80)}...`);
    }
  }
  
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
