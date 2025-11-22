/**
 * Test expected callout counting for two sibling prereq sections
 */

const cheerio = require('./server/node_modules/cheerio');
const fs = require('fs');

const html = fs.readFileSync('patch/pages/pages-to-update/viewing-api-data-connections-for-a-service-graph-connector-w-2025-11-22T05-33-54.html', 'utf8');

const $ = cheerio.load(html || '');
const matched = new Set();

console.log('🔍 Testing expected callout counting...\n');

let calloutIndex = 0;
$('*').each((i, el) => {
  try {
    const $el = $(el);
    const cls = ($el.attr('class') || '').toString();
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = ($el.attr('role') || '').toString();

    const isDivNote = (tag === 'div' && /note/i.test(cls));
    const isPrereq = ((tag === 'section' || (tag === 'div' && /section/i.test(cls))) && /prereq/i.test(cls));
    const hasNoteRole = /note/i.test(role);

    if (isDivNote || isPrereq || hasNoteRole) {
      // Check for callout ancestor
      let isNested = false;
      const parents = $el.parents().toArray();
      
      for (const parent of parents) {
        const $parent = $(parent);
        const parentCls = ($parent.attr('class') || '').toString();
        const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
        const parentRole = ($parent.attr('role') || '').toString();
        
        const parentIsDivNote = (parentTag === 'div' && /note/i.test(parentCls));
        const parentIsPrereq = ((parentTag === 'section' || (parentTag === 'div' && /section/i.test(parentCls))) && /prereq/i.test(parentCls));
        const parentHasNoteRole = /note/i.test(parentRole);
        
        if (parentIsDivNote || parentIsPrereq || parentHasNoteRole) {
          console.log(`  ⚠️  NESTED: <${tag} class="${cls}"> has callout ancestor <${parentTag} class="${parentCls}">`);
          isNested = true;
          break;
        }
      }
      
      if (!isNested) {
        const text = $el.text().trim().substring(0, 60);
        console.log(`  ✅ COUNTED: <${tag}${cls ? ` class="${cls}"` : ''}> - "${text}..."`);
        calloutIndex++;
        matched.add(`callout-${calloutIndex}`);
      }
    }
  } catch (innerE) {
    // ignore
  }
});

console.log(`\n📊 Expected callouts: ${matched.size}`);
console.log('Expected: 2 (two sibling prereq sections)');

if (matched.size === 2) {
  console.log('✅ CORRECT: Both prereq sections counted');
} else {
  console.log('❌ INCORRECT: Should be 2, got', matched.size);
}
