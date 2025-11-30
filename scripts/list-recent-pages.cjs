#!/usr/bin/env node
/**
 * List recent pages from Notion database to help find matches
 */

const { Client } = require('@notionhq/client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = '282a89fe-dba5-815e-91f0-db972912ef9f';

async function listRecentPages() {
  console.log('\n📋 Listing recent pages from Notion database\n');
  
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [
      {
        timestamp: 'last_edited_time',
        direction: 'descending'
      }
    ],
    page_size: 30
  });
  
  console.log(`Found ${response.results.length} pages:\n`);
  
  response.results.forEach((page, i) => {
    const title = page.properties.Name?.title[0]?.plain_text || '(No title)';
    const lastEdited = new Date(page.last_edited_time).toLocaleDateString();
    console.log(`${i + 1}. "${title}"`);
    console.log(`   ID: ${page.id}`);
    console.log(`   Last edited: ${lastEdited}\n`);
  });
}

listRecentPages().catch(console.error);
