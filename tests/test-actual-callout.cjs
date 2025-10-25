const axios = require('axios');

// Exact HTML from user
const actualHTML = `<div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div>`;

console.log('Testing actual ServiceNow HTML...\n');
console.log('HTML:', actualHTML);
console.log('\n---\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Actual ServiceNow Callout',
  contentHtml: actualHTML,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    if (block.callout) {
      console.log(`  Color: ${block.callout.color}`);
      console.log(`  Icon: ${block.callout.icon.emoji}`);
      console.log(`  Rich text elements: ${block.callout.rich_text.length}`);
      block.callout.rich_text.forEach((rt, j) => {
        console.log(`    [${j}] "${rt.text.content}"`);
      });
      const fullContent = block.callout.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Full content: "${fullContent}"`);
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
