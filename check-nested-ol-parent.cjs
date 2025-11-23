const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('./tests/fixtures/build-a-cmdb-query-using-the-cmdb-query-builder.html', 'utf8');
const $ = cheerio.load(html);

// Find the 'Relationship Types' text
const divs = $('div.p').filter((i, el) => {
  return $(el).text().includes('In the Relationship Types and Related Items section');
});

console.log('Found divs:', divs.length);

if (divs.length > 0) {
  const div = divs.first();
  const listItem = div.closest('li');
  console.log('\nParent <li> structure:');
  console.log('Is inside <ol>?', listItem.parent().is('ol'));
  console.log('Parent element:', listItem.parent().prop('tagName'));
  
  // Get the grandparent
  const grandparent = listItem.parent().parent();
  console.log('\nGrandparent element:', grandparent.prop('tagName'));
  console.log('Is grandparent a <li>?', grandparent.is('li'));
  
  // Check siblings of the nested OL
  const ol = listItem.parent();
  console.log('\n<ol> siblings:');
  ol.siblings().each((i, sib) => {
    console.log(`  [${i}] ${$(sib).prop('tagName')}`);
  });
  
  // Get parent structure
  console.log('\nFull structure path:');
  let current = listItem;
  let depth = 0;
  while (current.length > 0 && depth < 10) {
    const tag = current.prop('tagName');
    const classes = current.attr('class') || '';
    console.log(`  ${'  '.repeat(depth)}${tag}${classes ? '.' + classes : ''}`);
    current = current.parent();
    depth++;
  }
}
