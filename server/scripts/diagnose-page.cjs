/**
 * Diagnostic script to fetch and analyze a Notion page
 * Usage: node server/scripts/diagnose-page.cjs <page-id>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Client } = require('@notionhq/client');

const pageId = process.argv[2];
if (!pageId) {
  console.error('Usage: node server/scripts/diagnose-page.cjs <page-id>');
  process.exit(1);
}

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function analyzeBlock(blockId, depth = 0) {
  const indent = '  '.repeat(depth);
  
  try {
    const block = await notion.blocks.retrieve({ block_id: blockId });
    const type = block.type;
    
    let summary = `${indent}[${type}]`;
    
    // Add specific info based on block type
    if (type === 'paragraph' && block.paragraph) {
      const text = block.paragraph.rich_text.map(rt => rt.plain_text).join('');
      summary += ` "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`;
    } else if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      const text = block[type].rich_text.map(rt => rt.plain_text).join('');
      summary += ` "${text}"`;
    } else if (type === 'callout' && block.callout) {
      const text = block.callout.rich_text.map(rt => rt.plain_text).join('');
      const emoji = block.callout.icon?.emoji || 'no-emoji';
      const color = block.callout.color || 'default';
      summary += ` [${emoji}] [${color}] "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`;
    } else if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      const text = block[type].rich_text.map(rt => rt.plain_text).join('');
      summary += ` "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`;
    } else if (type === 'table') {
      summary += ` [${block.table.table_width} cols]`;
    } else if (type === 'image') {
      if (block.image.file_upload) {
        summary += ` [uploaded: ${block.image.file_upload.id}]`;
      } else if (block.image.external) {
        summary += ` [external: ${block.image.external.url.substring(0, 50)}...]`;
      }
    } else if (type === 'code') {
      const text = block.code.rich_text.map(rt => rt.plain_text).join('');
      summary += ` [${block.code.language}] "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`;
    }
    
    console.log(summary);
    
    // Recurse into children if present
    if (block.has_children) {
      const children = await notion.blocks.children.list({ block_id: blockId });
      for (const child of children.results) {
        await analyzeBlock(child.id, depth + 1);
      }
    }
  } catch (error) {
    console.error(`${indent}[ERROR] ${error.message}`);
  }
}

async function main() {
  console.log(`\n🔍 Analyzing Notion page: ${pageId}\n`);
  
  try {
    // Get page title
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log(`📄 Page Title: ${page.properties.Name?.title?.[0]?.plain_text || 'Untitled'}\n`);
    
    // Get all blocks
    const blocks = await notion.blocks.children.list({ block_id: pageId });
    console.log(`📊 Total top-level blocks: ${blocks.results.length}\n`);
    console.log(`Block structure:\n`);
    
    for (const block of blocks.results) {
      await analyzeBlock(block.id);
    }
    
    // Count by type
    console.log(`\n📊 Summary:`);
    const typeCounts = {};
    for (const block of blocks.results) {
      typeCounts[block.type] = (typeCounts[block.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code === 'object_not_found') {
      console.error(`\nPage not found. Make sure the page ID is correct and the integration has access.`);
    }
  }
}

main();
