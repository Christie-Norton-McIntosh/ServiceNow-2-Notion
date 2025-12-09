#!/usr/bin/env node
/**
 * Check blocks in a Notion page
 */
const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

const pageId = process.argv[2] || '2c4a89fe-dba5-8176-9224-d9484d79ed35';

async function checkPage() {
  try {
    console.log(`📖 Checking page: ${pageId}\n`);
    
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });
    
    console.log(`✅ Page has ${blocks.results.length} blocks:\n`);
    
    const blockCounts = {};
    blocks.results.forEach((block, idx) => {
      blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
      
      const blockType = block.type;
      const blockData = block[blockType];
      let preview = '';
      
      if (blockData?.rich_text) {
        preview = blockData.rich_text.map(rt => rt.text?.content || '').join('').substring(0, 60);
      } else if (blockData?.title) {
        preview = blockData.title.map(t => t.text?.content || '').join('').substring(0, 60);
      } else if (blockType === 'table') {
        preview = `[table: ${blockData?.table_width || '?'} cols]`;
      } else if (blockType === 'image') {
        preview = '[image]';
      }
      
      console.log(`  [${idx+1}] ${blockType}: ${preview}${preview.length > 0 ? '...' : ''}`);
    });
    
    console.log(`\n📊 Block type summary:`);
    Object.entries(blockCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

checkPage();
