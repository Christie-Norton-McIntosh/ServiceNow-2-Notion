const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function checkServiceQuery() {
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
  
  const numbered = children[9];
  const addConnections = numbered.numbered_list_item.children[1];
  const inConnectionProps = addConnections.bulleted_list_item.children[2];
  
  const serviceQueryBullet = inConnectionProps._sn2n_deferred_children?.find(c => 
    c[c.type]?.rich_text?.[0]?.text?.content?.includes('Service Query')
  );
  
  if (serviceQueryBullet) {
    console.log('📦 Service Query Properties bullet:');
    console.log(`   Type: ${serviceQueryBullet.type}`);
    console.log(`   Text: "${serviceQueryBullet[serviceQueryBullet.type].rich_text[0]?.text?.content.substring(0, 100)}"`);
    console.log(`   Deferred children: ${serviceQueryBullet._sn2n_deferred_children?.length || 0}\n`);
    
    if (serviceQueryBullet._sn2n_deferred_children) {
      console.log('📋 Deferred children:');
      serviceQueryBullet._sn2n_deferred_children.forEach((child, idx) => {
        const type = child.type;
        const text = child[type]?.rich_text?.[0]?.text?.content || '(no text)';
        console.log(`   [${idx}] ${type}: "${text.substring(0, 100)}"`);
      });
    }
  } else {
    console.log('❌ Service Query bullet not found');
  }
}

checkServiceQuery().catch(console.error);
