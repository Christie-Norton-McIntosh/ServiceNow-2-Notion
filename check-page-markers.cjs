#!/usr/bin/env node
/**
 * Check a Notion page for any remaining marker tokens
 * Usage: node check-page-markers.cjs <page-id>
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: './server/.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getAllBlocks(blockId, depth = 0, maxDepth = 10) {
  if (depth > maxDepth) return [];
  
  const blocks = [];
  let cursor = undefined;
  
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor
    });
    
    for (const block of response.results) {
      blocks.push({ block, depth });
      
      if (block.has_children) {
        const children = await getAllBlocks(block.id, depth + 1, maxDepth);
        blocks.push(...children);
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  return blocks;
}

function extractText(block) {
  const type = block.type;
  const payload = block[type];
  
  // Handle table rows
  if (type === 'table_row' && payload.cells) {
    return payload.cells.map(cell => 
      cell.map(rt => rt?.text?.content || '').join('')
    ).join(' | ');
  }
  
  // Handle rich_text blocks
  if (payload && Array.isArray(payload.rich_text)) {
    return payload.rich_text.map(rt => rt?.text?.content || '').join('');
  }
  
  return '';
}

async function checkPageForMarkers(pageId) {
  console.log(`\n🔍 Checking page ${pageId} for markers...\n`);
  
  const allBlocks = await getAllBlocks(pageId);
  console.log(`📊 Total blocks found: ${allBlocks.length}\n`);
  
  const markerRegex = /\(sn2n:[a-z0-9\-_]+\)/gi;
  const blocksWithMarkers = [];
  
  for (const { block, depth } of allBlocks) {
    const text = extractText(block);
    const matches = text.match(markerRegex);
    
    if (matches && matches.length > 0) {
      blocksWithMarkers.push({
        id: block.id,
        type: block.type,
        depth,
        text: text.substring(0, 100),
        markers: matches
      });
    }
  }
  
  if (blocksWithMarkers.length === 0) {
    console.log(`✅ No markers found! Page is clean.\n`);
  } else {
    console.log(`❌ Found ${blocksWithMarkers.length} blocks with markers:\n`);
    
    for (const block of blocksWithMarkers) {
      console.log(`Block ID: ${block.id}`);
      console.log(`  Type: ${block.type}`);
      console.log(`  Depth: ${block.depth}`);
      console.log(`  Markers: ${block.markers.join(', ')}`);
      console.log(`  Text: ${block.text}...`);
      console.log('');
    }
  }
  
  return blocksWithMarkers;
}

const pageId = process.argv[2];
if (!pageId) {
  console.error('Usage: node check-page-markers.cjs <page-id>');
  process.exit(1);
}

checkPageForMarkers(pageId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
