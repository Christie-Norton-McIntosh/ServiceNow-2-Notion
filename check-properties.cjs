#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

(async () => {
  const pageId = '2c5a89fe-dba5-81cb-a5c7-e0e6a19133a9';
  const page = await notion.pages.retrieve({ page_id: pageId });
  
  console.log('Current Property Values:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  const propsToCheck = ['Coverage', 'MissingCount', 'MissingSpans', 'Status', 'Method', 'LastChecked', 'RunId'];
  
  propsToCheck.forEach(propName => {
    const prop = page.properties[propName];
    if (!prop) {
      console.log(`${propName}: (property doesn't exist)`);
      return;
    }
    
    console.log(`${propName}:`);
    console.log(`  Type: ${prop.type}`);
    
    if (prop.type === 'number' && prop.number !== null) {
      console.log(`  Value: ${prop.number}`);
    } else if (prop.type === 'rich_text' && prop.rich_text.length > 0) {
      const text = prop.rich_text.map(t => t.plain_text).join('');
      console.log(`  Value: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
    } else if (prop.type === 'select' && prop.select) {
      console.log(`  Value: ${prop.select.name}`);
    } else if (prop.type === 'checkbox') {
      console.log(`  Value: ${prop.checkbox}`);
    } else if (prop.type === 'date' && prop.date) {
      console.log(`  Value: ${prop.date.start}`);
    } else {
      console.log(`  Value: (empty/null)`);
    }
    console.log('');
  });
})();
