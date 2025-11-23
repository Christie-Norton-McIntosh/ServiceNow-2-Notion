#!/usr/bin/env node

const fs = require('fs');
const cheerio = require('cheerio');

// Read HTML
const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html', 'utf8');

const $ = cheerio.load(html);

console.log('=== HTML SOURCE ORDER (DETAILED) ===\n');

let counter = 0;

function processElement($elem, depth = 0) {
  const indent = '  '.repeat(depth);
  const tag = $elem.prop('tagName')?.toLowerCase();
  
  if (!tag) return;
  
  // Track important structural elements
  if (['h1', 'h2', 'h3', 'h4', 'p', 'table', 'ol', 'ul'].includes(tag)) {
    counter++;
    let preview = '';
    
    if (tag.startsWith('h')) {
      preview = $elem.text().trim().substring(0, 60);
      console.log(`${counter}. ${indent}${tag.toUpperCase()}: ${preview}`);
    } else if (tag === 'table') {
      const caption = $elem.find('caption').first();
      const captionText = caption.text().replace(/Table \d+\.\s*/g, '').trim().substring(0, 60);
      const rows = $elem.find('tbody tr').length;
      console.log(`${counter}. ${indent}TABLE: "${captionText}" (${rows} rows)`);
    } else if (tag === 'p') {
      preview = $elem.text().trim().substring(0, 60);
      if (preview) {
        console.log(`${counter}. ${indent}P: ${preview}`);
      }
    } else if (tag === 'ol' || tag === 'ul') {
      const items = $elem.children('li').length;
      console.log(`${counter}. ${indent}${tag.toUpperCase()}: (${items} items)`);
      
      // Process list items
      $elem.children('li').each((i, li) => {
        counter++;
        const $li = $(li);
        const text = $li.clone().children().remove().end().text().trim().substring(0, 60);
        console.log(`${counter}. ${indent}  LI[${i}]: ${text}`);
        
        // Check for nested content in this LI
        $li.children('p, table, ol, ul').each((j, child) => {
          processElement($(child), depth + 2);
        });
      });
    }
  }
  
  // Process children for non-list elements
  if (!['ol', 'ul', 'li'].includes(tag)) {
    $elem.children().each((i, child) => {
      processElement($(child), depth);
    });
  }
}

// Start processing from body
const $body = $('body');
$body.children().each((i, elem) => {
  processElement($(elem), 0);
});

console.log('\n=== KEY OBSERVATIONS ===');
console.log('\nLook for:');
console.log('1. Tables and their captions');
console.log('2. "Connection UI Notations" table position');
console.log('3. Nested list structures (OL > LI > UL > LI > TABLE)');
console.log('4. Text that says "select either option:" followed by table');
