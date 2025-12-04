const fs = require('fs');
const cheerio = require('cheerio');

const htmlFile = '../patch/pages/validation-order-issues/predictive-intelligence-for-incident-management-order-issues-2025-12-04T05-19-58.html';
const html = fs.readFileSync(htmlFile, 'utf8');

console.log('📄 Analyzing HTML source...\n');

// Extract text content
const $ = cheerio.load(html);
const bodyText = $('body').text();
const cleanText = bodyText.replace(/\s+/g, ' ').trim();

console.log(`Total characters in HTML: ${cleanText.length}`);
console.log(`\nFirst 500 characters:`);
console.log(cleanText.substring(0, 500));
console.log('\n...\n');

// Find main content sections
const sections = [];
$('section').each((i, el) => {
  const $section = $(el);
  const text = $section.text().replace(/\s+/g, ' ').trim();
  if (text.length > 100) {
    sections.push({
      index: i,
      length: text.length,
      preview: text.substring(0, 100)
    });
  }
});

console.log(`\nFound ${sections.length} content sections:`);
sections.forEach(s => {
  console.log(`   [${s.index}] ${s.length} chars: ${s.preview}...`);
});

// Check for tables
const tables = $('table').length;
console.log(`\nTables found: ${tables}`);

// Check for lists
const lists = $('ul, ol').length;
console.log(`Lists found: ${lists}`);

// Check for paragraphs
const paragraphs = $('p').length;
console.log(`Paragraphs found: ${paragraphs}`);
