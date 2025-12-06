const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Read the HTML file
const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/add-a-software-license-using-the-legacy-software-asset-manag-content-validation-failed-2025-12-05T07-39-05.html';
const html = fs.readFileSync(htmlFile, 'utf8');

console.log('=== Manual HTML Analysis ===\n');

// Load with Cheerio
const $ = cheerio.load(html, { decodeEntities: false });

// Find the main content area
const contentArea = $('.zDocsTopicPageBodyContent');
console.log(`Found content area: ${contentArea.length > 0 ? 'YES' : 'NO'}`);

// Extract text nodes
function countTextNodes(element) {
  let count = 0;
  let totalLength = 0;

  function traverse(node) {
    if (node.type === 'text') {
      const text = node.data.trim();
      if (text) {
        count++;
        totalLength += text.length;
        console.log(`Text node ${count}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}" (${text.length} chars)`);
      }
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  if (element.length > 0) {
    traverse(element.get(0));
  }

  return { count, totalLength };
}

console.log('\n=== Text Node Analysis ===');
const textStats = countTextNodes(contentArea);
console.log(`\nTotal text nodes: ${textStats.count}`);
console.log(`Total text length: ${textStats.totalLength}`);

// Check for tables
const tables = contentArea.find('table');
console.log(`\n=== Table Analysis ===`);
console.log(`Tables found: ${tables.length}`);

if (tables.length > 0) {
  const table = tables.first();
  const rows = table.find('tr');
  console.log(`Table rows: ${rows.length}`);

  // Check table structure
  const theadRows = table.find('thead tr');
  const tbodyRows = table.find('tbody tr');
  console.log(`Header rows: ${theadRows.length}`);
  console.log(`Body rows: ${tbodyRows.length}`);

  // Sample some cell content
  console.log('\nSample cell content:');
  table.find('td').slice(0, 5).each((i, cell) => {
    const text = $(cell).text().trim();
    console.log(`Cell ${i+1}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  });
}

// Check for other content
const paragraphs = contentArea.find('p');
const lists = contentArea.find('ol, ul');
const callouts = contentArea.find('[class*="callout"], [class*="note"], [class*="warning"]');

console.log(`\n=== Content Summary ===`);
console.log(`Paragraphs: ${paragraphs.length}`);
console.log(`Lists: ${lists.length}`);
console.log(`Callouts: ${callouts.length}`);