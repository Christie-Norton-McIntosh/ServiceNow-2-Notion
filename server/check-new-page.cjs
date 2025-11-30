const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkNewPage(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    const page = await notion.pages.retrieve({ page_id: cleanId });
    const title = page.properties.Name?.title?.[0]?.plain_text || 'No title';
    
    console.log(`\n📄 Page: ${title}`);
    console.log(`📅 Created: ${page.created_time}`);
    console.log(`📝 Last edited: ${page.last_edited_time}\n`);
    
    // Get top-level blocks
    const topResponse = await notion.blocks.children.list({
      block_id: cleanId,
      page_size: 100
    });
    
    console.log(`📊 Total top-level blocks: ${topResponse.results.length}\n`);
    console.log('='.repeat(80) + '\n');
    
    // Check block 10 specifically
    let block10 = topResponse.results[9]; // 0-indexed, so 9 = block 10
    
    if (block10 && block10.has_children) {
      const type = block10.type;
      const text = block10[type].rich_text.map(rt => rt.plain_text).join('').trim();
      
      console.log('🔍 Checking Block 10 (the problematic parent):\n');
      console.log(`Type: ${type}`);
      console.log(`Text: "${text}"`);
      console.log(`Has children: ${block10.has_children}\n`);
      
      // Get its children
      const childResponse = await notion.blocks.children.list({
        block_id: block10.id,
        page_size: 100
      });
      
      console.log(`Children count: ${childResponse.results.length}\n`);
      console.log('-'.repeat(80) + '\n');
      
      childResponse.results.forEach((child, idx) => {
        const childType = child.type;
        
        if (childType === 'bulleted_list_item' || childType === 'numbered_list_item') {
          const childText = child[childType].rich_text.map(rt => rt.plain_text).join('').trim();
          
          console.log(`Child ${idx + 1}: ${childType.toUpperCase()}`);
          console.log(`  Text: "${childText}"`);
          console.log(`  Text length: ${childText.length}`);
          console.log(`  Rich_text elements: ${child[childType].rich_text.length}`);
          
          if (!childText || childText.length === 0) {
            console.log(`  ❌ EMPTY LIST ITEM - THIS IS THE BUG`);
          }
          
          // Show rich_text details if empty
          if (childText.length === 0 && child[childType].rich_text.length > 0) {
            console.log(`  📋 Rich text details:`);
            child[childType].rich_text.forEach((rt, rtIdx) => {
              console.log(`    [${rtIdx}] content: "${rt.plain_text}" (len: ${rt.plain_text.length})`);
            });
          }
          
          console.log('');
        } else if (childType === 'callout') {
          const childText = child.callout.rich_text.map(rt => rt.plain_text).join('').trim();
          console.log(`Child ${idx + 1}: CALLOUT`);
          console.log(`  Text: "${childText}"`);
          
          const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
          if (titleOnlyPattern.test(childText)) {
            console.log(`  ❌ TITLE-ONLY CALLOUT - THIS IS THE BUG`);
          }
          console.log('');
        } else {
          console.log(`Child ${idx + 1}: ${childType.toUpperCase()}`);
          console.log('');
        }
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkNewPage('2b4a89fedba581e7bfa9ea6f8ea4054d');
