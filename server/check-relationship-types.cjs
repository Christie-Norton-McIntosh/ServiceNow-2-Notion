const { Client } = require('@notionhq/client');
require('dotenv').config({ path: '.env' });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  const pageId = '2b4a89fedba5818aa350cb8e1a3c8369';
  const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  
  for (const block of blocks.results) {
    const text = block[block.type]?.rich_text?.[0]?.plain_text || '';
    if (text.includes('In Connection Properties')) {
      const children = await notion.blocks.children.list({ block_id: block.id });
      
      for (let i = 0; i < children.results.length; i++) {
        const child = children.results[i];
        const childText = child[child.type]?.rich_text?.[0]?.plain_text || '';
        
        if (childText.includes('Relationship Types')) {
          console.log(`Found at index ${i}: ${childText.substring(0,60)}`);
          console.log(`Has children: ${child.has_children}`);
          
          if (child.has_children) {
            const gc = await notion.blocks.children.list({ block_id: child.id });
            console.log(`\nChildren (${gc.results.length}):`);
            gc.results.forEach((g, idx) => {
              const gText = g[g.type]?.rich_text?.[0]?.plain_text || g.type;
              console.log(`  [${idx}] ${g.type}: ${gText.substring(0,50)}`);
            });
          }
          return;
        }
      }
    }
  }
})();
