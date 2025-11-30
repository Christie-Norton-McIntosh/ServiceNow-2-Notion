const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const htmlPath = path.join(__dirname, '../patch/pages/pages-to-update/create-a-ci-identification-rule-2025-11-22t05-37-00-patch-va-patch-validation-failed-2025-11-22T07-22-28.html');
const html = fs.readFileSync(htmlPath, 'utf-8');
const $ = cheerio.load(html);

console.log('\n🔍 Testing Itemgroup Unwrapping');
console.log('━'.repeat(80));

// Find list items with itemgroup divs
const listItemsWithItemgroups = $('ol > li').filter((i, li) => {
  return $(li).find('> div.itemgroup').length > 0;
}).toArray();

console.log(`\n📊 Found ${listItemsWithItemgroups.length} list items with direct itemgroup children`);

listItemsWithItemgroups.slice(0, 3).forEach((li, idx) => {
  const $li = $(li);
  const itemgroupCount = $li.find('> div.itemgroup').length;
  const noteCount = $li.find('div.note.note_note').length;
  
  console.log(`\n📍 List Item ${idx + 1}:`);
  console.log(`   - Itemgroups (direct children): ${itemgroupCount}`);
  console.log(`   - Notes (anywhere inside): ${noteCount}`);
  
  // Check notes inside itemgroups
  $li.find('> div.itemgroup').each((i, itemgroup) => {
    const $itemgroup = $(itemgroup);
    const notesInside = $itemgroup.find('div.note.note_note').length;
    console.log(`   - Itemgroup ${i + 1} contains ${notesInside} note(s)`);
  });
  
  // Now unwrap itemgroups
  const wrappersToUnwrap = $li.find('> div[class*="itemgroup"], > div[class*="info"]');
  console.log(`   - Unwrapping ${wrappersToUnwrap.length} wrapper(s)...`);
  
  wrappersToUnwrap.each((i, wrapper) => {
    $(wrapper).replaceWith($(wrapper).html());
  });
  
  // Check direct children after unwrapping
  const directNotes = $li.find('> div.note').length;
  const directNoteNotes = $li.find('> div.note.note_note').length;
  
  console.log(`   - After unwrap: direct .note children: ${directNotes}`);
  console.log(`   - After unwrap: direct .note.note_note children: ${directNoteNotes}`);
});

console.log('\n━'.repeat(80));
