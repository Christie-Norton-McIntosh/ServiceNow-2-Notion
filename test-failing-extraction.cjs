const axios = require('axios');
const fs = require('fs');
const path = require('path');

const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/add-a-software-license-using-the-legacy-software-asset-manag-content-validation-failed-2025-12-05T07-39-05.html';
const html = fs.readFileSync(htmlFile, 'utf8');

const PROXY_URL = 'http://localhost:3004/api/W2N';

async function testExtraction() {
  console.log('\n=== Testing HTML extraction for failing page ===\n');

  try {
    const response = await axios.post(PROXY_URL, {
      title: 'Test: Failing page extraction',
      databaseId: 'test-database-id',
      contentHtml: html,
      dryRun: true
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const data = response.data?.data || response.data;
    const children = data?.children || [];

    console.log(`✅ Extraction successful: ${children.length} blocks created\n`);
    console.log('Block types:', children.map(b => b.type).join(', '));
    console.log('\n');

    // Show audit info if available
    if (data.audit) {
      console.log('Audit results:');
      console.log(`  Coverage: ${data.audit.coverage}%`);
      console.log(`  Total length: ${data.audit.totalLength}`);
      console.log(`  Notion text length: ${data.audit.notionTextLength}`);
      console.log(`  Missing: ${data.audit.missing} characters`);
      console.log('\n');
    }

    // Show first few blocks
    console.log('First 3 blocks:');
    children.slice(0, 3).forEach((block, i) => {
      console.log(`${i+1}. ${block.type}: ${JSON.stringify(block[block.type]?.rich_text?.[0]?.text?.content || 'N/A').substring(0, 100)}...`);
    });

  } catch (error) {
    console.error('❌ Extraction failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testExtraction();