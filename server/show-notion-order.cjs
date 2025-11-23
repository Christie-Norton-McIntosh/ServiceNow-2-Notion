/**
 * Display the order of blocks in a Notion page
 * Usage: node show-notion-order.cjs <pageId>
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: '.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function showPageOrder(pageId) {
  console.log('\n' + '='.repeat(100));
  console.log('NOTION PAGE BLOCK ORDER');
  console.log('='.repeat(100));
  
  let globalIndex = 0;
  
  async function walkBlocks(blockId, depth = 0) {
    const response = await notion.blocks.children.list({ 
      block_id: blockId,
      page_size: 100 
    });
    
    for (const block of response.results) {
      const type = block.type;
      let text = '';
      
      if (type === 'table') {
        text = '[TABLE]';
      } else if (type === 'image') {
        text = '[IMAGE]';
      } else if (type === 'video') {
        text = '[VIDEO]';
      } else if (type === 'callout') {
        const emoji = block.callout.icon?.emoji || '📝';
        text = `${emoji} ${block.callout.rich_text.map(rt => rt.plain_text).join('')}`;
      } else if (block[type]?.rich_text) {
        text = block[type].rich_text.map(rt => rt.plain_text).join('');
      } else if (block[type]?.caption) {
        text = block[type].caption.map(rt => rt.plain_text).join('');
      }
      
      text = text.trim().replace(/\s+/g, ' ');
      const preview = text.substring(0, 90);
      
      const indent = '  '.repeat(depth);
      const typeLabel = type.padEnd(20);
      const indexLabel = `[${String(globalIndex).padStart(3, '0')}]`;
      
      console.log(`${indexLabel} ${indent}${typeLabel} ${preview}`);
      
      globalIndex++;
      
      // Recurse into children
      if (block.has_children) {
        await walkBlocks(block.id, depth + 1);
      }
    }
  }
  
  await walkBlocks(pageId);
  
  console.log('\n' + '='.repeat(100));
  console.log(`Total blocks: ${globalIndex}`);
  console.log('='.repeat(100) + '\n');
}

async function main() {
  const pageId = process.argv[2];
  
  if (!pageId) {
    console.error('Usage: node show-notion-order.cjs <pageId>');
    console.error('Example: node show-notion-order.cjs 2b4a89fedba5818aa350cb8e1a3c8369');
    process.exit(1);
  }
  
  // Get page title
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const title = page.properties.Name?.title?.[0]?.plain_text || 'Unknown';
    console.log(`\nPage: ${title}`);
    console.log(`ID: ${pageId}`);
  } catch (error) {
    console.log(`\nPage ID: ${pageId}`);
  }
  
  await showPageOrder(pageId);
}

main().catch(console.error);
