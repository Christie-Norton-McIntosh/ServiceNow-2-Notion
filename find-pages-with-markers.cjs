#!/usr/bin/env node

/**
 * Query Notion database for pages with unresolved markers
 * 
 * Searches the Validation property for pages containing "sn2n:" tokens
 * and returns their page IDs for batch cleanup.
 * 
 * Usage:
 *   node find-pages-with-markers.cjs > pages-with-markers.txt
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });

const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
// Accept database id from CLI arg 1 or env DATABASE_ID; print help if missing
const DATABASE_ID = (process.argv[2] || process.env.DATABASE_ID || '').replace(/-/g, '');

if (!NOTION_TOKEN) {
  console.error('❌ Error: NOTION_TOKEN not found in server/.env');
  process.exit(1);
}

if (!DATABASE_ID || DATABASE_ID.length !== 32) {
  console.error('❌ Error: DATABASE_ID is required (32-char UUID without hyphens).');
  console.error('Usage: node find-pages-with-markers.cjs <databaseId>');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

async function findPagesWithMarkers() {
  console.error('🔍 Searching for pages with marker tokens...\n');
  
  let hasMore = true;
  let startCursor = undefined;
  let totalPages = 0;
  let pagesWithMarkers = [];
  
  while (hasMore) {
    try {
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        filter: {
          property: 'Validation',
          rich_text: {
            contains: 'sn2n:'
          }
        },
        start_cursor: startCursor,
        page_size: 100
      });
      
      for (const page of response.results) {
        const title = page.properties.Title?.title?.[0]?.plain_text || 'Untitled';
        const validation = page.properties.Validation?.rich_text?.[0]?.plain_text || '';
        const pageId = page.id.replace(/-/g, '');
        
        // Check if validation actually contains marker tokens
        if (validation.includes('sn2n:')) {
          pagesWithMarkers.push({
            id: pageId,
            title,
            validation: validation.substring(0, 200) // First 200 chars
          });
          
          console.error(`📄 ${title}`);
          console.error(`   ID: ${pageId}`);
          console.error(`   Validation: ${validation.substring(0, 100)}...`);
          console.error('');
        }
        
        totalPages++;
      }
      
      hasMore = response.has_more;
      startCursor = response.next_cursor;
      
      if (hasMore) {
        console.error(`⏳ Processed ${totalPages} pages, fetching more...`);
      }
      
    } catch (error) {
      console.error('❌ Error querying database:', error.message);
      process.exit(1);
    }
  }
  
  console.error(`\n✅ Search complete. Found ${pagesWithMarkers.length} page(s) with markers.`);
  console.error('\n📋 Page IDs (one per line):\n');
  
  // Output page IDs to stdout (can be redirected to file)
  for (const page of pagesWithMarkers) {
    console.log(page.id);
  }
  
  return pagesWithMarkers;
}

findPagesWithMarkers().catch(error => {
  console.error('❌ Fatal error:', error.message);
  process.exit(1);
});
