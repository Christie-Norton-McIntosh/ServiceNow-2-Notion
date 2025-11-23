const { Client } = require('@notionhq/client');
require('dotenv').config({ path: '.env' });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  const pageId = '2b4a89fedba581519154f0e51a562da9';
  const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 100 });
  
  for (let i = 0; i < blocks.results.length; i++) {
    const block = blocks.results[i];
    const text = block[block.type]?.rich_text?.[0]?.plain_text || '';
    
    if (text.includes('In Connection Properties')) {
      console.log(`\nChild ${i}: ${text.substring(0,60)}`);
      
      if (block.has_children) {
        const children = await notion.blocks.children.list({ block_id: block.id });
        console.log(`Children count: ${children.results.length}`);
        
        for (let j = 0; j < children.results.length; j++) {
          const child = children.results[j];
          const childText = child[child.type]?.rich_text?.[0]?.plain_text || '';
          if (childText.includes('Relationship Types')) {
            console.log(`\n[${j}] numbered_list_item: ${childText.substring(0,60)}`);
            console.log(`Has children: ${child.has_children}`);
            
            if (child.has_children) {
              const grandchildren = await notion.blocks.children.list({ block_id: child.id });
              console.log(`\nChildren of this item:`);
              grandchildren.results.forEach((gc, gcIdx) => {
                const gcText = gc[gc.type]?.rich_text?.[0]?.plain_text || gc.type;
                console.log(`  [${gcIdx}] ${gc.type}: ${gcText.substring(0,50)}`);
              });
            } else {
              console.log(`NO CHILDREN - Table missing!`);
            }
          }
        }
      }
      break;
    }
  }
})();
