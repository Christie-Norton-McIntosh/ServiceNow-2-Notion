#!/usr/bin/env node

/**
 * Find pages with empty Validation property and save them to pages-to-update
 * 
 * Usage: node find-empty-validation-pages.cjs
 * 
 * This script finds pages where:
 * - Validation property exists but has empty rich_text array []
 * - Stats property exists but has empty rich_text array []
 * 
 * These pages likely had validation errors but the summary was blank/empty.
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const notion = new Client({ 
  auth: process.env.NOTION_TOKEN,
  notionVersion: process.env.NOTION_VERSION || '2022-06-28'
});

// Extract from URL: https://www.notion.so/norton-mcintosh/Viewing-API-clustering-recommendations-in-API-Insights-2b0a89fedba581b09829e6c431f65662?v=2ada89fedba581b6b3d3000ccfd2616b
// Database ID is in the ?v= parameter
const DATABASE_ID = '2ada89fedba581b6b3d3000ccfd2616b'; // ServiceNow-Docs-Notion

async function findEmptyValidationPages() {
  console.log('🔍 Searching for pages with empty Validation property...\n');
  
  const emptyPages = [];
  let hasMore = true;
  let startCursor = undefined;
  let totalChecked = 0;
  
  while (hasMore) {
    try {
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        start_cursor: startCursor,
        page_size: 100
      });
      
      for (const page of response.results) {
        totalChecked++;
        
        const validationProp = page.properties.Validation;
        const statsProp = page.properties.Stats;
        const errorCheckbox = page.properties.Error?.checkbox;
        const title = page.properties.Title?.title?.[0]?.text?.content || 'Untitled';
        
        // Check if Validation property is empty
        const isValidationEmpty = !validationProp || 
                                 !validationProp.rich_text || 
                                 validationProp.rich_text.length === 0;
        
        const isStatsEmpty = !statsProp || 
                            !statsProp.rich_text || 
                            statsProp.rich_text.length === 0;
        
        if (isValidationEmpty) {
          console.log(`📄 Found page with empty Validation: "${title}"`);
          console.log(`   Page ID: ${page.id}`);
          console.log(`   URL: https://www.notion.so/${page.id.replace(/-/g, '')}`);
          console.log(`   Error checkbox: ${errorCheckbox ? '✓' : '✗'}`);
          console.log(`   Stats empty: ${isStatsEmpty ? 'Yes' : 'No'}`);
          console.log();
          
          emptyPages.push({
            id: page.id,
            title: title,
            url: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
            errorCheckbox: errorCheckbox,
            statsEmpty: isStatsEmpty,
            validation: validationProp,
            stats: statsProp
          });
        }
      }
      
      hasMore = response.has_more;
      startCursor = response.next_cursor;
      
      // Progress update
      if (totalChecked % 100 === 0) {
        console.log(`⏳ Checked ${totalChecked} pages, found ${emptyPages.length} with empty validation...`);
      }
      
    } catch (error) {
      console.error(`❌ Error querying database: ${error.message}`);
      break;
    }
  }
  
  console.log(`\n✅ Search complete!`);
  console.log(`   Total pages checked: ${totalChecked}`);
  console.log(`   Pages with empty Validation: ${emptyPages.length}`);
  
  if (emptyPages.length > 0) {
    console.log(`\n📝 Saving results to file...`);
    
    // Save list to JSON file
    const resultsFile = path.join(__dirname, '..', 'patch', 'logs', 'empty-validation-pages.json');
    fs.writeFileSync(resultsFile, JSON.stringify(emptyPages, null, 2), 'utf-8');
    console.log(`✅ Saved to: ${resultsFile}`);
    
    // Also save as text list
    const textFile = path.join(__dirname, '..', 'patch', 'logs', 'empty-validation-pages.txt');
    const textContent = emptyPages.map((p, i) => 
      `${i + 1}. ${p.title}\n   ${p.url}\n   Page ID: ${p.id}\n`
    ).join('\n');
    fs.writeFileSync(textFile, textContent, 'utf-8');
    console.log(`✅ Saved text list to: ${textFile}`);
    
    // Create command to save these pages to pages-to-update
    console.log(`\n🔧 To save these pages for revalidation, you can:`);
    console.log(`   1. Use the revalidation script on these page IDs`);
    console.log(`   2. Or manually visit each URL and re-extract with the userscript`);
    console.log(`\nPage IDs to revalidate:`);
    emptyPages.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.id.replace(/-/g, '')} # ${p.title}`);
    });
  }
  
  return emptyPages;
}

// Run the script
findEmptyValidationPages()
  .then(pages => {
    console.log(`\n✨ Done! Found ${pages.length} pages with empty validation.`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`\n❌ Script failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
