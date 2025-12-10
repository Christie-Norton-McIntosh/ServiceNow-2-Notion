#!/usr/bin/env node

/**
 * Test AUDIT-based Validation Property
 * 
 * Tests that the Validation property uses AUDIT metrics (coverage %, text nodes, chars)
 * instead of LCS metrics (similarity %, segments, order issues).
 * 
 * Usage: node test-audit-validation.cjs
 */

const fs = require('fs');
const path = require('path');

// Read a test HTML file
const testFile = path.join(__dirname, 'tests', 'fixtures', 'div-p-with-spans-and-ul.html');

if (!fs.existsSync(testFile)) {
  console.error(`❌ Test file not found: ${testFile}`);
  process.exit(1);
}

const html = fs.readFileSync(testFile, 'utf8');
console.log(`📄 Loaded test HTML: ${testFile}`);
console.log(`📏 HTML length: ${html.length} characters\n`);

// Make dry-run request to server
const http = require('http');

// Use PATCH endpoint with dummy page ID for dry-run testing
const dummyPageId = '00000000000000000000000000000000'; // 32-char UUID (all zeros)

const postData = JSON.stringify({
  title: 'AUDIT Validation Test',
  contentHtml: html,
  dryRun: true
});

const options = {
  hostname: 'localhost',
  port: 3004,
  path: `/api/W2N/${dummyPageId}`,
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log(`🔄 Sending PATCH dry-run request to http://localhost:3004/api/W2N/${dummyPageId}...\n`);

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (response.success) {
        console.log(`✅ Dry-run successful`);
        console.log(`📊 Blocks extracted: ${response.data.blocksExtracted}`);
        
        // Check if audit data is present
        if (response.data.audit) {
          console.log(`\n✅ AUDIT data found in response:`);
          console.log(`   Coverage: ${response.data.audit.coverageStr}`);
          console.log(`   Passed: ${response.data.audit.passed}`);
          console.log(`   Source: ${response.data.audit.nodeCount} text nodes, ${response.data.audit.totalLength} chars`);
          console.log(`   Notion: ${response.data.audit.notionBlocks} blocks, ${response.data.audit.notionTextLength} chars`);
          console.log(`   Block/Node Ratio: ${response.data.audit.blockNodeRatio}x`);
          
          if (response.data.audit.missing > 0) {
            console.log(`   ⚠️ Missing: ${response.data.audit.missing} chars (${response.data.audit.missingPercent}%)`);
          }
          
          if (response.data.audit.extra > 0) {
            console.log(`   ⚠️ Extra: ${response.data.audit.extra} chars (${response.data.audit.extraPercent}%)`);
          }
          
          console.log(`\n✅ AUDIT validation ready to use in Validation property`);
        } else {
          console.log(`\n⚠️ No AUDIT data in response (SN2N_AUDIT_CONTENT may be disabled)`);
        }
        
        // Check block types
        console.log(`\n📦 Block types:`);
        Object.entries(response.data.blockTypes).forEach(([type, count]) => {
          console.log(`   ${type}: ${count}`);
        });
        
      } else {
        console.error(`❌ Request failed: ${response.error?.message || 'Unknown error'}`);
        console.error(`   Error code: ${response.error?.code || 'N/A'}`);
        console.error(`\n📋 Full response:`, JSON.stringify(response, null, 2));
        process.exit(1);
      }
      
    } catch (err) {
      console.error(`❌ Failed to parse response:`, err.message);
      console.error(`   Raw response:`, data.substring(0, 500));
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`❌ Request error:`, err.message);
  console.error(`\n💡 Is the server running? Try: npm start`);
  process.exit(1);
});

req.write(postData);
req.end();
