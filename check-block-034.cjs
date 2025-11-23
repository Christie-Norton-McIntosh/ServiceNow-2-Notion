#!/usr/bin/env node

require('dotenv').config({ path: require('path').join(__dirname, 'server/.env') });

const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  try {
    console.log('Fetching ALL blocks recursively...');
    
    async function getAllBlocks(blockId, depth = 0) {
      const blocks = [];
      const response = await notion.blocks.children.list({
        block_id: blockId,
        page_size: 100
      });
      
      for (const block of response.results) {
        blocks.push({ block, depth });
        if (block.has_children) {
          const children = await getAllBlocks(block.id, depth + 1);
          blocks.push(...children);
        }
      }
      
      return blocks;
    }
    
    const allBlocks = await getAllBlocks('2b4a89fedba581d18713fc5af772b3d8');
    console.log('Total blocks (including children):', allBlocks.length);
    
    // List all numbered_list_item blocks
    console.log('\nAll numbered_list_item blocks:');
    for (let i = 0; i < allBlocks.length; i++) {
      const { block, depth } = allBlocks[i];
      if (block.type === 'numbered_list_item') {
        const text = block.numbered_list_item.rich_text.map(rt => rt.text?.content || '').join('');
        const preview = text.substring(0, 80);
        console.log(`[${String(i).padStart(3, '0')}] (depth ${depth}) ${preview}${text.length > 80 ? '...' : ''}`);
      }
    }
    
    // Find the block with "Add filters to a class node" text
    let targetBlock = null;
    let blockIndex = -1;
    for (let i = 0; i < allBlocks.length; i++) {
      const { block } = allBlocks[i];
      if (block.type === 'numbered_list_item') {
        const text = block.numbered_list_item.rich_text.map(rt => rt.text?.content || '').join('');
        if (text.includes('Add filters to a class') || text.includes('Apply filters to narrow')) {
          targetBlock = block;
          blockIndex = i;
          console.log(`\nFound target block at index [${String(i).padStart(3, '0')}]`);
          break;
        }
      }
    }
    
    if (targetBlock && targetBlock.type === 'numbered_list_item') {
      const richText = targetBlock.numbered_list_item.rich_text;
      console.log('\nBlock rich_text array length:', richText.length);
      richText.forEach((rt, idx) => {
        console.log(`  [${idx}] text.content: "${rt.text?.content}"`);
      });
      const fullText = richText.map(rt => rt.text?.content || '').join('');
      console.log('\nFull text:');
      console.log(fullText);
      console.log('\nContains "For example":', fullText.includes('For example'));
    } else {
      console.log('Target block not found!');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
})();
