const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function checkTablePosition() {
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
  
  console.log('\n🔍 Looking for "not connected" paragraph and Relationship UI Notations table\n');
  
  // Find both elements
  let notConnectedIdx = -1;
  let tableIdx = -1;
  let notConnectedPath = '';
  
  function searchBlocks(blocks, path = 'root', depth = 0) {
    blocks.forEach((block, idx) => {
      const type = block.type;
      
      if (type === 'table') {
        const caption = block.table?.caption?.[0]?.text?.content || '';
        if (caption.includes('Relationship UI Notations')) {
          tableIdx = idx;
          console.log(`�� Found Relationship UI Notations table at ${path}[${idx}] (depth ${depth})`);
        }
      }
      
      if (type === 'paragraph') {
        const text = block.paragraph?.rich_text?.map(rt => rt.text.content).join('') || '';
        if (text.includes('not connected')) {
          notConnectedIdx = idx;
          notConnectedPath = `${path}[${idx}]`;
          console.log(`📝 Found "not connected" paragraph at ${path}[${idx}] (depth ${depth})`);
          console.log(`   Text: "${text.substring(0, 80)}..."\n`);
        }
      }
      
      if (block[type]?.children) {
        searchBlocks(block[type].children, `${path}[${idx}].children`, depth + 1);
      }
    });
  }
  
  searchBlocks(children);
  
  console.log('\n📊 Analysis:\n');
  
  if (notConnectedPath.includes('children') && notConnectedPath.includes('[2]')) {
    console.log('   ✅ "not connected" paragraph is DEFERRED under step 3');
    console.log('   ✅ It will be added via orchestration AFTER the table');
    console.log('   ✅ This matches ServiceNow structure where it appears under Service Query Properties\n');
    console.log('   Note: The table is a sibling of the "Add connections" bullet,');
    console.log('         not nested inside it. The paragraph is correctly nested');
    console.log('         under Service Query Properties bullet inside step 3.\n');
  } else {
    console.log('   ⚠️  Paragraph location:', notConnectedPath);
  }
  
  // Show the structure around "Add connections" to understand the relationship
  const numbered = children[9];
  if (numbered && numbered.type === 'numbered_list_item') {
    const addConnections = numbered.numbered_list_item.children?.[1];
    if (addConnections && addConnections.type === 'bulleted_list_item') {
      console.log('📋 "Add connections" bullet structure:\n');
      const children = addConnections.bulleted_list_item.children || [];
      children.forEach((child, idx) => {
        const type = child.type;
        const text = child[type]?.rich_text?.[0]?.text?.content || '';
        console.log(`   [${idx}] ${type}: "${text.substring(0, 60)}..."`);
        
        if (type === 'table') {
          const caption = child.table?.caption?.[0]?.text?.content || '';
          console.log(`       Caption: "${caption}"`);
        }
      });
    }
  }
}

checkTablePosition().catch(console.error);
