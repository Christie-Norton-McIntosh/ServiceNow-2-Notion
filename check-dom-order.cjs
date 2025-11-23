#!/usr/bin/env node

const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html', 'utf-8');
const $ = cheerio.load(html);

// Find the list item containing 'On the canvas'
const canvasLi = $('li').filter((i, el) => {
  return $(el).text().includes('On the canvas, you can do any of the following operations');
}).first();

if (canvasLi.length === 0) {
  console.log('Canvas list item not found');
  process.exit(1);
}

console.log('Item 9 children in DOM order:');
console.log('='.repeat(80));

// Get all direct children (ul and ol)
const children = canvasLi.find('> ul, > ol').first();
const listItems = children.find('> li');

listItems.each((idx, li) => {
  const $li = $(li);
  const text = $li.clone().children().remove().end().text().trim().substring(0, 80);
  const hasNestedOl = $li.find('> ol').length > 0;
  const hasTable = $li.find('table').length > 0;
  console.log(`[${idx}] ${text}${hasTable ? ' [HAS TABLE]' : ''}${hasNestedOl ? ' [HAS NESTED OL]' : ''}`);
  
  // If has nested OL, show those items too
  if (hasNestedOl) {
    const nestedItems = $li.find('> ol > li');
    nestedItems.each((nIdx, nLi) => {
      const $nLi = $(nLi);
      const nText = $nLi.clone().children().remove().end().text().trim().substring(0, 60);
      const nHasTable = $nLi.find('table').length > 0;
      console.log(`  [${idx}.${nIdx}] ${nText}${nHasTable ? ' [HAS TABLE]' : ''}`);
    });
  }
});

console.log('\n' + '='.repeat(80));
console.log('Checking items 9.13-9.20 specifically:');
console.log('='.repeat(80));

// Look for the nested OL that contains items 9.13-9.20
const nestedOls = canvasLi.find('ol');
nestedOls.each((olIdx, ol) => {
  const $ol = $(ol);
  const items = $ol.find('> li');
  
  // Check if this OL contains the "On the first node" text (item 9.13)
  const hasFirstNode = items.filter((i, li) => $(li).text().includes('On the first node in the connection')).length > 0;
  
  if (hasFirstNode) {
    console.log(`\nFound nested OL (OL #${olIdx}) with items 9.13-9.20:`);
    items.each((itemIdx, li) => {
      const $li = $(li);
      const text = $li.clone().children().remove().end().text().trim().substring(0, 80);
      const hasTable = $li.find('table').length > 0;
      console.log(`  [${itemIdx}] ${text}${hasTable ? ' [HAS TABLE]' : ''}`);
    });
  }
});
