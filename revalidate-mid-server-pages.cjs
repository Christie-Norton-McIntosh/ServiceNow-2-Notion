#!/usr/bin/env node
/**
 * Revalidate specific Notion pages - User requested MID Server pages
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });
const { Client } = require('@notionhq/client');

const pages = [
  { id: '2b1a89fedba58105aa9fe2d5016a6904', title: 'MID Server properties' },
  { id: '2b1a89fedba58103890ed1d72c7d9149', title: 'MID Server parameters' },
  { id: '2b1a89fedba5819b87fbf86f4dfde748', title: 'Install and uninstall Nmap on a MID Server' },
  { id: '2b1a89fedba58115b943c01486641932', title: 'Install a MID Server on Windows' },
  { id: '2b1a89fedba5811d82f8edd6bbb89336', title: 'Exploring Entity View Action Mapper' },
  { id: '2b1a89fedba581e49003ec41bb129de6', title: 'CMDB classes targeted in Service Graph Connector for Observability - Datadog' },
  { id: '2b1a89fedba581b4b716db520bc5061b', title: 'CMDB classes targeted in Service Graph Connector for Microsoft Azure' },
  { id: '2b1a89fedba581179c9ddaf1dc3e6c79', title: 'Attach a script file to a file synchronized MID Server' }
];

async function revalidatePages() {
  const notion = new Client({ auth: process.env.NOTION_TOKEN });
  
  console.log('==========================================');
  console.log('Revalidation of 8 MID Server Pages');
  console.log('==========================================\n');
  
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };
  
  for (let i = 0; i < pages.length; i++) {
    const { id, title } = pages[i];
    console.log(`[${i+1}/8] ${title}`);
    console.log(`    Page ID: ${id}`);
    
    try {
      // Fetch page properties first
      const page = await notion.pages.retrieve({ page_id: id });
      
      // Fetch all blocks
      console.log('    Fetching blocks...');
      let allBlocks = [];
      let cursor = undefined;
      const startTime = Date.now();
      
      do {
        const response = await notion.blocks.children.list({
          block_id: id,
          page_size: 100,
          start_cursor: cursor
        });
        
        allBlocks = allBlocks.concat(response.results || []);
        cursor = response.has_more ? response.next_cursor : undefined;
      } while (cursor);
      
      const fetchTime = Date.now() - startTime;
      
      // Count block types
      const blockTypes = {};
      allBlocks.forEach(block => {
        blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
      });
      
      console.log(`    ✅ Found ${allBlocks.length} blocks (${fetchTime}ms)`);
      console.log(`       Tables: ${blockTypes.table || 0}, Images: ${blockTypes.image || 0}, Callouts: ${blockTypes.callout || 0}`);
      
      // Check for common issues
      const issues = [];
      
      // Check if page has Error property set
      const errorProp = page.properties?.Error?.checkbox;
      if (errorProp) {
        issues.push('Error flag is set');
      }
      
      // Check if page is empty
      if (allBlocks.length === 0) {
        issues.push('Page has no content blocks');
      }
      
      // Check for marker leaks
      const markerLeaks = allBlocks.filter(block => {
        const richText = block[block.type]?.rich_text || [];
        return richText.some(rt => rt.text?.content?.includes('sn2n:marker'));
      });
      
      if (markerLeaks.length > 0) {
        issues.push(`${markerLeaks.length} marker leak(s) detected`);
      }
      
      if (issues.length > 0) {
        console.log(`    ⚠️  Issues found:`);
        issues.forEach(issue => console.log(`       - ${issue}`));
        results.failed++;
        results.errors.push({ title, id, issues });
      } else {
        console.log(`    ✅ Validation passed`);
        results.passed++;
      }
      
    } catch (error) {
      console.log(`    ❌ Error: ${error.message}`);
      results.failed++;
      results.errors.push({ title, id, issues: [error.message] });
    }
    
    console.log('');
  }
  
  // Summary
  console.log('\n==========================================');
  console.log('Summary');
  console.log('==========================================');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  
  if (results.errors.length > 0) {
    console.log('\nFailed Pages:');
    results.errors.forEach(({ title, id, issues }) => {
      console.log(`\n  ${title}`);
      console.log(`  ID: ${id}`);
      issues.forEach(issue => console.log(`    - ${issue}`));
    });
  }
}

revalidatePages().catch(console.error);
