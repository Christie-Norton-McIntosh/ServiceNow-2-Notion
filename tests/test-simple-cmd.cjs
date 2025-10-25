const axios = require('axios');

// Test with exact HTML structure
const html = `<span class="ph cmd">Leave the remaining fields empty (default).</span>`;

console.log('Testing exact span structure...\n');
console.log('Input HTML:', html, '\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Simple CMD Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    if (block.paragraph?.rich_text) {
      const fullText = block.paragraph.rich_text.map(rt => rt.text.content).join('');
      console.log(`Block ${i + 1}: "${fullText}"`);
      
      block.paragraph.rich_text.forEach((rt, j) => {
        const annotations = rt.annotations || {};
        const typeStr = annotations.code ? '[CODE]' : annotations.bold ? '[BOLD]' : '[TEXT]';
        console.log(`  [${j}] ${typeStr} "${rt.text.content}"`);
        
        if (rt.text.content.includes('__')) {
          console.log(`    ❌ WARNING: Contains marker: ${rt.text.content}`);
        }
      });
    }
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
