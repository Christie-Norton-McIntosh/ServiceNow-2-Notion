#!/usr/bin/env node
/**
 * Search Notion database for pages matching keywords
 */

const { Client } = require('@notionhq/client');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = '282a89fe-dba5-815e-91f0-db972912ef9f';

// Search terms to look for
const searchTerms = [
  'Computer',
  'CMDB',
  'Create',
  'Scripted',
  'Audit',
  'Duplicate',
  'CIS',
  'Remediation',
  'Explore',
  'Home',
  'Workspace'
];

async function searchForTerm(term) {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          contains: term
        }
      },
      page_size: 10
    });
    
    return response.results.map(page => ({
      id: page.id,
      title: page.properties.Name.title[0]?.plain_text || 'Unknown'
    }));
  } catch (error) {
    console.error(`Error searching for "${term}":`, error.message);
    return [];
  }
}

async function main() {
  console.log('\n🔍 Searching Notion Database for Matching Pages\n');
  console.log('================================================\n');
  
  for (const term of searchTerms) {
    console.log(`\n🔍 Searching for: "${term}"`);
    const results = await searchForTerm(term);
    
    if (results.length > 0) {
      console.log(`   Found ${results.length} matches:`);
      results.forEach((page, idx) => {
        console.log(`   ${idx + 1}. "${page.title}"`);
        console.log(`      ID: ${page.id}`);
      });
    } else {
      console.log(`   No matches found`);
    }
    
    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log('\n================================================\n');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
