const { Client } = require('@notionhq/client');
require('dotenv').config({ path: '.env' });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  const pageId = '2b4a89fedba5818aa350cb8e1a3c8369';
  const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  
  for (let i = 0; i < blocks.results.length; i++) {
    const block = blocks.results[i];
    const text = block[block.type]?.rich_text?.[0]?.plain_text || '';
    
    if (text.includes('In Connection Properties')) {
      console.log(`\n✅ Found "In Connection Properties" section (child ${i})`);
      
      if (block.has_children) {
        const children = await notion.blocks.children.list({ block_id: block.id });
        console.log(`Children count: ${children.results.length}\n`);
        
        for (let j = 0; j < children.results.length; j++) {
          const child = children.results[j];
          const childText = child[child.type]?.rich_text?.[0]?.plain_text || '';
          
          if (childText.includes('Relationship Types')) {
            console.log(`[${j}] Found target list item:`);
            console.log(`    Type: ${child.type}`);
            console.log(`    Text: "${childText.substring(0,60)}..."`);
            console.log(`    Has children: ${child.has_children}`);
            
            if (child.has_children) {
              const grandchildren = await notion.blocks.children.list({ block_id: child.id });
              console.log(`\n    ✅ SUCCESS! List item has ${grandchildren.results.length} child(ren):\n`);
              grandchildren.results.forEach((gc, gcIdx) => {
                const gcText = gc[gc.type]?.rich_text?.[0]?.plain_text || '[no text]';
                console.log(`       [${gcIdx}] ${gc.type}: ${gcText.substring(0,50)}`);
              });
            } else {
              console.log(`\n    ❌ FAILED - No children (table still missing)`);
            }
            break;
          }
        }
      }
      break;
    }
  }
})();
