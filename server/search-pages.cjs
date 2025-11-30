const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = '2b2a89fedba58044a4ecc4492c4cc2ff';

async function searchPages() {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        or: [
          {
            property: 'Name',
            title: {
              contains: 'connection'
            }
          },
          {
            property: 'Name',
            title: {
              contains: 'relationship'
            }
          }
        ]
      },
      sorts: [
        {
          property: 'Last edited time',
          direction: 'descending'
        }
      ],
      page_size: 20
    });
    
    console.log(`\n🔍 Found ${response.results.length} pages with "connection" or "relationship"\n`);
    
    response.results.forEach((page, idx) => {
      const title = page.properties.Name?.title?.[0]?.plain_text || 'No title';
      const id = page.id.replace(/-/g, '');
      const created = page.created_time;
      const edited = page.last_edited_time;
      
      console.log(`${idx + 1}. ${title}`);
      console.log(`   ID: ${id}`);
      console.log(`   Created: ${created}`);
      console.log(`   Edited: ${edited}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

searchPages();
