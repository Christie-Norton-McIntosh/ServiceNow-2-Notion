const fs = require('fs');
const html = fs.readFileSync('tmp/Add-or-modify.html', 'utf8');

fetch('http://localhost:3004/api/W2N', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Add or modify Risk Conditions',
    databaseId: 'dummy',
    content: html,
    dryRun: true
  })
})
.then(r => r.json())
.then(response => {
  const children = response.data.children || [];
  console.log('Total blocks:', children.length);
  
  // Search ALL blocks for the text
  const searchText = 'In the following example';
  let found = false;
  
  children.forEach((b, idx) => {
    const extractText = (block) => {
      if (block.paragraph?.rich_text) return block.paragraph.rich_text.map(rt => rt.text?.content || '').join('');
      if (block.numbered_list_item?.rich_text) return block.numbered_list_item.rich_text.map(rt => rt.text?.content || '').join('');
      if (block.bulleted_list_item?.rich_text) return block.bulleted_list_item.rich_text.map(rt => rt.text?.content || '').join('');
      return '';
    };
    
    const text = extractText(b);
    if (text.includes(searchText)) {
      console.log('FOUND at index', idx, 'type:', b.type);
      console.log('Text:', text.substring(0, 120));
      found = true;
    }
  });
  
  if (found === false) {
    console.log('NOT FOUND in any block');
    console.log('Checking source HTML...');
    if (html.includes(searchText)) {
      console.log('Text EXISTS in source HTML');
    } else {
      console.log('Text NOT in source HTML');
    }
  }
})
.catch(e => console.error('Error:', e));
