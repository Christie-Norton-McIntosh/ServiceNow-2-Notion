const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkTopLevel(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    const response = await notion.blocks.children.list({
      block_id: cleanId,
      page_size: 100
    });
    
    console.log(`\n📊 Found ${response.results.length} top-level blocks\n`);
    console.log('='.repeat(80) + '\n');
    
    let foundRelationshipText = false;
    
    response.results.forEach((block, idx) => {
      const type = block.type;
      const blockNum = idx + 1;
      
      if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
        const richText = block[type].rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        const hasChildren = block.has_children;
        
        console.log(`${blockNum}. ${type.toUpperCase()}${hasChildren ? ' (has children)' : ''}`);
        console.log(`   Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        console.log(`   Rich text elements: ${richText.length}`);
        
        if (!text) {
          console.log(`   ❌ EMPTY LIST ITEM`);
        }
        
        if (text.includes('Relationship Levels') || text.includes('Relationship Types')) {
          console.log(`   🔍 KEY MATCH`);
          foundRelationshipText = true;
        }
        
        console.log('');
      }
      
      if (type === 'paragraph') {
        const richText = block.paragraph.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        
        if (text.includes('Relationship') || text.includes('Connection UI')) {
          console.log(`${blockNum}. PARAGRAPH`);
          console.log(`   Text: "${text}"`);
          console.log('');
        }
      }
      
      if (type === 'callout') {
        const richText = block.callout.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        const icon = block.callout.icon?.emoji || '📌';
        
        console.log(`${blockNum}. CALLOUT ${icon}`);
        console.log(`   Text: "${text.substring(0, 100)}"`);
        
        const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
        if (titleOnlyPattern.test(text)) {
          console.log(`   ❌ TITLE-ONLY`);
        }
        console.log('');
      }
      
      if (type === 'table') {
        console.log(`${blockNum}. TABLE (${block.table.table_width} cols)`);
        console.log('');
      }
    });
    
    if (!foundRelationshipText) {
      console.log('⚠️ Did not find "Relationship Levels" or "Relationship Types" in list items');
      console.log('   This text might be in a paragraph or nested child block instead\n');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTopLevel('2b4a89fedba5813690a2d7028920ed6d');
