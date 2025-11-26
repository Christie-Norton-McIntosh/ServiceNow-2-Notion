const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function showStructure() {
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
  
  // Get step 3
  const step3 = children[9];
  if (!step3 || step3.type !== 'numbered_list_item') return;
  
  console.log('\n📋 Step 3 Full Structure:\n');
  
  const step3Children = step3.numbered_list_item.children || [];
  step3Children.forEach((child, idx) => {
    const type = child.type;
    const text = child[type]?.rich_text?.map(rt => rt.text.content).join('') || '';
    console.log(`[${idx}] ${type}: "${text.substring(0, 80)}..."`);
    
    if (child[type]?.children) {
      const subChildren = child[type].children || [];
      console.log(`    Has ${subChildren.length} children:`);
      subChildren.forEach((subChild, subIdx) => {
        const subType = subChild.type;
        const subText = subChild[subType]?.rich_text?.map(rt => rt.text.content).join('') || '';
        console.log(`    [${subIdx}] ${subType}: "${subText.substring(0, 60)}..."`);
      });
    }
  });
  
  console.log('\n\n🔍 Detailed "Add connections" bullet ([1]):\n');
  const addConnections = step3Children[1];
  if (addConnections && addConnections.type === 'bulleted_list_item') {
    const addConnChildren = addConnections.bulleted_list_item.children || [];
    addConnChildren.forEach((child, idx) => {
      const type = child.type;
      
      if (type === 'numbered_list_item') {
        const text = child[type]?.rich_text?.map(rt => rt.text.content).join('') || '';
        console.log(`[${idx}] numbered_list_item: "${text.substring(0, 100)}"`);
      } else if (type === 'heading_3') {
        const text = child[type]?.rich_text?.map(rt => rt.text.content).join('') || '';
        console.log(`[${idx}] heading_3: "${text}"`);
      } else if (type === 'table') {
        console.log(`[${idx}] table (${child.table.table_width} cols x ${child.table.children?.length || 0} rows)`);
        const caption = child.table?.caption?.[0]?.text?.content || '(no caption)';
        console.log(`     Caption: "${caption}"`);
      } else if (type === 'paragraph') {
        const text = child[type]?.rich_text?.map(rt => rt.text.content).join('') || '';
        console.log(`[${idx}] paragraph: "${text.substring(0, 100)}..."`);
      }
    });
  }
}

showStructure().catch(console.error);
