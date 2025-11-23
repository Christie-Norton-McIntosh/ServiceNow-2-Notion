const { Client } = require('@notionhq/client');
require('dotenv').config({ path: '.env' });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  try {
    const pageId = '2b4a89fedba5818aa350cb8e1a3c8369';
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log(`\nPage found: ${page.properties.Name?.title?.[0]?.plain_text || 'Unknown'}`);
    console.log(`Created: ${new Date(page.created_time).toLocaleString()}`);
    
    const blocks = await notion.blocks.children.list({ block_id: pageId });
    console.log(`Total top-level blocks: ${blocks.results.length}`);
    
    // Find "In Connection Properties"
    for (const block of blocks.results) {
      const text = block[block.type]?.rich_text?.[0]?.plain_text || '';
      if (text.includes('In Connection Properties')) {
        const children = await notion.blocks.children.list({ block_id: block.id });
        
        // Find "Relationship Types" item
        for (const child of children.results) {
          const childText = child[child.type]?.rich_text?.[0]?.plain_text || '';
          if (childText.includes('Relationship Types')) {
            console.log(`\nFound list item: "${childText.substring(0,60)}..."`);
            console.log(`Has children: ${child.has_children}`);
            
            if (child.has_children) {
              const gc = await notion.blocks.children.list({ block_id: child.id });
              console.log(`✅ SUCCESS! ${gc.results.length} child block(s):`);
              gc.results.forEach((g, i) => console.log(`  [${i}] ${g.type}`));
            } else {
              console.log(`❌ FAILED - no children`);
            }
            return;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
