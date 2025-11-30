#!/usr/bin/env node

/**
 * Verify Notion page structure - check if images are correctly placed in numbered list items
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function fetchBlockChildren(blockId, depth = 0) {
  const indent = '  '.repeat(depth);
  try {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100
    });

    for (const block of response.results) {
      let content = '';
      
      // Extract content preview based on block type
      if (block.type === 'numbered_list_item' && block.numbered_list_item.rich_text.length > 0) {
        content = block.numbered_list_item.rich_text[0].text.content.substring(0, 80);
      } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item.rich_text.length > 0) {
        content = block.bulleted_list_item.rich_text[0].text.content.substring(0, 80);
      } else if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        content = block.paragraph.rich_text[0].text.content.substring(0, 80);
      } else if (block.type === 'heading_3' && block.heading_3.rich_text.length > 0) {
        content = block.heading_3.rich_text[0].text.content;
      } else if (block.type === 'callout' && block.callout.rich_text.length > 0) {
        content = 'Callout: ' + block.callout.rich_text[0].text.content.substring(0, 60);
      } else if (block.type === 'image') {
        const caption = block.image.caption.length > 0 ? block.image.caption[0].text.content : 'no caption';
        content = `Image: ${caption}`;
      }

      console.log(`${indent}📦 ${block.type} [${block.has_children ? 'HAS CHILDREN' : 'no children'}]`);
      if (content) {
        console.log(`${indent}   ${content}${content.length >= 80 ? '...' : ''}`);
      }

      // Recursively fetch children if present
      if (block.has_children) {
        await fetchBlockChildren(block.id, depth + 1);
      }
    }

    return response.results.length;
  } catch (error) {
    console.error(`${indent}❌ Error fetching children for ${blockId}:`, error.message);
    return 0;
  }
}

async function verifyPageStructure(pageId) {
  console.log(`\n🔍 Verifying page structure for: ${pageId}\n`);
  console.log('=' .repeat(80));
  
  const count = await fetchBlockChildren(pageId);
  
  console.log('='.repeat(80));
  console.log(`\n✅ Total top-level blocks: ${count}\n`);
}

// Get page ID from command line or use default
const pageId = process.argv[2] || '2a7a89fedba581adb791c69d40135d07';

verifyPageStructure(pageId).catch(error => {
  console.error('❌ Failed to verify page structure:', error);
  process.exit(1);
});
