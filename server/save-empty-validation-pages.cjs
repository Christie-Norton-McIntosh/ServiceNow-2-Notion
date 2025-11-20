#!/usr/bin/env node

/**
 * Check specific pages for empty Validation property and save them to pages-to-update
 * 
 * Usage: node save-empty-validation-pages.cjs
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const notion = new Client({ 
  auth: process.env.NOTION_TOKEN,
  notionVersion: process.env.NOTION_VERSION || '2022-06-28'
});

// Pages reported as having empty validation
const pageIds = [
  '2b0a89fedba581b09829e6c431f65662', // Viewing API clustering recommendations
  '2b0a89fedba581cdbe97c570e30ec675', // View CMDB Health dashboard
  '2b0a89fedba581e1817ed56450317834', // RTE transforms template scripts
  '2b0a89fedba581eabf77f7aec2493b82', // Review de-duplication tasks legacy
  '2b0a89fedba581649c06f69f1849a806', // Operational Technology OT extension classes
  '2b0a89fedba581a994b3d6bf6ed4471a', // Nutanix extension classes
  '2b0a89fedba5813cb0d3f514b9a14eca', // Network Intrusion Detection System
  '2b0a89fedba581d288e9fddc424d7d09', // Manage a filter version in a form
  '2b0a89fedba5810cbb16cc60cff24d00', // How life cycle values for Asset CI and IBI are synced
  '2b0a89fedba5812684e7e348178ff52a', // Foundation domain in the CSDM framework
  '2b0a89fedba581359f22da27fdc3d399', // Export and import a query as an update set
  '2b0a89fedba581a2b74ef675ba48db44', // Exploring API Insights
  '2b0a89fedba58149a5b8d2527dce0858', // Editing maps in Unified Map
  '2b0a89fedba581038d45d0c9d54e8b55', // Create an ETL transform map
  '2b0a89fedba5813d98a2c2a8c4b54fa0', // CMDB Health KPIs and metrics
  '2b0a89fedba58183b311f14b71d9f276', // CMDB Data Foundations dashboard (1)
  '2b0a89fedba5817584eacf3e951294d2'  // CMDB Data Foundations dashboard (2)
];

async function saveEmptyValidationPages() {
  console.log(`🔍 Checking ${pageIds.length} pages for empty Validation property...\n`);
  
  const savedPages = [];
  const pagesDir = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update');
  
  // Ensure directory exists
  if (!fs.existsSync(pagesDir)) {
    fs.mkdirSync(pagesDir, { recursive: true });
  }
  
  for (let i = 0; i < pageIds.length; i++) {
    const pageId = pageIds[i];
    console.log(`[${i + 1}/${pageIds.length}] Checking page ${pageId}...`);
    
    try {
      // Retrieve page properties
      const page = await notion.pages.retrieve({ page_id: pageId });
      
      const title = page.properties.Title?.title?.[0]?.text?.content || 'Untitled';
      const validationProp = page.properties.Validation;
      const statsProp = page.properties.Stats;
      const errorCheckbox = page.properties.Error?.checkbox;
      const url = page.properties.URL?.url || '';
      
      // Check if Validation property is empty
      const isValidationEmpty = !validationProp || 
                               !validationProp.rich_text || 
                               validationProp.rich_text.length === 0;
      
      const isStatsEmpty = !statsProp || 
                          !statsProp.rich_text || 
                          statsProp.rich_text.length === 0;
      
      console.log(`   Title: "${title}"`);
      console.log(`   Validation empty: ${isValidationEmpty ? 'YES ⚠️' : 'NO'}`);
      console.log(`   Stats empty: ${isStatsEmpty ? 'YES' : 'NO'}`);
      console.log(`   Error checkbox: ${errorCheckbox ? '✓' : '✗'}`);
      
      if (isValidationEmpty) {
        console.log(`   📝 Saving to pages-to-update...`);
        
        // Fetch all blocks from the page
        let allBlocks = [];
        let cursor = undefined;
        
        do {
          const response = await notion.blocks.children.list({
            block_id: pageId,
            page_size: 100,
            start_cursor: cursor
          });
          
          allBlocks = allBlocks.concat(response.results || []);
          cursor = response.has_more ? response.next_cursor : undefined;
        } while (cursor);
        
        console.log(`   Fetched ${allBlocks.length} blocks`);
        
        // Create filename
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
        const sanitizedTitle = title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 60);
        const filename = `${sanitizedTitle}-empty-validation-${timestamp}.html`;
        const filepath = path.join(pagesDir, filename);
        
        // Create HTML content (placeholder - would need actual content from Notion)
        const htmlContent = `<!--
Auto-saved: Empty Validation property detected
Page ID: ${pageId}
Page Title: ${title}
Created: ${new Date().toISOString()}
Source URL: ${url}
Notion URL: https://www.notion.so/${pageId.replace(/-/g, '')}

Validation Property:
${JSON.stringify(validationProp, null, 2)}

Stats Property:
${JSON.stringify(statsProp, null, 2)}

Issue: Validation property has empty rich_text array []
This page needs to be re-extracted from ServiceNow to populate validation properly.

Total blocks: ${allBlocks.length}
Error checkbox: ${errorCheckbox}
-->

<div class="placeholder">
  <h1>${title}</h1>
  <p>This page has an empty Validation property and needs to be re-extracted.</p>
  <p><strong>Blocks found:</strong> ${allBlocks.length}</p>
  <p><strong>Source URL:</strong> <a href="${url}">${url}</a></p>
</div>
`;
        
        fs.writeFileSync(filepath, htmlContent, 'utf-8');
        console.log(`   ✅ Saved to ${filename}`);
        
        savedPages.push({
          pageId,
          title,
          filename,
          url
        });
      } else {
        console.log(`   ✓ Validation property is populated`);
      }
      
      console.log();
      
      // Brief delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`);
    }
  }
  
  console.log(`\n✅ Complete!`);
  console.log(`   Total pages checked: ${pageIds.length}`);
  console.log(`   Pages saved: ${savedPages.length}`);
  
  if (savedPages.length > 0) {
    console.log(`\n📄 Saved pages:`);
    savedPages.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.title}`);
      console.log(`      File: ${p.filename}`);
      console.log(`      URL: ${p.url}`);
    });
    
    // Save summary
    const summaryFile = path.join(__dirname, '..', 'patch', 'logs', 'empty-validation-batch-saved.json');
    fs.writeFileSync(summaryFile, JSON.stringify(savedPages, null, 2), 'utf-8');
    console.log(`\n💾 Summary saved to: ${summaryFile}`);
  }
}

// Run the script
saveEmptyValidationPages()
  .then(() => {
    console.log(`\n✨ Done!`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`\n❌ Script failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
