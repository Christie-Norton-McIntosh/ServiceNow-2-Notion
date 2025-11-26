const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function examineBlock12() {
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
  
  const block12 = children[12];
  console.log('📦 Block 12:');
  console.log('   Type:', block12.type);
  const text = block12[block12.type]?.rich_text?.[0]?.text?.content || '';
  console.log('   Text:', text.substring(0, 100));
  console.log('   Children:', block12[block12.type]?.children?.length || 0);
  console.log();
  
  if (block12[block12.type]?.children) {
    console.log('📋 Children of block 12:');
    block12[block12.type].children.forEach((child, idx) => {
      const type = child.type;
      const childText = child[type]?.rich_text?.[0]?.text?.content || '';
      console.log(`   [${idx}] ${type}: "${childText.substring(0, 80)}"`);
      
      if (child[type]?.children?.length > 0) {
        console.log(`       └─ ${child[type].children.length} nested children`);
        child[type].children.forEach((grandchild, gidx) => {
          const gtype = grandchild.type;
          const gtext = grandchild[gtype]?.rich_text?.[0]?.text?.content || '';
          console.log(`          [${gidx}] ${gtype}: "${gtext.substring(0, 60)}"`);
        });
      }
    });
  }
  
  // Check if "first 100 results" is correctly ordered
  const child2 = block12[block12.type].children[2];
  if (child2?.type === 'paragraph') {
    const paraText = child2.paragraph.rich_text[0]?.text?.content || '';
    if (paraText.includes('first 100 results')) {
      console.log('\n✅ Child [2] is the "first 100 results" paragraph');
      
      // Check if Load More/Load All are nearby
      const child3 = block12[block12.type].children[3];
      if (child3 && (child3.type === 'bulleted_list_item' || child3.type === 'numbered_list_item')) {
        const child3Text = child3[child3.type].rich_text[0]?.text?.content || '';
        if (child3Text.includes('Load More') || child3Text.includes('Load All')) {
          console.log('✅ Child [3] is a Load More/Load All bullet');
          console.log('\n✅ SUCCESS: Correct ordering!');
        } else {
          console.log('❌ Child [3] is not Load More/Load All:', child3Text.substring(0, 50));
        }
      } else {
        console.log('⚠️  Child [3] type:', child3?.type);
      }
    }
  }
}

examineBlock12().catch(console.error);
