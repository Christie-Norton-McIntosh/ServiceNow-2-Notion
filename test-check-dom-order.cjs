const cheerio = require('cheerio');
const fs = require('fs');

const html = fs.readFileSync('test-input.html', 'utf-8');
const $ = cheerio.load(html);

// Find the div.p that contains the ol with "Add filters"
$('div.p').each((i, elem) => {
  const $elem = $(elem);
  const text = $elem.text();
  
  if (text.includes('business criticality')) {
    console.log(`\n=== Found div.p with "business criticality" ===\n`);
    console.log('Full HTML:');
    console.log($elem.html().substring(0, 500));
    console.log('\n---\n');
    
    const children = $elem.find('> *').toArray();
    console.log(`Child elements: ${children.length}`);
    children.forEach((child, idx) => {
      console.log(`  [${idx}] <${child.tagName}>`);
    });
    
    if (children.length > 0) {
      const lastChild = children[children.length - 1];
      const lastChildHtml = $(lastChild).prop('outerHTML');
      const fullHtml = $elem.html();
      
      console.log(`\nLast child outerHTML length: ${lastChildHtml.length}`);
      console.log(`Full HTML length: ${fullHtml.length}`);
      console.log(`Last child ends at: ${fullHtml.lastIndexOf(lastChildHtml) + lastChildHtml.length}`);
      console.log(`Difference: ${fullHtml.length - (fullHtml.lastIndexOf(lastChildHtml) + lastChildHtml.length)}`);
      
      const lastChildEnd = fullHtml.lastIndexOf(lastChildHtml) + lastChildHtml.length;
      if (lastChildEnd < fullHtml.length) {
        const trailing = fullHtml.substring(lastChildEnd);
        console.log(`\nTrailing HTML: "${trailing}"`);
      } else {
        console.log('\nNo trailing HTML (last child goes to end)');
      }
    }
  }
});
