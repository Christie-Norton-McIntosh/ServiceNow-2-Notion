#!/usr/bin/env node
/**
 * Diagnostic script to check page properties and database schema
 * Run: node diagnose-page-properties.cjs <page-id>
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const { Client } = require('@notionhq/client');

const pageId = process.argv[2] || '2c1a89fedba581dcb0e6e55d5fd9db30';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function diagnose() {
  console.log(`\n🔍 Diagnosing page: ${pageId}\n`);
  
  try {
    // 1. Get page info
    console.log('📄 Fetching page...');
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    console.log(`   Object: ${page.object}`);
    console.log(`   Parent type: ${page.parent.type}`);
    console.log(`   Parent ID: ${page.parent.database_id || page.parent.page_id || 'N/A'}`);
    
    // 2. Get database schema if it's a database page
    if (page.parent.type === 'database_id') {
      const dbId = page.parent.database_id;
      console.log(`\n📊 Fetching database schema: ${dbId}...`);
      
      const database = await notion.databases.retrieve({ database_id: dbId });
      console.log(`   Database title: ${database.title[0]?.plain_text || 'Untitled'}`);
      console.log(`\n   Available properties:`);
      
      const propNames = Object.keys(database.properties);
      propNames.forEach(name => {
        const prop = database.properties[name];
        console.log(`      • ${name} (${prop.type})`);
      });
      
      // 3. Check for validation properties
      console.log(`\n✅ Validation property check:`);
      const validationProps = ['Error', 'Audit', 'Validation', 'Stats', 'ContentComparison', 'MissingText', 'ExtraText'];
      validationProps.forEach(propName => {
        const exists = propNames.includes(propName);
        console.log(`      ${exists ? '✅' : '❌'} ${propName}`);
      });
      
      // 4. Show current page properties
      console.log(`\n📝 Current page property values:`);
      Object.keys(page.properties).forEach(name => {
        const prop = page.properties[name];
        let value = 'N/A';
        
        if (prop.type === 'checkbox') value = prop.checkbox;
        else if (prop.type === 'rich_text') value = prop.rich_text[0]?.plain_text || '(empty)';
        else if (prop.type === 'url') value = prop.url || '(empty)';
        else if (prop.type === 'title') value = prop.title[0]?.plain_text || '(empty)';
        
        console.log(`      • ${name}: ${JSON.stringify(value).substring(0, 60)}${JSON.stringify(value).length > 60 ? '...' : ''}`);
      });
      
    } else {
      console.log(`\n⚠️  Page is not in a database (parent type: ${page.parent.type})`);
      console.log(`   Cannot check database schema or update properties`);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.code) console.error(`   Code: ${error.code}`);
    if (error.status) console.error(`   Status: ${error.status}`);
  }
}

diagnose();
