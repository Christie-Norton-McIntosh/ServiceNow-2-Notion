#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const testFile = process.argv[2] || 'computer-cmdb-ci-computer-class-2025-11-13T14-32-36.html';
const htmlPath = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update', testFile);

console.log(`\n🔍 Testing extraction for: ${testFile}\n`);

const html = fs.readFileSync(htmlPath, 'utf8');
console.log(`📄 HTML size: ${html.length} bytes`);

const payload = JSON.stringify({
  title: 'DEBUG TEST - ' + testFile.replace(/-2025.*\.html$/, ''),
  databaseId: '178f1c2fb18b80dac65b4bb7d6c7fd7b',
  content: html,
  dryRun: true
});

console.log(`📡 Sending POST to localhost:3004/api/W2N...`);

const req = http.request({
  hostname: 'localhost',
  port: 3004,
  path: '/api/W2N',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      const responseData = result.data || result; // Handle both wrapped and unwrapped responses
      console.log(`\n✅ Response received:`);
      console.log(`   - Status: ${res.statusCode}`);
      console.log(`   - Children blocks: ${responseData.children?.length || 0}`);
      console.log(`   - Has videos: ${responseData.hasVideos || false}`);
      console.log(`   - Has errors: ${responseData.hasErrors || false}`);
      
      if (responseData.children && responseData.children.length > 0) {
        console.log(`\n📦 First 5 block types:`);
        responseData.children.slice(0, 5).forEach((block, idx) => {
          console.log(`   [${idx}] ${block.type}`);
        });
      }
      
      console.log(`\n🔍 Check server log at /tmp/sn2n-test.log for diagnostic output\n`);
      process.exit(0);
    } catch (e) {
      console.error(`\n❌ Error parsing response:`, e.message);
      console.error(`Raw response:`, data.slice(0, 500));
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.error(`\n❌ Request error:`, e.message);
  process.exit(1);
});

req.write(payload);
req.end();
