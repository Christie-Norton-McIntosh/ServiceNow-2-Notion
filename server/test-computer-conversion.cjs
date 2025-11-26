// Test Computer page conversion to see which table is lost
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Read the HTML file
const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/computer-cmdb-ci-computer-class-2025-11-17T01-45-20.html');
let html = fs.readFileSync(htmlPath, 'utf8');

console.log('=== BEFORE DATATABLES UNWRAPPING ===');
let $ = cheerio.load(html);
let tables = $('table');
console.log(`Tables found: ${tables.length}`);
tables.each((i, table) => {
  const $table = $(table);
  console.log(`\nTable ${i + 1}:`);
  console.log(`  ID: ${$table.attr('id') || 'none'}`);
  console.log(`  Classes: ${$table.attr('class') || 'none'}`);
  console.log(`  Parent: ${$table.parent().attr('class') || 'none'}`);
  console.log(`  Rows: ${$table.find('tbody tr').length}`);
});

// Simulate the DataTables unwrapping (from servicenow.cjs line 1045)
console.log('\n\n=== SIMULATING DATATABLES UNWRAPPING ===');
let changes = 0;
let pass = 0;
const maxPasses = 10;

do {
  changes = 0;
  pass++;
  
  $ = cheerio.load($.html());
  const wrappers = $('div.dataTables_wrapper, div.dataTables_filter, div.dataTables_length, div.dataTables_info, div.dataTables_paginate, div.zDocsFilterTableDiv, div.zDocsFilterColumnsTableDiv, div.zDocsDropdownMenu, div.dropdown-menu');
  
  wrappers.each((i, wrapper) => {
    const $wrapper = $(wrapper);
    const classes = $wrapper.attr('class') || '';
    console.log(`Pass ${pass}: Unwrapping div.${classes.split(' ')[0]}`);
    $wrapper.replaceWith($wrapper.html());
    changes++;
  });
  
} while (changes > 0 && pass < maxPasses);

console.log(`\nCompleted ${pass} passes, unwrapped ${changes} wrappers`);

// Check tables after unwrapping
console.log('\n\n=== AFTER DATATABLES UNWRAPPING ===');
tables = $('table');
console.log(`Tables found: ${tables.length}`);
tables.each((i, table) => {
  const $table = $(table);
  console.log(`\nTable ${i + 1}:`);
  console.log(`  ID: ${$table.attr('id') || 'none'}`);
  console.log(`  Classes: ${$table.attr('class') || 'none'}`);
  console.log(`  Rows: ${$table.find('tbody tr').length}`);
});

// Check if any tables are nested in unwanted divs
console.log('\n\n=== CHECKING REMAINING DIV WRAPPERS ===');
$('table').each((i, table) => {
  const $table = $(table);
  let parent = $table.parent();
  let depth = 0;
  while (parent.length && depth < 5) {
    if (parent.get(0).tagName === 'div') {
      console.log(`Table ${i + 1} has div parent: ${parent.attr('class') || 'no class'}`);
    }
    parent = parent.parent();
    depth++;
  }
});
