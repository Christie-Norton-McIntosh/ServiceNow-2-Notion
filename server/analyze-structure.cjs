#!/usr/bin/env node

const fs = require('fs');
const cheerio = require('cheerio');
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
  const html = fs.readFileSync('/tmp/test-actual-failing.html', 'utf8');
  
  // Parse HTML to see structure
  const $ = cheerio.load(html, { decodeEntities: true });
  const body = $('body');
  
  // Find the main content area
  const contentDiv = $('.zDocsTopicPageBody');
  console.log('Content div HTML length:', contentDiv.html().length);
  console.log('\nContent div structure:');
  
  function printStructure(elem, indent = 0) {
    const $elem = $(elem);
    const tag = elem.name;
    const id = $elem.attr('id');
    const classes = $elem.attr('class');
    const text = $elem.text().substring(0, 50);
    
    console.log(' '.repeat(indent) + `<${tag} ${id ? 'id="' + id + '"' : ''} ${classes ? 'class="' + classes.substring(0, 20) + '"' : ''}> ~ "${text}..."`);
    
    // Show direct children only
    $elem.children().each((idx, child) => {
      if (idx < 5) {  // Limit to first 5
        printStructure(child, indent + 2);
      }
    });
    
    if ($elem.children().length > 5) {
      console.log(' '.repeat(indent + 2) + `... and ${$elem.children().length - 5} more children`);
    }
  }
  
  printStructure(contentDiv.get(0));
  
  // Now run extraction
  console.log('\n\n=== EXTRACTION RESULT ===\n');
  const result = await extractContentFromHtml(html);
  
  console.log('Extracted blocks:', result.blocks.length);
  result.blocks.forEach((b, i) => {
    console.log(`[${i}] ${b.type}`);
  });
})();
