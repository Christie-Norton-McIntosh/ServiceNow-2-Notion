const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function checkDeferredChildren() {
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
  const firstPara = block12.bulleted_list_item.children[2];
  
  console.log('📦 "first 100 results" paragraph:');
  console.log('   Type:', firstPara.type);
  console.log('   Text:', firstPara.paragraph.rich_text[0]?.text?.content);
  console.log('   Children:', firstPara.paragraph.children?.length || 0);
  console.log('   Deferred children:', firstPara._sn2n_deferred_children?.length || 0);
  
  if (firstPara._sn2n_deferred_children && firstPara._sn2n_deferred_children.length > 0) {
    console.log('\n📋 Deferred children:');
    firstPara._sn2n_deferred_children.forEach((child, idx) => {
      const type = child.type;
      const text = child[type]?.rich_text?.[0]?.text?.content || '';
      console.log(`   [${idx}] ${type}: "${text.substring(0, 80)}"`);
    });
    
    const hasLoadMore = firstPara._sn2n_deferred_children.some(c => 
      c[c.type]?.rich_text?.[0]?.text?.content?.includes('Load More')
    );
    const hasLoadAll = firstPara._sn2n_deferred_children.some(c => 
      c[c.type]?.rich_text?.[0]?.text?.content?.includes('Load All')
    );
    
    if (hasLoadMore && hasLoadAll) {
      console.log('\n✅ Load More and Load All bullets are deferred (will be added via orchestration)');
      console.log('✅ This is CORRECT - paragraph has the bullets as deferred children');
    }
  } else {
    console.log('\n❌ No deferred children found - bullets may be missing!');
  }
}

checkDeferredChildren().catch(console.error);
