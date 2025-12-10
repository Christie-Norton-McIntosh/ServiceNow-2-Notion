#!/usr/bin/env node

/**
 * Debug script to trace list and table extraction
 * Tests basic HTML to see what gets extracted
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Load the servicenow.cjs to get extraction functions
const { extractContentFromHtml } = require('./services/servicenow.cjs');

// Mock logger
const mockLog = (msg) => console.log(`[LOG] ${msg}`);

// Test 1: Simple list extraction
console.log('\n' + '='.repeat(80));
console.log('TEST 1: SIMPLE LIST EXTRACTION');
console.log('='.repeat(80));

const listHtml = fs.readFileSync('/tmp/test-simple-list.html', 'utf8');
console.log('\nInput HTML:');
console.log(listHtml.substring(0, 300));

(async () => {
try {
  const $ = cheerio.load(listHtml);
  console.log('\n✅ Cheerio loaded successfully');
  
  // Check if lists exist
  const ulCount = $('ul').length;
  const olCount = $('ol').length;
  const liCount = $('li').length;
  
  console.log(`\n📊 HTML Structure:
  - <ul> tags: ${ulCount}
  - <ol> tags: ${olCount}
  - <li> tags: ${liCount}`);
  
  // Try to find lists
  console.log('\n🔍 Searching for lists...');
  $('ul, ol').each((idx, elem) => {
    const $list = $(elem);
    const tag = elem.name;
    const items = $list.find('> li');
    console.log(`\n  ${tag.toUpperCase()} #${idx + 1}:`);
    console.log(`    Direct children <li>: ${items.length}`);
    items.each((i, li) => {
      const text = $(li).text().trim();
      console.log(`    - [${i}] "${text}"`);
    });
  });
  
  // Try calling servicenow extraction
  console.log('\n📦 Calling extractContentFromHtml()...');
  const result = await extractContentFromHtml(listHtml);
  
  console.log(`\n✅ Extraction complete:
  - Total blocks: ${result.blocks.length}
  - Has videos: ${result.hasVideos}`);
  
  // Find list items
  const listItems = result.blocks.filter(b => 
    b.type === 'bulleted_list_item' || b.type === 'numbered_list_item'
  );
  console.log(`\n📋 List blocks extracted: ${listItems.length}`);
  
  listItems.forEach((item, idx) => {
    const richText = item[item.type]?.rich_text || [];
    const content = richText.map(rt => rt.text?.content || '').join('');
    console.log(`\n  ${item.type} #${idx + 1}:`);
    console.log(`    Content: "${content}"`);
    console.log(`    Rich text items: ${richText.length}`);
  });
  
  // Show all blocks
  console.log('\n🔍 All blocks extracted:');
  result.blocks.forEach((block, idx) => {
    console.log(`  [${idx}] ${block.type}`);
  });
  
} catch (error) {
  console.error(`\n❌ Error during list extraction:`, error.message);
  console.error(error.stack);
}
})();

// Test 2: Simple table extraction
console.log('\n\n' + '='.repeat(80));
console.log('TEST 2: SIMPLE TABLE EXTRACTION');
console.log('='.repeat(80));

const tableHtml = fs.readFileSync('/tmp/test-simple-table.html', 'utf8');
console.log('\nInput HTML:');
console.log(tableHtml.substring(0, 300));

(async () => {
try {
  const $ = cheerio.load(tableHtml);
  console.log('\n✅ Cheerio loaded successfully');
  
  // Check if tables exist
  const tableCount = $('table').length;
  const trCount = $('tr').length;
  const tdCount = $('td').length;
  const thCount = $('th').length;
  
  console.log(`\n📊 HTML Structure:
  - <table> tags: ${tableCount}
  - <tr> rows: ${trCount}
  - <td> cells: ${tdCount}
  - <th> headers: ${thCount}`);
  
  // Try to find tables
  console.log('\n🔍 Searching for tables...');
  $('table').each((idx, elem) => {
    const $table = $(elem);
    const rows = $table.find('tr');
    console.log(`\n  TABLE #${idx + 1}:`);
    console.log(`    Rows: ${rows.length}`);
    
    rows.each((ridx, row) => {
      const $row = $(row);
      const cells = $row.find('> th, > td');
      console.log(`    Row ${ridx + 1}: ${cells.length} cells`);
      cells.each((cidx, cell) => {
        const text = $(cell).text().trim();
        console.log(`      - Col ${cidx + 1}: "${text}"`);
      });
    });
  });
  
  // Try calling servicenow extraction
  console.log('\n📦 Calling extractContentFromHtml()...');
  const result = await extractContentFromHtml(tableHtml);
  
  console.log(`\n✅ Extraction complete:
  - Total blocks: ${result.blocks.length}
  - Has videos: ${result.hasVideos}`);
  
  // Find tables
  const tables = result.blocks.filter(b => b.type === 'table');
  console.log(`\n📋 Table blocks extracted: ${tables.length}`);
  
  tables.forEach((table, idx) => {
    const rows = table.table?.children || [];
    console.log(`\n  TABLE #${idx + 1}:`);
    console.log(`    Rows: ${rows.length}`);
    
    rows.forEach((row, ridx) => {
      const cells = row.table_row?.cells || [];
      console.log(`    Row ${ridx + 1}: ${cells.length} cells`);
      cells.forEach((cell, cidx) => {
        // Cell can be array of rich_text or direct rich_text
        const richTextArray = Array.isArray(cell) ? cell : [cell];
        const content = richTextArray
          .map(rt => rt.text?.content || '')
          .join('');
        console.log(`      - Col ${cidx + 1}: "${content}"`);
      });
    });
  });
  
  // Show all blocks
  console.log('\n🔍 All blocks extracted:');
  result.blocks.forEach((block, idx) => {
    console.log(`  [${idx}] ${block.type}`);
  });
  
} catch (error) {
  console.error(`\n❌ Error during table extraction:`, error.message);
  console.error(error.stack);
}

console.log('\n' + '='.repeat(80));
console.log('DEBUG COMPLETE');
console.log('='.repeat(80));
})();
