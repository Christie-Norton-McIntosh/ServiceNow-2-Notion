const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkPageTime(pageId) {
  const cleanId = pageId.replace(/-/g, '');
  const page = await notion.pages.retrieve({ page_id: cleanId });
  
  console.log('\n📅 Page Timestamps:');
  console.log(`   Created: ${page.created_time}`);
  console.log(`   Last edited: ${page.last_edited_time}`);
  console.log(`\n🕐 Current time: ${new Date().toISOString()}`);
}

checkPageTime('2b3a89fedba581f5a028ecfce8338faa');
