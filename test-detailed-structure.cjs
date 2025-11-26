const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function showDetailedStructure() {
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
  console.log('=== BLOCK 12 STRUCTURE ===\n');
  console.log(`Type: ${block12.type}`);
  console.log(`Text: "${block12[block12.type].rich_text[0]?.text?.content.substring(0, 40)}..."`);
  console.log(`Children: ${block12[block12.type].children.length}\n`);
  
  block12[block12.type].children.forEach((child, idx) => {
    const type = child.type;
    const text = child[type]?.rich_text?.[0]?.text?.content || '';
    console.log(`[${idx}] ${type}:`);
    console.log(`    Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    if (child[type]?.children?.length > 0) {
      console.log(`    Children: ${child[type].children.length}`);
      child[type].children.forEach((gc, gidx) => {
        const gtype = gc.type;
        const gtext = gc[gtype]?.rich_text?.[0]?.text?.content || '';
        console.log(`      [${gidx}] ${gtype}: "${gtext.substring(0, 80)}"`);
      });
    }
    console.log();
  });
}

showDetailedStructure().catch(console.error);
