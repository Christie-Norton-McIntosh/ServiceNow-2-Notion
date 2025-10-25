const axios = require('axios');

// Test the exact pattern you mentioned
const html = `<p>The URL is <code>https://<instance-name>.service-now.com/nav_to.do?uri=sn_devops_tool.do?sys_id=<Tool ID></code> for reference.</p>`;

console.log('Testing exact Tool ID pattern...\n');
console.log('Input HTML:', JSON.stringify(html));
console.log();

axios.post('http://localhost:3004/api/W2N', {
  title: 'Exact Tool ID Test',
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
        console.log(`  [${j}] ${hasCode ? '[CODE]' : '[TEXT]'} "${text}"`);
      });
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
