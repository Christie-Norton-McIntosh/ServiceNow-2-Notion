#!/usr/bin/env node
/**
 * Test script to directly update Notion page properties
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const { Client } = require('@notionhq/client');

const pageId = '2c1a89fedba581dcb0e6e55d5fd9db30';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function testPropertyUpdate() {
  console.log('Testing direct property update...');

  const testProperties = {
    "Audit": {
      rich_text: [{
        type: 'text',
        text: { content: '[TEST] Direct API update test' }
      }]
    },
    "ContentComparison": {
      rich_text: [{
        type: 'text',
        text: { content: 'Test content comparison' }
      }]
    }
  };

  try {
    console.log('Making API call...');
    const result = await notion.pages.update({
      page_id: pageId,
      properties: testProperties
    });

    console.log('✅ API call succeeded');
    console.log('Response:', JSON.stringify(result, null, 2));

    // Verify the update
    console.log('\nVerifying update...');
    const page = await notion.pages.retrieve({ page_id: pageId });
    console.log('Audit property:', page.properties.Audit?.rich_text?.[0]?.text?.content);
    console.log('ContentComparison property:', page.properties.ContentComparison?.rich_text?.[0]?.text?.content);

  } catch (error) {
    console.error('❌ API call failed:', error.message);
    if (error.code) console.error('Code:', error.code);
    if (error.status) console.error('Status:', error.status);
  }
}

testPropertyUpdate();