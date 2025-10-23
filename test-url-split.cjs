const axios = require('axios');

const html = `<p>URL: <code>https://<instance-name>.service-now.com/api</code> is the endpoint.</p>`;

console.log('Testing URL split issue...\n');
console.log('Input HTML:', JSON.stringify(html));
console.log('Contains newline?', html.includes('\n'));
console.log();

axios.post('http://localhost:3004/api/W2N', {
  title: 'URL Split Test',
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
