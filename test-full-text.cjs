const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function showFullText() {
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
  
  function findBlock(blocks, searchText) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const type = block.type;
      const text = block[type]?.rich_text?.[0]?.text?.content || '';
      
      if (text.includes(searchText)) {
        return { block, index: i };
      }
      
      if (block[type]?.children) {
        const found = findBlock(block[type].children, searchText);
        if (found) return found;
      }
    }
    return null;
  }
  
  const result = findBlock(children, 'Add filters to a class node');
  if (!result) {
    console.log('❌ Not found');
    return;
  }
  
  const blockChildren = result.block.bulleted_list_item.children || [];
  
  blockChildren.forEach((child, idx) => {
    const type = child.type;
    const text = child[type]?.rich_text?.[0]?.text?.content || '';
    console.log(`[${idx}] ${type}:`);
    console.log(`    ${text}\n`);
  });
}

showFullText().catch(console.error);
