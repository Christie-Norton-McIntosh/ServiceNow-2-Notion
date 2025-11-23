#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, 'server/.env') });
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  async function getAllBlocks(blockId, depth = 0) {
    const blocks = [];
    const response = await notion.blocks.children.list({ block_id: blockId, page_size: 100 });
    for (const block of response.results) {
      blocks.push({ block, depth });
      if (block.has_children) {
        const children = await getAllBlocks(block.id, depth + 1);
        blocks.push(...children);
      }
    }
    return blocks;
  }
  
  const pageId = process.argv[2] || '2b4a89fedba581fe8838dbf1b4a845c4';
  console.log(`Searching page ${pageId}...\n`);
  const allBlocks = await getAllBlocks(pageId);
  console.log(`Total blocks: ${allBlocks.length}\n`);
  console.log('Searching for blocks with "add filter" text...\n');
  
  for (let i = 0; i < allBlocks.length; i++) {
    const { block, depth } = allBlocks[i];
    const blockType = block.type;
    if (blockType === 'numbered_list_item' || blockType === 'bulleted_list_item') {
      const text = block[blockType].rich_text.map(rt => rt.text?.content || '').join('');
      if (text.toLowerCase().includes('add filter')) {
        console.log(`[${String(i).padStart(3, '0')}] ${blockType} (depth ${depth}):`);
        console.log(`  ${text}\n`);
      }
    }
  }
})();
