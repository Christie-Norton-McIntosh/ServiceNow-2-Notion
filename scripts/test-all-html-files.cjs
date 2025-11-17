#!/usr/bin/env node
/**
 * Test extraction for all HTML files in patch/pages/pages-to-update/
 * Shows block counts without verbose logging
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Test all HTML files
const pagesDir = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update');
const htmlFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

console.log(`\n📦 Testing ${htmlFiles.length} HTML files...\n`);

let successCount = 0;
let failCount = 0;

async function testFile(filename) {
  const htmlPath = path.join(pagesDir, filename);
  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  const postData = JSON.stringify({
    title: filename.replace('.html', ''),
    databaseId: '282a89fe-dba5-815e-91f0-db972912ef9f',
    contentHtml: html,
    dryRun: true
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3004,
      path: '/api/W2N',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const responseData = result.data || result;
          const blocks = responseData.children?.length || 0;
          const hasErrors = responseData.hasErrors || false;
          const status = res.statusCode === 200 && !hasErrors ? '✅' : '❌';
          
          console.log(`${status} ${filename}`);
          console.log(`   Blocks: ${blocks}, Status: ${res.statusCode}, Errors: ${hasErrors ? 'YES' : 'NO'}`);
          
          if (res.statusCode === 200 && !hasErrors) {
            successCount++;
          } else {
            failCount++;
          }
          
          resolve();
        } catch (err) {
          console.log(`❌ ${filename}`);
          console.log(`   Parse error: ${err.message}`);
          failCount++;
          resolve();
        }
      });
    });

    req.on('error', (err) => {
      console.log(`❌ ${filename}`);
      console.log(`   Request error: ${err.message}`);
      failCount++;
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

async function runTests() {
  for (const file of htmlFiles) {
    await testFile(file);
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   ✅ Successful: ${successCount}/${htmlFiles.length}`);
  console.log(`   ❌ Failed: ${failCount}/${htmlFiles.length}`);
}

runTests();
