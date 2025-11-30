#!/usr/bin/env node
/**
 * Inspect a specific page to see where markers are leaking
 * Usage: node scripts/inspect-marker-leak.cjs <pageId>
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function inspectMarkerLeaks(pageId) {
  // Format page ID with hyphens for API call
  const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  
  console.log(`🔍 Inspecting page ${formattedId} for marker leaks...\n`);
  
  // Get page title
  const page = await notion.pages.retrieve({ page_id: formattedId });
  const title = page.properties?.Name?.title?.[0]?.plain_text || page.properties?.title?.title?.[0]?.plain_text || 'Unknown';
  console.log(`📄 Page: ${title}\n`);
  
  const queue = [formattedId];
  const visited = new Set();
  const markerLeaks = [];
  const markerPattern = /\(sn2n:[a-z0-9\-_]+\)/gi;
  
  async function listChildren(blockId, cursor) {
    try {
      return await notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor,
      });
    } catch (error) {
      console.error(`❌ Error fetching children of ${blockId}: ${error.message}`);
      return { results: [], has_more: false };
    }
  }
  
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    
    let cursor = undefined;
    do {
      const res = await listChildren(current, cursor);
      cursor = res.has_more ? res.next_cursor : undefined;
      const children = res.results || [];
      
      for (const child of children) {
        try {
          const blockType = child.type;
          const payload = child[blockType] || {};
          
          // Check rich_text for markers
          if (Array.isArray(payload.rich_text)) {
            const plainText = payload.rich_text.map(rt => rt?.text?.content || '').join('');
            const matches = plainText.match(markerPattern);
            
            if (matches) {
              const preview = plainText.substring(0, 200);
              markerLeaks.push({
                blockId: child.id,
                blockType,
                markers: matches,
                text: preview,
                parentId: current
              });
            }
          }
          
          // Check table cells for markers
          if (blockType === 'table_row' && child.table_row && Array.isArray(child.table_row.cells)) {
            for (const [cellIdx, cell] of child.table_row.cells.entries()) {
              if (Array.isArray(cell)) {
                const cellText = cell.map(rt => rt?.text?.content || '').join('');
                const matches = cellText.match(markerPattern);
                
                if (matches) {
                  const preview = cellText.substring(0, 100);
                  markerLeaks.push({
                    blockId: child.id,
                    blockType: 'table_row_cell',
                    cellIndex: cellIdx,
                    markers: matches,
                    text: preview,
                    parentId: current
                  });
                }
              }
            }
          }
          
          if (child.has_children) {
            queue.push(child.id);
          }
        } catch (error) {
          console.error(`⚠️ Error processing block ${child.id}: ${error.message}`);
        }
      }
    } while (cursor);
  }
  
  // Report findings
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Found ${markerLeaks.length} marker leak(s) in ${visited.size} blocks:\n`);
  
  // Group by marker to see patterns
  const markerGroups = {};
  for (const leak of markerLeaks) {
    for (const marker of leak.markers) {
      if (!markerGroups[marker]) {
        markerGroups[marker] = [];
      }
      markerGroups[marker].push(leak);
    }
  }
  
  console.log(`Unique markers found: ${Object.keys(markerGroups).length}\n`);
  
  for (const [marker, leaks] of Object.entries(markerGroups)) {
    console.log(`\n📌 Marker: ${marker} (appears ${leaks.length} time(s))`);
    
    for (const [idx, leak] of leaks.entries()) {
      console.log(`\n  ${idx + 1}. Block ${leak.blockId} (${leak.blockType}${leak.cellIndex !== undefined ? ` cell ${leak.cellIndex}` : ''})`);
      console.log(`     Parent: ${leak.parentId}`);
      console.log(`     Text: "${leak.text}${leak.text.length >= 200 || leak.text.length >= 100 ? '...' : ''}"`);
    }
  }
  
  // Show sample of how to fix
  if (markerLeaks.length > 0) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`\n💡 These markers should have been removed by the sweeper after deep nesting orchestration.`);
    console.log(`   This suggests either:`);
    console.log(`   1. The sweeper didn't run (check server logs for "Sweeper" messages)`);
    console.log(`   2. The sweeper failed to find these blocks (check for nested structures)`);
    console.log(`   3. The marker removal logic has a bug\n`);
  }
  
  return { leaks: markerLeaks, groups: markerGroups };
}

// Get page ID from command line or use default
const pageId = process.argv[2] || '2aaa89fedba58115936cc71b949d5d5c'; // Default to first failing page

inspectMarkerLeaks(pageId).catch(console.error);
