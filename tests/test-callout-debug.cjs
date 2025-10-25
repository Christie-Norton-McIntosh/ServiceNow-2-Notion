const axios = require('axios');

// Test the exact scenario - callout with paragraph
const html = `<div class="note">
  <span class="note__title">Note:</span>
  <p>This is the actual content that should appear in the callout.</p>
</div>`;

console.log('Testing callout content extraction...\n');
console.log('HTML input:');
console.log(html);
console.log('\n---\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Callout Debug Test',
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
      console.log(`  Rich text elements: ${block.callout.rich_text.length}`);
      block.callout.rich_text.forEach((rt, j) => {
        console.log(`    [${j}] "${rt.text.content}" (annotations: ${JSON.stringify(rt.annotations)})`);
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
