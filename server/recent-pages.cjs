const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = '2b2a89fedba58044a4ecc4492c4cc2ff';

async function getRecentPages() {
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    sorts: [{ property: 'Created time', direction: 'descending' }],
    page_size: 10
  });
  
  console.log('\n📅 10 Most Recently Created Pages:\n');
  
  response.results.forEach((page, idx) => {
    const title = page.properties.Name?.title?.[0]?.plain_text || 'No title';
    const id = page.id.replace(/-/g, '');
    const created = new Date(page.created_time).toLocaleString();
    
    console.log(`${idx + 1}. ${title}`);
    console.log(`   ID: ${id}`);
    console.log(`   Created: ${created}`);
    console.log('');
  });
}

getRecentPages();
