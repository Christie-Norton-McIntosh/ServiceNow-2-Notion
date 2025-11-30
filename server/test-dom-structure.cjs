const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const htmlPath = path.join(__dirname, '../patch/pages/pages-to-update/create-a-ci-identification-rule-2025-11-22t05-37-00-patch-va-patch-validation-failed-2025-11-22T07-22-28.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const $ = cheerio.load(html);

console.log('\n🔍 Analyzing DOM Structure for Callouts');
console.log('━'.repeat(80));

// Find the 3 missing callouts (inside itemgroup divs)
const itemgroupCallouts = $('div.itemgroup div.note.note_note').toArray();

console.log(`\n📊 Found ${itemgroupCallouts.length} note_note divs inside itemgroup divs`);

itemgroupCallouts.forEach((callout, idx) => {
  const $callout = $(callout);
  const text = $callout.text().trim().substring(0, 80);
  
  console.log(`\n📢 Callout ${idx + 1} in itemgroup:`);
  console.log(`   Text: ${text}...`);
  
  // Trace up the DOM tree
  let $current = $callout;
  let depth = 0;
  const ancestors = [];
  
  while ($current.length > 0 && depth < 10) {
    const tag = $current.prop('tagName')?.toLowerCase();
    const classes = $current.attr('class') || '';
    const id = $current.attr('id') || '';
    
    if (tag) {
      ancestors.push(`<${tag}${id ? ` id="${id}"` : ''}${classes ? ` class="${classes}"` : ''}>`);
    }
    
    $current = $current.parent();
    depth++;
  }
  
  console.log(`   DOM Path (bottom to top):`);
  ancestors.forEach((anc, i) => {
    console.log(`     ${' '.repeat(i * 2)}${anc}`);
  });
});

// Check if itemgroup divs are in the sections
console.log('\n\n🔍 Checking Section Structure:');
console.log('━'.repeat(80));

const allSections = $('section').toArray();
console.log(`\nFound ${allSections.length} sections`);

allSections.forEach((section, idx) => {
  const $section = $(section);
  const sectionId = $section.attr('id') || 'NO-ID';
  const sectionClass = $section.attr('class') || '';
  
  // Check for itemgroups inside this section
  const itemgroupsInSection = $section.find('div.itemgroup').length;
  const calloutsInSection = $section.find('div.note.note_note').length;
  
  if (itemgroupsInSection > 0 || calloutsInSection > 0) {
    console.log(`\n📍 Section ${idx + 1}: ${sectionId} (class: ${sectionClass})`);
    console.log(`   - Itemgroups: ${itemgroupsInSection}`);
    console.log(`   - Callouts: ${calloutsInSection}`);
  }
});

console.log('\n━'.repeat(80));
