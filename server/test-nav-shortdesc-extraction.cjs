const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-procurement-failure-2025-12-10T08-55-13.html', 'utf8');

const $ = cheerio.load(html);

console.log('\n=== TEST 1: Find all shortdesc paragraphs ===');
const allShortdescs = $('p.shortdesc').toArray();
console.log(`Found ${allShortdescs.length} shortdesc paragraphs`);
allShortdescs.forEach((p, i) => {
  const text = $(p).text().trim().substring(0, 80);
  const parent = $(p).parent().prop('tagName');
  const parentClass = $(p).parent().attr('class');
  console.log(`  [${i}] <${parent} class="${parentClass}">: "${text}..."`);
});

console.log('\n=== TEST 2: Find all nav elements ===');
const allNavs = $('nav').toArray();
console.log(`Found ${allNavs.length} nav elements`);
allNavs.forEach((nav, i) => {
  const role = $(nav).attr('role');
  const classes = $(nav).attr('class');
  const parent = $(nav).parent().prop('tagName');
  const parentId = $(nav).parent().attr('id');
  const hasContent = $(nav).find('a').length > 0;
  console.log(`  [${i}] <${parent} id="${parentId}"> > <nav role="${role}" class="${classes || 'none'}"> hasLinks=${hasContent}`);
});

console.log('\n=== TEST 3: Try article > nav selector ===');
const articleNavs1 = $('.zDocsTopicPageBody article > nav').toArray();
console.log(`Selector '.zDocsTopicPageBody article > nav': ${articleNavs1.length} elements`);

console.log('\n=== TEST 4: Try broader nav selector ===');
const articleNavs2 = $('.zDocsTopicPageBody nav').toArray();
console.log(`Selector '.zDocsTopicPageBody nav': ${articleNavs2.length} elements`);

console.log('\n=== TEST 5: Check if navs are inside article ===');
$('nav').each((i, nav) => {
  const $nav = $(nav);
  const isInsideArticle = $nav.closest('article').length > 0;
  const isInsideZDocs = $nav.closest('.zDocsTopicPageBody').length > 0;
  const linkText = $nav.find('a').first().text().trim();
  console.log(`  Nav ${i}: insideArticle=${isInsideArticle}, insideZDocs=${isInsideZDocs}, linkText="${linkText}"`);
});

console.log('\n=== TEST 6: Check shortdesc locations ===');
$('p.shortdesc').each((i, p) => {
  const $p = $(p);
  const isInsideNav = $p.closest('nav').length > 0;
  const isInsideSection = $p.closest('section').length > 0;
  const isInsideDiv = $p.closest('div.body').length > 0;
  const text = $p.text().trim().substring(0, 60);
  console.log(`  Shortdesc ${i}: nav=${isInsideNav}, section=${isInsideSection}, div.body=${isInsideDiv}`);
  console.log(`    Text: "${text}..."`);
});
