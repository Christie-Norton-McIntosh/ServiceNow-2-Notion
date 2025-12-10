#!/usr/bin/env node
/**
 * Test extraction debug - runs a single extraction and logs the output
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const htmlFile = process.argv[2] || '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/request-predictive-intelligence-for-major-incident-managemen-failure-2025-12-09T01-45-39.html';

if (!fs.existsSync(htmlFile)) {
  console.error(`File not found: ${htmlFile}`);
  process.exit(1);
}

const contentHtml = fs.readFileSync(htmlFile, 'utf8');

console.log(`📄 Testing extraction from: ${path.basename(htmlFile)}`);
console.log(`   HTML size: ${contentHtml.length} characters`);
console.log(`   Estimated elements: ${(contentHtml.match(/<(p|div|ul|ol|li|table|tr|td|h\d|section|article)(?:\s|>)/gi) || []).length}`);

async function runTest() {
  try {
    console.log('\n🚀 Sending extraction request to http://localhost:3004/api/W2N\n');
    
    const response = await axios.post('http://localhost:3004/api/W2N', {
      title: `Debug Test - ${Date.now()}`,
      databaseId: '2b2a89fe-dba5-8033-a6ae-ee258611a908',
      contentHtml,
      url: 'https://test.example.com'
      // NOTE: NOT using dryRun so extraction actually happens
    }, {
      timeout: 60000
    });
    
    const pageId = response.data?.id;
    const blocks = response.data?.blocks || [];
    console.log(`\n✅ Response received:`);
    console.log(`   Page ID: ${pageId}`);
    console.log(`   Blocks created: ${blocks?.length || 0}`);
    
    if (blocks && blocks.length > 0) {
      console.log(`\n📊 Block types created:`);
      const blockCounts = {};
      blocks.forEach(block => {
        blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
      });
      
      Object.entries(blockCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
      
      console.log(`\n📝 First 5 blocks:`);
      blocks.slice(0, 5).forEach((block, idx) => {
        const content = block[block.type]?.rich_text?.[0]?.text?.content || `[${block.type}]`;
        const preview = content.substring(0, 80).replace(/\n/g, '↵');
        console.log(`   [${idx+1}] ${block.type}: ${preview}`);
      });
    } else {
      console.log(`\n⚠️ NO BLOCKS CREATED!`);
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Response:`, error.response.data);
    }
    process.exit(1);
  }
}

runTest();
