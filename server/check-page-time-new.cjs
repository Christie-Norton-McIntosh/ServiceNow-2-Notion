const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function checkTime(pageId) {
  const cleanId = pageId.replace(/-/g, '');
  const page = await notion.pages.retrieve({ page_id: cleanId });
  
  console.log('\nPage ID:', pageId);
  console.log('Created:', page.created_time);
  console.log('Last edited:', page.last_edited_time);
  console.log('\nCurrent time:', new Date().toISOString());
  console.log('\nTime since creation:', Math.round((Date.now() - new Date(page.created_time).getTime()) / 1000 / 60), 'minutes ago');
}

checkTime('2b4a89fedba58143b636dc3e336cb576');
