#!/usr/bin/env node
/**
 * Embed Page ID Helper
 * 
 * Embeds Notion page ID into HTML file as a comment for easier validation.
 * This is useful when you have the page ID but it's not stored in the HTML.
 * 
 * Usage:
 *   node embed-page-id.cjs <html-file> <page-id>
 * 
 * Example:
 *   node embed-page-id.cjs page.html 2a8a89fedba5816d9940c30180a3bb16
 */

const fs = require('fs');
const path = require('path');

function embedPageId(htmlFilePath, pageId) {
  // Read HTML
  let html = fs.readFileSync(htmlFilePath, 'utf-8');
  
  // Check if already has page ID
  if (html.includes('<!-- Notion Page ID:')) {
    console.log('⚠️  HTML already contains a page ID comment. Updating...');
    html = html.replace(/<!-- Notion Page ID: [a-f0-9-]+ -->/gi, `<!-- Notion Page ID: ${pageId} -->`);
  } else {
    // Add comment at the start of the file
    html = `<!-- Notion Page ID: ${pageId} -->\n${html}`;
  }
  
  // Write back
  fs.writeFileSync(htmlFilePath, html, 'utf-8');
  
  console.log(`✅ Embedded page ID ${pageId} into ${path.basename(htmlFilePath)}`);
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node embed-page-id.cjs <html-file> <page-id>');
    console.error('\nExample:');
    console.error('  node embed-page-id.cjs page.html 2a8a89fedba5816d9940c30180a3bb16');
    process.exit(1);
  }
  
  const [htmlFile, pageId] = args;
  const htmlPath = path.resolve(htmlFile);
  
  if (!fs.existsSync(htmlPath)) {
    console.error(`Error: HTML file not found: ${htmlPath}`);
    process.exit(1);
  }
  
  // Validate page ID format (32 or 36 chars, hex with optional hyphens)
  const cleanId = pageId.replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/i.test(cleanId)) {
    console.error(`Error: Invalid page ID format: ${pageId}`);
    console.error('Expected: 32-character hex string (with or without hyphens)');
    process.exit(1);
  }
  
  embedPageId(htmlPath, pageId);
}

module.exports = { embedPageId };
