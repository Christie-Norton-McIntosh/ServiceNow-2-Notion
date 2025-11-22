#!/usr/bin/env node
/**
 * Analyze callout locations in create-a-ci-identification-rule HTML
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const htmlPath = path.join(__dirname, '../patch/pages/pages-to-update/create-a-ci-identification-rule-2025-11-22t05-37-00-patch-va-patch-validation-failed-2025-11-22T07-22-28.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const $ = cheerio.load(html);

console.log('\n🔍 Analyzing Callout Locations');
console.log('━'.repeat(80));

// Count all callouts
const allCallouts = $('div.note, div.info, div.warning, div.important, div.tip, div.caution, aside, section.prereq').length;
console.log(`\n📊 Total callouts in HTML: ${allCallouts}`);

// Count itemgroup callouts (containers, not real callouts)
const itemgroupCallouts = $('div.itemgroup.note, div.itemgroup.info').length;
console.log(`📦 Itemgroup containers: ${itemgroupCallouts}`);

// Count callouts inside tables
const calloutsInTables = $('table div.note, table div.info, table div.warning, table div.important, table div.tip, table div.caution, table aside, table section.prereq').length;
console.log(`🔲 Callouts inside tables: ${calloutsInTables}`);

// Count nested callouts
let nestedCallouts = 0;
$('div.note, div.info, div.warning, div.important, div.tip, div.caution, aside, section.prereq').each((i, callout) => {
  const $callout = $(callout);
  if ($callout.hasClass('itemgroup')) return;
  if ($callout.closest('table').length > 0) return;
  
  const parentCallout = $callout.parent().closest('div.note:not(.itemgroup), div.info:not(.itemgroup), div.warning:not(.itemgroup), div.important:not(.itemgroup), div.tip:not(.itemgroup), div.caution:not(.itemgroup), aside, section.prereq');
  if (parentCallout.length > 0 && !parentCallout.hasClass('itemgroup')) {
    nestedCallouts++;
  }
});
console.log(`🪹 Nested callouts: ${nestedCallouts}`);

const expectedCallouts = allCallouts - itemgroupCallouts - calloutsInTables - nestedCallouts;
console.log(`\n✅ Expected callouts (validator count): ${expectedCallouts}`);

// Now list each top-level callout with context
console.log('\n\n📋 Top-Level Callout Details:');
console.log('━'.repeat(80));

let count = 0;
$('div.note, div.info, div.warning, div.important, div.tip, div.caution, aside, section.prereq').each((i, callout) => {
  const $callout = $(callout);
  
  // Skip if itemgroup container
  if ($callout.hasClass('itemgroup')) {
    console.log(`\n❌ Skipped (itemgroup): ${$callout.attr('class')}`);
    return;
  }
  
  // Skip if inside table
  if ($callout.closest('table').length > 0) {
    const text = $callout.text().trim().substring(0, 60);
    console.log(`\n🔲 Skipped (in table): ${text}...`);
    return;
  }
  
  // Skip if nested
  const parentCallout = $callout.parent().closest('div.note:not(.itemgroup), div.info:not(.itemgroup), div.warning:not(.itemgroup), div.important:not(.itemgroup), div.tip:not(.itemgroup), div.caution:not(.itemgroup), aside, section.prereq');
  if (parentCallout.length > 0 && !parentCallout.hasClass('itemgroup')) {
    const text = $callout.text().trim().substring(0, 60);
    console.log(`\n🪹 Skipped (nested): ${text}...`);
    return;
  }
  
  // This is a top-level callout!
  count++;
  const classes = $callout.attr('class') || '';
  const text = $callout.text().trim();
  const preview = text.substring(0, 100).replace(/\s+/g, ' ');
  
  // Get parent context
  const $parent = $callout.parent();
  const parentTag = $parent.prop('tagName')?.toLowerCase() || 'unknown';
  const parentClass = $parent.attr('class') || '';
  
  console.log(`\n📢 Callout ${count}:`);
  console.log(`   Classes: ${classes}`);
  console.log(`   Parent: <${parentTag} class="${parentClass}">`);
  console.log(`   Text: ${preview}${text.length > 100 ? '...' : ''}`);
});

console.log('\n\n━'.repeat(80));
console.log(`✅ Found ${count} top-level callouts\n`);
