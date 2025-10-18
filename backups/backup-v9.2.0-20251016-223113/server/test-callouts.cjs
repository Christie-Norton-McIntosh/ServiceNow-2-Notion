#!/usr/bin/env node
/**
 * Quick manual test for callout detection and mapping.
 * Runs the ServiceNow extractor on a small HTML sample and prints resulting blocks.
 */
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
  const samples = [
    {
      name: 'div.note important',
      html: '<div class="note important"><span class="note__title">Important</span> Always back up your instance.</div>'
    },
    {
      name: 'div.note warning',
      html: '<div class="note warning"><span class="note__title">Warning</span> This action is irreversible.</div>'
    },
    {
      name: 'div.note tip',
      html: '<div class="note tip"><span class="note__title">Tip</span> Use filters to narrow results.</div>'
    },
    {
      name: 'aside.info',
      html: '<aside class="info"><p>Note: You can automate this step.</p></aside>'
    },
    {
      name: 'p starting with Note:',
      html: '<p>Note: Plugins are activated in two batches daily.</p>'
    },
    {
      name: 'ServiceNow itemgroup info',
      html: '<div class="itemgroup info"><p>Tip: Bookmark frequently used records.</p></div>'
    }
  ];

  for (const s of samples) {
    const { blocks } = await extractContentFromHtml(`<main>${s.html}</main>`);
    console.log(`\n=== ${s.name} ===`);
    console.log(JSON.stringify(blocks, null, 2));
  }
})();
