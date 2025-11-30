const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function testSelectRunOrdering() {
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
  
  if (!response.ok) {
    console.error('❌ API Error:', response.status);
    return;
  }
  
  const responseData = await response.json();
  const children = responseData.data?.children || [];
  
  console.log(`📦 Total blocks: ${children.length}\n`);
  
  // Find "Select Run" bullet - it should be in a "What to do next" section
  let selectRunBlock = null;
  let blockIndex = -1;
  
  for (let i = 0; i < children.length; i++) {
    const block = children[i];
    if (block.type === 'bulleted_list_item') {
      const text = block.bulleted_list_item.rich_text[0]?.text?.content || '';
      if (text.includes('Select') && text.includes('Run')) {
        selectRunBlock = block;
        blockIndex = i;
        break;
      }
    }
  }
  
  if (!selectRunBlock) {
    console.log('❌ Could not find "Select Run" bullet');
    return;
  }
  
  console.log(`✅ Found "Select Run" bullet at index ${blockIndex}`);
  const selectRunChildren = selectRunBlock.bulleted_list_item.children || [];
  console.log(`   Children: ${selectRunChildren.length}\n`);
  
  // List all children
  console.log('📋 Children of "Select Run":');
  selectRunChildren.forEach((child, idx) => {
    const type = child.type;
    let text = '';
    if (child[type]?.rich_text?.[0]?.text?.content) {
      text = child[type].rich_text[0].text.content.substring(0, 80);
    } else if (type === 'paragraph') {
      text = '(paragraph)';
    }
    console.log(`   [${idx}] ${type}: "${text}"`);
    
    // Check for nested children
    if (child[type]?.children?.length > 0) {
      console.log(`       └─ ${child[type].children.length} nested children`);
    }
  });
  
  // Check ordering: should be paragraph ("first 100 results") THEN bullets
  const firstChild = selectRunChildren[0];
  if (firstChild && firstChild.type === 'paragraph') {
    const text = firstChild.paragraph.rich_text[0]?.text?.content || '';
    if (text.includes('first 100 results')) {
      console.log('\n✅ SUCCESS: "first 100 results" paragraph is first child');
    } else {
      console.log('\n⚠️  First child is a paragraph but not the expected one');
    }
  } else {
    console.log(`\n❌ FAIL: First child is ${firstChild?.type}, not a paragraph with "first 100 results"`);
  }
  
  // Check if Load More/Load All bullets are immediate children
  const loadMoreIdx = selectRunChildren.findIndex(c => 
    c.type === 'bulleted_list_item' && 
    c.bulleted_list_item.rich_text[0]?.text?.content?.includes('Load More')
  );
  const loadAllIdx = selectRunChildren.findIndex(c => 
    c.type === 'bulleted_list_item' && 
    c.bulleted_list_item.rich_text[0]?.text?.content?.includes('Load All')
  );
  
  if (loadMoreIdx > 0 && loadAllIdx > 0) {
    console.log(`✅ Load More Results at index ${loadMoreIdx}`);
    console.log(`✅ Load All Results at index ${loadAllIdx}`);
    console.log('\n✅ Correct order: paragraph first, then bullets');
  } else {
    console.log('\n⚠️  Could not find Load More/Load All bullets as immediate children');
  }
}

testSelectRunOrdering().catch(console.error);
