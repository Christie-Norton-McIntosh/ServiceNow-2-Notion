const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Read the failed page HTML
const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-the-legacy-ibm-pvu-process-pack-failure-2025-12-08T07-16-03.html';
const htmlContent = fs.readFileSync(htmlFile, 'utf8');

// Extract the HTML body (remove HTML comment header)
const htmlStart = htmlContent.indexOf('-->') + 3;
const html = htmlContent.substring(htmlStart);

const $ = cheerio.load(html, { decodeEntities: false });

console.log('\n📊 [TEST-CALLOUT] Analyzing IBM PVU Process Pack page\n');

// Count callouts using simple selector (OLD METHOD)
const calloutsBySimpleSelect = $('div.note, div.note_note, .note').length;
console.log(`❌ Simple selector count: ${calloutsBySimpleSelect} callouts`);

// Count callouts with table ancestor check (NEW METHOD)
let calloutsByTableCheck = 0;
$('div.note, div.note_note, .note').each((i, elem) => {
  const $elem = $(elem);
  const inTable = $elem.closest('table, thead, tbody, tr, td, th').length > 0;
  if (!inTable) {
    calloutsByTableCheck++;
    console.log(`✅ Callout ${calloutsByTableCheck}: NOT in table - counting`);
  } else {
    console.log(`⏭️  Skipped callout: INSIDE table - skipping`);
  }
});

console.log(`\n✅ Table-aware count: ${calloutsByTableCheck} callouts`);

// Find all callout elements with details
console.log('\n🔍 All callout elements found:');
$('div.note, div.note_note, .note').each((i, elem) => {
  const $elem = $(elem);
  const text = $elem.text().trim().substring(0, 50);
  const inTable = $elem.closest('table, thead, tbody, tr, td, th').length > 0;
  const classes = $elem.attr('class');
  console.log(`  [${i+1}] Classes: ${classes}`);
  console.log(`      Text: ${text}...`);
  console.log(`      In table: ${inTable ? 'YES - should skip' : 'NO - should count'}`);
});

console.log('\n📋 Table cell content analysis:');
$('td').each((i, cell) => {
  const $cell = $(cell);
  const notes = $cell.find('div.note, div.note_note, .note');
  if (notes.length > 0) {
    console.log(`  Table cell ${i+1}: Contains ${notes.length} callout(s)`);
    notes.each((j, note) => {
      const text = $(note).text().trim().substring(0, 40);
      console.log(`    - "${text}..."`);
    });
  }
});

