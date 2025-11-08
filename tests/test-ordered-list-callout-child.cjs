/**
 * Test: Ordered list item 6 should have nested callout as a child block
 */
const axios = require('axios');

const html = `
<ol class="ol">
  <li class="li">Step one</li>
  <li class="li">Step two</li>
  <li class="li">Step three</li>
  <li class="li">Step four</li>
  <li class="li">Step five</li>
  <li class="li">In the Webhook URL field, enter
    <div class="note note note_note">
      <span class="note__title">Note:</span>
      If you are newly creating the tool and don't have the Tool ID yet, leave this blank and return after creation.
    </div>
  </li>
</ol>
`;

(async () => {
  try {
    const res = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Ordered list callout child test',
      contentHtml: html,
      dryRun: true
    });
    const blocks = res.data.data.children;
    const listItems = blocks.filter(b => b.type === 'numbered_list_item');
    const callouts = blocks.filter(b => b.type === 'callout');
    console.log(`Total blocks: ${blocks.length}`);
    console.log(`Found ${listItems.length} numbered_list_item blocks, ${callouts.length} callout blocks`);
    if (callouts.length) {
      callouts.forEach((c,i)=>{
        const txt = c.callout.rich_text.map(rt=>rt.text.content).join('').substring(0,120);
        console.log(`Callout ${i+1}: marker=${c._sn2n_marker||'none'} text="${txt}"`);
      });
    }
    listItems.forEach((b,i) => {
      const text = b.numbered_list_item.rich_text.map(rt => rt.text.content).join('');
      console.log(`Item ${i+1}: ${JSON.stringify(text)} children=${b.numbered_list_item.children? b.numbered_list_item.children.length:0}`);
      if (b.numbered_list_item.children) {
        console.log(`  Children types: ${b.numbered_list_item.children.map(c => c.type).join(',')}`);
      }
    });
    if (listItems.length < 6) {
      console.log('❌ FAIL: Not enough list items');
      return;
    }
    const sixth = listItems[5];
    const sixthText = sixth.numbered_list_item.rich_text.map(rt => rt.text.content).join('');
    const hasCalloutChild = sixth.numbered_list_item.children && sixth.numbered_list_item.children.some(c => c.type === 'callout');
    if (!hasCalloutChild) {
      console.log('❌ FAIL: Sixth item missing callout child');
    } else {
      // Verify callout has expected note content
      const callout = sixth.numbered_list_item.children.find(c => c.type === 'callout');
      const calloutText = callout.callout.rich_text.map(rt => rt.text.content).join('');
      if (/If you are newly creating the tool/.test(calloutText)) {
        console.log('✅ PASS: Callout child present with correct content');
      } else {
        console.log('❌ FAIL: Callout child content mismatch');
      }
    }
  } catch (e) {
    console.error('Error:', e.response?.data || e.message);
  }
})();
