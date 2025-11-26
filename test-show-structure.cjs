const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function testStructure() {
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
  
  const { children } = await response.json();
  
  // Find the numbered_list_item at index 9
  const numbered = children[9];
  console.log('📦 Block 9:', numbered.type);
  console.log('   Children:', numbered.numbered_list_item.children.length);
  
  // Find "Add connections" bullet
  const addConnections = numbered.numbered_list_item.children[1];
  console.log('\n📦 Add connections bullet:');
  console.log('   Type:', addConnections.type);
  console.log('   Children:', addConnections.bulleted_list_item.children.length);
  
  // Find "In Connection Properties" numbered item  
  const inConnectionProps = addConnections.bulleted_list_item.children[2];
  console.log('\n📦 In Connection Properties item:');
  console.log('   Type:', inConnectionProps.type);
  console.log('   Text:', inConnectionProps.numbered_list_item.rich_text[0].text.content.substring(0, 50));
  console.log('   Children:', inConnectionProps.numbered_list_item.children?.length || 0);
  console.log('   Deferred:', inConnectionProps._sn2n_deferred_children?.length || 0);
  
  if (inConnectionProps.numbered_list_item.children?.length > 0) {
    console.log('\n❌ FAIL: Still has immediate children at depth 2');
  } else {
    console.log('\n✅ SUCCESS: No immediate children (would violate nesting limit)');
  }
}

testStructure().catch(console.error);
