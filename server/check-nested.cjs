const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkNested(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    // Get top-level blocks
    const topResponse = await notion.blocks.children.list({
      block_id: cleanId,
      page_size: 100
    });
    
    console.log('\n🔍 Checking nested children of list items...\n');
    console.log('='.repeat(80) + '\n');
    
    for (let i = 0; i < topResponse.results.length; i++) {
      const block = topResponse.results[i];
      const blockNum = i + 1;
      
      if (block.has_children && (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item')) {
        const type = block.type;
        const richText = block[type].rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        
        console.log(`Block ${blockNum}: ${type.toUpperCase()}`);
        console.log(`Parent text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
        console.log('');
        
        // Get children
        const childResponse = await notion.blocks.children.list({
          block_id: block.id,
          page_size: 100
        });
        
        console.log(`  📦 Has ${childResponse.results.length} children:\n`);
        
        childResponse.results.forEach((child, childIdx) => {
          const childType = child.type;
          
          if (childType === 'paragraph') {
            const childText = child.paragraph.rich_text.map(rt => rt.plain_text).join('').trim();
            console.log(`    ${childIdx + 1}. PARAGRAPH`);
            console.log(`       "${childText}"`);
            
            if (childText.includes('Relationship')) {
              console.log(`       🔍 FOUND RELATIONSHIP TEXT`);
            }
            console.log('');
          } else if (childType === 'numbered_list_item' || childType === 'bulleted_list_item') {
            const childText = child[childType].rich_text.map(rt => rt.plain_text).join('').trim();
            console.log(`    ${childIdx + 1}. ${childType.toUpperCase()}`);
            console.log(`       "${childText.substring(0, 80)}${childText.length > 80 ? '...' : ''}"`);
            
            if (!childText) {
              console.log(`       ❌ EMPTY LIST ITEM`);
            }
            
            if (childText.includes('Relationship')) {
              console.log(`       🔍 FOUND RELATIONSHIP TEXT`);
            }
            console.log('');
          } else if (childType === 'table') {
            console.log(`    ${childIdx + 1}. TABLE (${child.table.table_width} cols)`);
            console.log('');
          } else if (childType === 'callout') {
            const childText = child.callout.rich_text.map(rt => rt.plain_text).join('').trim();
            console.log(`    ${childIdx + 1}. CALLOUT`);
            console.log(`       "${childText.substring(0, 60)}"`);
            
            const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
            if (titleOnlyPattern.test(childText)) {
              console.log(`       ❌ TITLE-ONLY CALLOUT`);
            }
            console.log('');
          } else {
            console.log(`    ${childIdx + 1}. ${childType.toUpperCase()}`);
            console.log('');
          }
        });
        
        console.log('  ' + '-'.repeat(76) + '\n');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkNested('2b4a89fedba5813690a2d7028920ed6d');
