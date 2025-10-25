const axios = require('axios');

// Test span with cmd class
const html = `
<p>Instructions:</p>
<p><span class="ph cmd">Leave the remaining fields empty (default).</span></p>
<p><span class="ph cmd">Click Save to continue.</span></p>
<p>Regular text with <span class="ph">technical term</span> and done.</p>
`;

console.log('Testing <span class="ph cmd"> handling...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'CMD Span Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}:`);
    if (block.paragraph?.rich_text) {
      const fullText = block.paragraph.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Full text: "${fullText}"`);
      
      block.paragraph.rich_text.forEach((rt, j) => {
        const text = rt.text.content;
        const hasCode = rt.annotations?.code;
        const hasBold = rt.annotations?.bold;
        const hasItalic = rt.annotations?.italic;
        let typeStr = '[TEXT]';
        if (hasCode) typeStr = '[CODE]';
        else if (hasBold) typeStr = '[BOLD]';
        else if (hasItalic) typeStr = '[ITALIC]';
        
        // Check for leftover markers
        if (text.includes('__BOLD_START__') || text.includes('__CODE_START__')) {
          console.log(`  ❌ [${j}] ${typeStr} "${text}" <-- CONTAINS MARKERS!`);
        } else {
          console.log(`  ✅ [${j}] ${typeStr} "${text}"`);
        }
      });
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
