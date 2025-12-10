const fs = require('fs');
const { extractExpectedCallouts } = require('./services/servicenow.cjs');

// Read the failed page HTML
const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-the-legacy-ibm-pvu-process-pack-failure-2025-12-08T07-16-03.html';
const htmlContent = fs.readFileSync(htmlFile, 'utf8');

// Extract the HTML body
const htmlStart = htmlContent.indexOf('-->') + 3;
const html = htmlContent.substring(htmlStart);

console.log('\n📊 Testing extractExpectedCallouts() on IBM PVU page\n');

try {
  const result = extractExpectedCallouts(html);
  console.log(`Expected callouts: ${result}`);
  console.log(`Expected should be: 0 (callout is inside table, should be skipped)`);
} catch (error) {
  console.error(`Error: ${error.message}`);
  console.log('\nFunction may not be exported. Testing logic manually instead...');
  
  // Run the logic inline
  const cheerio = require('cheerio');
  const $ = cheerio.load(html, { decodeEntities: false });
  
  let calloutIndex = 0;
  const matched = new Set();

  $('div, section').each((i, el) => {
    const $el = $(el);
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const cls = ($el.attr('class') || '').toString();
    const role = ($el.attr('role') || '').toString();

    const isDivNote = (tag === 'div' && /note/i.test(cls));
    const isPrereq = ((tag === 'section' || (tag === 'div' && /section/i.test(cls))) && /prereq/i.test(cls));
    const hasNoteRole = /note/i.test(role);

    if (isDivNote || isPrereq || hasNoteRole) {
      // Check if inside table
      let isInTable = false;
      const parents = $el.parents().toArray();
      for (const parent of parents) {
        const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
        if (parentTag === 'table' || parentTag === 'thead' || parentTag === 'tbody' || parentTag === 'tr' || parentTag === 'td' || parentTag === 'th') {
          isInTable = true;
          break;
        }
      }

      if (isInTable) {
        console.log(`  [SKIP] Callout inside table: ${cls.substring(0,30)}`);
        return;
      }

      // Check if nested
      let isNested = false;
      for (const parent of parents) {
        const $parent = $(parent);
        const parentCls = ($parent.attr('class') || '').toString();
        const parentTag = parent.tagName ? parent.tagName.toLowerCase() : '';
        const parentRole = ($parent.attr('role') || '').toString();

        const parentIsDivNote = (parentTag === 'div' && /note/i.test(parentCls));
        const parentIsPrereq = ((parentTag === 'section' || (parentTag === 'div' && /section/i.test(parentCls))) && /prereq/i.test(parentCls));
        const parentHasNoteRole = /note/i.test(parentRole);

        if (parentIsDivNote || parentIsPrereq || parentHasNoteRole) {
          isNested = true;
          break;
        }
      }

      if (isNested) {
        console.log(`  [SKIP] Nested callout`);
        return;
      }

      calloutIndex++;
      matched.add(`callout-${calloutIndex}`);
      console.log(`  [COUNT] Callout #${calloutIndex}: ${cls.substring(0,30)} - ${$el.text().substring(0,40)}`);
    }
  });

  console.log(`\n✅ Final expectedCallouts count: ${calloutIndex}`);
}

