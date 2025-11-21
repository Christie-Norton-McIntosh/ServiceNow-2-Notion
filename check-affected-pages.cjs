#!/usr/bin/env node
/**
 * Check pages that hit savedToUpdateFolder error
 * Verifies if their validation properties are populated
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: './server/.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkPage(pageUrl) {
  try {
    // Extract page ID from URL
    const match = pageUrl.match(/([a-f0-9]{32})|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (!match) {
      console.log(`❌ Could not extract page ID from: ${pageUrl}`);
      return;
    }
    
    const pageId = match[0].replace(/-/g, '');
    
    // Retrieve the page
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    const title = page.properties.Name?.title?.[0]?.plain_text || 'Untitled';
    const validation = page.properties.Validation;
    const stats = page.properties.Stats;
    const errorChecked = page.properties.Error?.checkbox || false;
    
    // Check if validation is blank
    const isValidationBlank = !validation || 
                               !validation.rich_text || 
                               validation.rich_text.length === 0 ||
                               (validation.rich_text.length === 1 && 
                                !validation.rich_text[0].text?.content?.trim());
    
    const isStatsBlank = !stats || 
                         !stats.rich_text || 
                         stats.rich_text.length === 0;
    
    console.log(`\n📄 ${title}`);
    console.log(`   Page ID: ${pageId}`);
    console.log(`   URL: https://notion.so/${pageId}`);
    console.log(`   Error Checkbox: ${errorChecked ? '✓ CHECKED' : '○ Not checked'}`);
    console.log(`   Validation: ${isValidationBlank ? '❌ BLANK' : '✅ Populated'}`);
    console.log(`   Stats: ${isStatsBlank ? '❌ BLANK' : '✅ Populated'}`);
    
    if (isValidationBlank) {
      console.log(`   🚨 ACTION: This page needs to be re-extracted or PATCHed`);
    } else {
      console.log(`   ✅ STATUS: Page is fine (validation was set before final check failed)`);
    }
    
    return {
      pageId,
      title,
      isValidationBlank,
      errorChecked
    };
    
  } catch (error) {
    console.log(`❌ Error checking page: ${error.message}`);
  }
}

async function main() {
  console.log('Checking pages that hit savedToUpdateFolder error...\n');
  console.log('Paste page URLs from your logs (one per line), then press Ctrl+D:\n');
  
  // Example URL from your log:
  const exampleUrl = 'https://www.notion.so/Configure-a-step-based-service-fulfillment-flow-2b2a89fedba581088a02c77979968b61';
  
  console.log('Example from your log:');
  await checkPage(exampleUrl);
  
  console.log('\n' + '='.repeat(80));
  console.log('Add more URLs to check (or press Ctrl+C to exit):');
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
