// Test if the double-div fix resolves the Computer page table issue
const fs = require('fs');
const path = require('path');

// Read the HTML file
const htmlPath = path.join(__dirname, '../patch/pages/pages-to-update/computer-cmdb-ci-computer-class-2025-11-17T01-56-47.html');
let html = fs.readFileSync(htmlPath, 'utf8');

console.log('=== COMPUTER PAGE TABLE FIX TEST ===\n');

// Count tables in original HTML
const originalTables = html.match(/<table[^>]*>/gi);
console.log(`📊 Tables in source HTML: ${originalTables ? originalTables.length : 0}`);

// Show the double-div pattern issue
console.log('\n=== ANALYZING DOUBLE-DIV PATTERN ===');
const doubleDivsBefore = html.match(/<\/table><\/div><\/div>/g);
console.log(`🔍 Double closing divs BEFORE fix: ${doubleDivsBefore ? doubleDivsBefore.length : 0}`);

if (doubleDivsBefore) {
  console.log('\n📍 Locations of double closing divs:');
  doubleDivsBefore.forEach((match, idx) => {
    const index = html.indexOf(match);
    const context = html.substring(Math.max(0, index - 80), Math.min(html.length, index + 100));
    const tableId = context.match(/id="([^"]*table[^"]*)"/);
    console.log(`   ${idx + 1}. Near table: ${tableId ? tableId[1] : 'unknown'}`);
  });
}

// Apply the fix (same as in servicenow.cjs lines 1021-1028)
console.log('\n=== APPLYING FIX ===');
const doublePattern = /<\/table><\/div><\/div>/g;
const fixedHtml = html.replace(doublePattern, '</table></div>');

const divsAfterFix = fixedHtml.match(/<\/table><\/div><\/div>/g);
console.log(`✅ Double closing divs AFTER fix: ${divsAfterFix ? divsAfterFix.length : 0}`);

// Verify both tables are now in same parent
console.log('\n=== VERIFYING TABLE STRUCTURE ===');
const cheerio = require('cheerio');
const $ = cheerio.load(fixedHtml);

// Find the div.p that should contain both tables
const divP = $('.p').filter((i, el) => {
  return $(el).text().includes('Computer class adds the following unique attributes');
});

if (divP.length > 0) {
  const tablesInDiv = divP.find('table').length;
  console.log(`✅ Found div.p with "${divP.text().substring(0, 50)}..."`);
  console.log(`📊 Tables inside this div.p: ${tablesInDiv}`);
  
  if (tablesInDiv === 2) {
    console.log('\n🎉 SUCCESS! Both tables are now in the same parent div.p');
    console.log('   They will be processed together and both should appear in Notion.');
  } else {
    console.log(`\n⚠️  ISSUE: Expected 2 tables in div.p, found ${tablesInDiv}`);
  }
  
  // Show which tables are inside
  divP.find('table').each((i, table) => {
    const tableId = $(table).attr('id');
    const rows = $(table).find('tbody tr').length;
    console.log(`   Table ${i + 1}: id="${tableId}", ${rows} rows`);
  });
} else {
  console.log('❌ ERROR: Could not find the div.p containing tables');
}

console.log('\n=== CONCLUSION ===');
if (!divsAfterFix || divsAfterFix.length === 0) {
  console.log('✅ Fix successfully removed all double closing divs');
  console.log('✅ Both tables should now be extracted correctly');
  console.log('\n📝 Next step: Re-extract the Computer page with AutoExtract to test in production');
} else {
  console.log(`❌ Fix did not work as expected - ${divsAfterFix.length} double-divs remain`);
  console.log('   Debug needed to understand why double-divs persist');
}
