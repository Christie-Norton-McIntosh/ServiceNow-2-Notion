#!/usr/bin/env node
/**
 * Revalidate specific Notion pages by fetching current state and checking for issues
 * Pages that fail validation are saved to pages-to-update folder for re-extraction
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const pages = [
  { id: '2b0a89fedba5819585d1efe570e7113c', title: 'Exclude classes from CMDB 360' },
  { id: '2b0a89fedba581db9adaee70908ffb12', title: 'Create a CMDB 360 Compare Attribute Values query' },
  { id: '2b0a89fedba58119a619d23708f07d2b', title: 'Components and process of Identification and Reconciliation' },
  { id: '2b0a89fedba5819abeb0eb84b5e65626', title: 'Schedule a CMDB 360 query for a report' },
  { id: '2b0a89fedba581138783c5e7c5611856', title: 'Hardware [cmdb_ci_hardware] class' }
];

async function revalidatePages() {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  
  console.log('==========================================');
  console.log('Manual Revalidation of 5 Pages');
  console.log('==========================================\n');
  
  const failedPages = [];
  
  for (let i = 0; i < pages.length; i++) {
    const { id, title } = pages[i];
    console.log(`[${i+1}/5] ${title}`);
    console.log(`    Page ID: ${id}`);
    
    try {
      // Fetch all blocks
      console.log('    Fetching blocks...');
      let allBlocks = [];
      let cursor = undefined;
      
      do {
        const response = await notion.blocks.children.list({
          block_id: id,
          page_size: 100,
          start_cursor: cursor
        });
        
        allBlocks = allBlocks.concat(response.results || []);
        cursor = response.has_more ? response.next_cursor : undefined;
      } while (cursor);
      
      console.log(`    Found ${allBlocks.length} blocks`);
      
      // Count block types
      const blockTypes = {};
      allBlocks.forEach(block => {
        blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
      });
      
      const blockTypesStr = Object.entries(blockTypes)
        .map(([type, count]) => `${type}:${count}`)
        .join(', ');
      console.log(`    Block types: ${blockTypesStr}`);
      
      // Check for marker leaks
      const markers = [];
      allBlocks.forEach(block => {
        const blockType = block.type;
        if (['paragraph', 'callout', 'bulleted_list_item', 'numbered_list_item'].includes(blockType)) {
          const richText = block[blockType]?.rich_text || [];
          richText.forEach(rt => {
            const text = rt.text?.content || '';
            if (text.includes('sn2n:')) {
              const markerMatches = text.match(/\(sn2n:[a-zA-Z0-9_-]+\)/g);
              if (markerMatches) {
                markers.push(...markerMatches);
              }
            }
          });
        }
      });
      
      // Report status
      if (markers.length > 0) {
        console.log(`    ❌ MARKER LEAK: ${markers.length} marker(s) found`);
        console.log(`       Markers: ${markers.slice(0, 5).join(', ')}${markers.length > 5 ? '...' : ''}`);
        
        // Track failed page
        failedPages.push({
          id,
          title,
          markers: markers.length,
          markerList: markers
        });
      } else {
        console.log(`    ✅ No markers found`);
      }
      
      // Update validation properties
      const validationSummary = markers.length > 0 
        ? `❌ Manual revalidation detected ${markers.length} marker leak(s)\n\nMarkers: ${markers.join(', ')}\n\nBlock count: ${allBlocks.length}\nBlock types: ${blockTypesStr}`
        : `✅ Manual revalidation passed\n\nNo markers detected\n\nBlock count: ${allBlocks.length}\nBlock types: ${blockTypesStr}`;
      
      await notion.pages.update({
        page_id: id,
        properties: {
          'Error': { checkbox: markers.length > 0 },
          'Validation': {
            rich_text: [{
              type: 'text',
              text: { content: `🔍 Manual Revalidation (${new Date().toISOString()})\n\n${validationSummary}` }
            }]
          }
        }
      });
      
      console.log('    ✅ Properties updated');
      console.log('');
      
      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`    ❌ Error: ${error.message}`);
      if (error.body) {
        console.error(`    Error body: ${JSON.stringify(error.body, null, 2)}`);
      }
      console.log('');
    }
  }
  
  console.log('==========================================');
  console.log('Revalidation Complete');
  console.log('==========================================\n');
  
  // Save failed pages to pages-to-update folder
  if (failedPages.length > 0) {
    console.log(`\n⚠️  ${failedPages.length} page(s) failed validation - saving to pages-to-update\n`);
    
    const pagesDir = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update');
    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true });
    }
    
    for (const page of failedPages) {
      try {
        // Create a metadata file for re-extraction
        const sanitizedTitle = page.title.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 80);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const filename = `${sanitizedTitle}-revalidation-failed-${timestamp}.json`;
        const filepath = path.join(pagesDir, filename);
        
        const metadata = {
          pageId: page.id,
          pageUrl: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
          title: page.title,
          failureReason: 'Manual revalidation detected marker leaks',
          markerCount: page.markers,
          markers: page.markerList,
          timestamp: new Date().toISOString(),
          instructions: 'This page needs to be re-extracted from ServiceNow and PATCHed to Notion'
        };
        
        fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2), 'utf-8');
        console.log(`   ✅ Saved: ${filename}`);
      } catch (saveError) {
        console.error(`   ❌ Failed to save ${page.title}: ${saveError.message}`);
      }
    }
    
    console.log(`\n📝 Summary:`);
    console.log(`   - ${failedPages.length} page(s) need re-extraction`);
    console.log(`   - Metadata files saved to: ${pagesDir}`);
    console.log(`   - Re-extract these pages from ServiceNow using the userscript\n`);
  } else {
    console.log('\n✅ All pages passed validation - no action needed\n');
  }
}

revalidatePages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
