const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function findRun() {
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test',
      databaseId: 'test',
      contentHtml: html,
      dryRun: true
    })
  });
  
  const responseData = await response.json();
  const children = responseData.data?.children || [];
  
  function searchBlocks(blocks, path = 'root') {
    blocks.forEach((block, idx) => {
      const type = block.type;
      const text = block[type]?.rich_text?.[0]?.text?.content || '';
      
      if (text.toLowerCase().includes('run') || text.toLowerCase().includes('first 100')) {
        console.log(`${path}[${idx}] ${type}: "${text.substring(0, 100)}"`);
      }
      
      if (block[type]?.children) {
        searchBlocks(block[type].children, `${path}[${idx}].children`);
      }
    });
  }
  
  searchBlocks(children);
}

findRun().catch(console.error);
