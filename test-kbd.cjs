const axios = require('axios');

// Test kbd tag handling
const html = `
<p>Navigate to <kbd class="ph userinput">My GitHub App Certificate</kbd> in the settings.</p>
<p>Enter the URL <kbd>https://<instance-name>.service-now.com</kbd> in the field.</p>
`;

console.log('Testing <kbd> tag handling...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'KBD Tag Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}:`);
    if (block.paragraph?.rich_text) {
      block.paragraph.rich_text.forEach((rt, j) => {
        const text = rt.text.content;
        const hasCode = rt.annotations?.code;
        const hasBold = rt.annotations?.bold;
        const hasItalic = rt.annotations?.italic;
        let typeStr = '[TEXT]';
        if (hasCode) typeStr = '[CODE]';
        else if (hasBold) typeStr = '[BOLD]';
        else if (hasItalic) typeStr = '[ITALIC]';
        console.log(`  [${j}] ${typeStr} "${text}"`);
      });
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
