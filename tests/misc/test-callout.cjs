const axios = require('axios');

// Test callout with paragraph inside
const html = `
<div class="note">
  <span class="note__title">Note:</span>
  <p>If you are newly creating the tool and don't have the Tool ID, you can enter the webhook URL without the Tool ID and configure it later.</p>
</div>
`;

console.log('Testing callout with paragraph...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Callout Test',
  contentHtml: html,
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
      console.log(`  Content: "${block.callout.rich_text.map(rt => rt.text.content).join('')}"`);
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
