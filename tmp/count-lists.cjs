const cheerio = require('cheerio');
const fs = require('fs');

const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/create-a-change-request-patch-validation-failed-2025-12-07T06-34-23.html', 'utf8');
const $ = cheerio.load(html);

// All ol>li direct children
const allOlLi = $('ol > li').length;

// Top-level ol>li (exclude nested)
let topLevelOl = 0;
$('ol').each((i, ol) => {
  const $ol = $(ol);
  // Check if this ol is inside another li
  const parentLi = $ol.closest('li');
  if (parentLi.length === 0) {
    // This is a top-level ol
    topLevelOl += $ol.children('li').length;
  }
});

// All ul>li
const allUlLi = $('ul > li').length;

// Top-level ul>li (exclude nested)
let topLevelUl = 0;
$('ul').each((i, ul) => {
  const $ul = $(ul);
  const parentLi = $ul.closest('li');
  if (parentLi.length === 0) {
    topLevelUl += $ul.children('li').length;
  }
});

console.log('=== List Item Counts ===');
console.log('All ol>li:', allOlLi);
console.log('Top-level ol>li:', topLevelOl);
console.log('All ul>li:', allUlLi);
console.log('Top-level ul>li:', topLevelUl);
console.log('\n=== Expected from Validation ===');
console.log('Expected OL: 29');
console.log('Got OL: 14');
console.log('Expected UL: 9');
console.log('Got UL: 3');
