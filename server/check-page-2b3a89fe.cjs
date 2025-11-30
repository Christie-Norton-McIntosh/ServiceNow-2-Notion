const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getPageBlocks(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    console.log(`\n📄 Fetching page: ${cleanId}\n`);
    
    const page = await notion.pages.retrieve({ page_id: cleanId });
    console.log(`📌 Title: ${page.properties.Name?.title?.[0]?.plain_text || 'No title'}\n`);
    
    const blocks = [];
    let cursor;
    
    do {
      const response = await notion.blocks.children.list({
        block_id: cleanId,
        start_cursor: cursor,
        page_size: 100
      });
      blocks.push(...response.results);
      cursor = response.next_cursor;
    } while (cursor);
    
    console.log(`📊 Total blocks: ${blocks.length}\n`);
    
    let listItemCount = 0;
    let calloutCount = 0;
    let tableCount = 0;
    let emptyRichTextCount = 0;
    
    blocks.forEach((block, idx) => {
      const type = block.type;
      
      if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        listItemCount++;
        const richText = block[type].rich_text;
        const text = richText.map(rt => rt.plain_text).join('');
        
        const hasEmptyElements = richText.some(rt => !rt.plain_text || rt.plain_text.trim() === '');
        
        if (hasEmptyElements) {
          emptyRichTextCount++;
          console.log(`❌ Block ${idx + 1}: ${type} has empty rich_text elements`);
          console.log(`   Rich text array (${richText.length} elements):`);
          richText.forEach((rt, i) => {
            console.log(`   [${i}] "${rt.plain_text}" (length: ${rt.plain_text.length})`);
          });
          console.log('');
        }
        
        if (idx < 10) {
          console.log(`✓ Block ${idx + 1}: ${type}`);
          console.log(`  Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
          console.log(`  Rich text elements: ${richText.length}`);
          console.log('');
        }
      }
      
      if (type === 'callout') {
        calloutCount++;
        const richText = block.callout.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        console.log(`📢 Block ${idx + 1}: callout`);
        console.log(`   Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        console.log(`   Rich text elements: ${richText.length}`);
        
        const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
        if (titleOnlyPattern.test(text)) {
          console.log(`   ⚠️ TITLE-ONLY CALLOUT DETECTED`);
        }
        console.log('');
      }
      
      if (type === 'table') {
        tableCount++;
        console.log(`📊 Block ${idx + 1}: table (${block.table.table_width} cols)`);
        console.log('');
      }
    });
    
    console.log(`\n�� Summary:`);
    console.log(`   List items: ${listItemCount}`);
    console.log(`   Callouts: ${calloutCount}`);
    console.log(`   Tables: ${tableCount}`);
    console.log(`   List items with empty rich_text: ${emptyRichTextCount}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

getPageBlocks('2b3a89fedba581f5a028ecfce8338faa');
