const cheerio = require('cheerio');
const fs = require('fs');

// Read the failed page HTML
const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-the-legacy-ibm-pvu-process-pack-failure-2025-12-08T07-16-03.html';
const htmlContent = fs.readFileSync(htmlFile, 'utf8');

// Extract the HTML body
const htmlStart = htmlContent.indexOf('-->') + 3;
const html = htmlContent.substring(htmlStart);

const $ = cheerio.load(html, { decodeEntities: false });

console.log('\n📊 Testing .parents() vs .closest() methods\n');

const noteElem = $('div.note').first();
console.log('Note element found:', noteElem.length > 0 ? 'YES' : 'NO');

// Test .parents()
console.log('\n✅ Using .parents() method:');
const parents = noteElem.parents().toArray();
console.log(`   Total parent elements: ${parents.length}`);
let foundTable = false;
for (const parent of parents) {
  const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
  if (parentTag === 'table' || parentTag === 'thead' || parentTag === 'tbody' || parentTag === 'tr' || parentTag === 'td' || parentTag === 'th') {
    console.log(`   ✓ Found table ancestor: <${parentTag}>`);
    foundTable = true;
    break;
  }
}
console.log(`   Result: ${foundTable ? 'IN TABLE' : 'NOT IN TABLE'}`);

// Test .closest()
console.log('\n✅ Using .closest() method:');
const closestResult = noteElem.closest('table, thead, tbody, tr, td, th');
console.log(`   .closest() returned length: ${closestResult.length}`);
console.log(`   Result: ${closestResult.length > 0 ? 'IN TABLE' : 'NOT IN TABLE'}`);

