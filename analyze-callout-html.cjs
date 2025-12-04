const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('tests/fixtures/override-contact-preferences-duplication-order-issue.html', 'utf8');
const $ = cheerio.load(html);

console.log('\n📋 ANALYZING CALLOUT HTML STRUCTURE:\n');

// Find all div.note elements
const notes = $('div.note').toArray();
console.log(`Found ${notes.length} div.note elements\n`);

notes.forEach((note, idx) => {
  const $note = $(note);
  const text = $note.text().trim().substring(0, 80);
  console.log(`\n[${idx + 1}] div.note:`);
  console.log(`   Text: "${text}..."`);
  
  // Get parent chain
  let parent = $note.parent();
  let depth = 0;
  console.log(`   Parent chain:`);
  while (parent.length > 0 && depth < 5) {
    const tag = parent.get(0).name;
    const classList = parent.attr('class') || 'no-class';
    const id = parent.attr('id') || 'no-id';
    console.log(`   ${' '.repeat(depth * 2)}↑ <${tag} class="${classList}" id="${id}">`);
    parent = parent.parent();
    depth++;
  }
  
  // Check for div.itemgroup or div.info parent
  const itemgroup = $note.closest('div.itemgroup, div.info');
  if (itemgroup.length > 0) {
    console.log(`   ✅ HAS div.itemgroup or div.info parent:`);
    console.log(`      Tag: <${itemgroup.get(0).name}>`);
    console.log(`      Class: "${itemgroup.attr('class')}"`);
  } else {
    console.log(`   ❌ NO div.itemgroup or div.info parent`);
  }
});

