const axios = require('axios');

// Test various kbd tag scenarios
const html = `
<p>UI Labels (should be bold):</p>
<ul>
  <li>Click <kbd class="ph userinput">Save</kbd> button</li>
  <li>Navigate to <kbd class="ph userinput">My GitHub App Certificate</kbd></li>
  <li>Select <kbd>Application Registry</kbd> from menu</li>
</ul>

<p>Technical content (should be code):</p>
<ul>
  <li>URL: <kbd>https://<instance-name>.service-now.com</kbd></li>
  <li>Path: <kbd>/api/now/table/sys_user</kbd></li>
  <li>Field: <kbd>sys_id</kbd></li>
  <li>Domain: <kbd>example.com</kbd></li>
  <li>Variable: <kbd>API_KEY</kbd></li>
  <li>Function: <kbd>getValue()</kbd></li>
</ul>
`;

console.log('Testing comprehensive <kbd> tag handling...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'KBD Comprehensive Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    if (block.paragraph) {
      const text = block.paragraph.rich_text.map(rt => rt.text.content).join('');
      console.log(`Block ${i + 1} (paragraph): ${text}`);
    } else if (block.bulleted_list_item) {
      const richText = block.bulleted_list_item.rich_text;
      console.log(`\nBlock ${i + 1} (list item):`);
      richText.forEach((rt, j) => {
        const text = rt.text.content;
        const hasCode = rt.annotations?.code;
        const hasBold = rt.annotations?.bold;
        let typeStr = hasCode ? '[CODE]' : hasBold ? '[BOLD]' : '[TEXT]';
        console.log(`  [${j}] ${typeStr} "${text}"`);
      });
    }
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
