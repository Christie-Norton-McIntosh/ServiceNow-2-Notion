#!/usr/bin/env node
/**
 * Revalidate Notion pages from failed-validation folder
 * Scans HTML files, extracts page IDs, validates current state
 * Pages that still fail are kept in failed-validation for re-extraction
 */

require('dotenv').config();
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

/**
 * Extract page ID and title from HTML file metadata
 */
function extractPageMetadata(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    
    // Extract from HTML comment metadata
    const pageIdMatch = content.match(/Page ID:\s*([a-f0-9-]+)/i);
    const titleMatch = content.match(/Page Title:\s*(.+?)$/m);
    
    if (!pageIdMatch) return null;
    
    return {
      id: pageIdMatch[1].trim(),
      title: titleMatch ? titleMatch[1].trim() : path.basename(filepath, '.html'),
      filename: path.basename(filepath)
    };
  } catch (error) {
    console.error(`Error reading ${filepath}: ${error.message}`);
    return null;
  }
}

/**
 * Scan failed-validation folder for HTML files
 */
function scanFailedValidationFolder() {
  const failedValidationDir = path.join(__dirname, '..', 'patch', 'pages', 'failed-validation');
  
  if (!fs.existsSync(failedValidationDir)) {
    console.log(`\n⚠️  Directory not found: ${failedValidationDir}\n`);
    return [];
  }
  
  const files = fs.readdirSync(failedValidationDir)
    .filter(f => f.endsWith('.html'));
  
  const pages = [];
  for (const file of files) {
    const filepath = path.join(failedValidationDir, file);
    const metadata = extractPageMetadata(filepath);
    if (metadata) {
      pages.push(metadata);
    }
  }
  
  return pages;
}

async function revalidatePages() {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  
  // Scan folder for pages
  const pages = scanFailedValidationFolder();
  
  if (pages.length === 0) {
    console.log('==========================================');
    console.log('No Pages to Revalidate');
    console.log('==========================================\n');
    console.log('✅ The failed-validation folder is empty or contains no valid HTML files.\n');
    return;
  }
  
  console.log('==========================================');
  console.log(`Revalidation of ${pages.length} Pages from failed-validation`);
  console.log('==========================================\n');
  
  const failedPages = [];
  
  for (let i = 0; i < pages.length; i++) {
    const { id, title, filename } = pages[i];
    console.log(`[${i+1}/${pages.length}] ${title}`);
    console.log(`    File: ${filename}`);
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
  
  // Report on failed pages
  if (failedPages.length > 0) {
    console.log(`\n⚠️  ${failedPages.length} page(s) still have validation issues\n`);
    
    const failedValidationDir = path.join(__dirname, '..', 'patch', 'pages', 'failed-validation');
    
    for (const page of failedPages) {
      console.log(`   ❌ ${page.title}`);
      console.log(`      Page ID: ${page.id}`);
      console.log(`      Issues: ${page.markers} marker leak(s)`);
    }
    
    console.log(`\n📝 Summary:`);
    console.log(`   - ${failedPages.length} page(s) still need fixing`);
    console.log(`   - HTML files remain in: ${failedValidationDir}`);
    console.log(`   - These pages need to be re-extracted from ServiceNow and PATCHed\n`);
  } else {
    console.log('\n✅ All pages passed validation!\n');
    console.log('� You can now move these HTML files from failed-validation to pages-to-update');
    console.log('   for batch PATCH processing, or delete them if already fixed.\n');
  }
}

revalidatePages().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
