#!/usr/bin/env node

/**
 * @file Test script for PATCH /api/W2N/:pageId endpoint
 * @description Updates an existing Notion page with fresh extracted content
 * 
 * Usage:
 *   node test-patch-endpoint.cjs <html-file> <page-id> [--dry-run]
 * 
 * Example:
 *   node test-patch-endpoint.cjs ../tests/fixtures/validation-failures/add-related-tasks-to-a-change-schedule-2025-11-11T07-02-54.html 2a8a89fe-dba5-819f-878d-ef61ebb4545e
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Parse command-line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node test-patch-endpoint.cjs <html-file> <page-id> [--dry-run]');
  console.error('');
  console.error('Example:');
  console.error('  node test-patch-endpoint.cjs ../tests/fixtures/validation-failures/add-related-tasks-to-a-change-schedule-2025-11-11T07-02-54.html 2a8a89fe-dba5-819f-878d-ef61ebb4545e');
  process.exit(1);
}

const htmlFile = args[0];
const pageId = args[1];
const dryRun = args.includes('--dry-run');

// Validate inputs
if (!fs.existsSync(htmlFile)) {
  console.error(`❌ HTML file not found: ${htmlFile}`);
  process.exit(1);
}

if (!pageId || pageId.length !== 36) {
  console.error(`❌ Invalid page ID format: ${pageId}`);
  console.error('   Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with hyphens)');
  process.exit(1);
}

// Convert page ID to 32-char format (remove hyphens)
const pageId32 = pageId.replace(/-/g, '');
if (pageId32.length !== 32) {
  console.error(`❌ Page ID must be 32 characters without hyphens: ${pageId32}`);
  process.exit(1);
}

console.log('🧪 PATCH Endpoint Test');
console.log('======================');
console.log(`📄 HTML file: ${htmlFile}`);
console.log(`🆔 Page ID: ${pageId}`);
console.log(`🆔 Page ID (32-char): ${pageId32}`);
console.log(`🧪 Dry run: ${dryRun ? 'YES' : 'NO'}`);
console.log('');

// Read HTML file
const html = fs.readFileSync(htmlFile, 'utf8');
console.log(`✅ Read ${html.length} characters from HTML file`);

// Extract title from filename
const filename = path.basename(htmlFile, '.html');
const titleMatch = filename.match(/^(.+?)-\d{4}-\d{2}-\d{2}T/);
const title = titleMatch ? titleMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Test Page';

console.log(`📝 Extracted title: ${title}`);
console.log('');

// Prepare request payload
const payload = JSON.stringify({
  title,
  contentHtml: html,
  dryRun
});

// Configure request
const options = {
  hostname: 'localhost',
  port: 3004,
  path: `/api/W2N/${pageId32}`,
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('🚀 Sending PATCH request to proxy server...');
console.log(`   URL: http://localhost:3004/api/W2N/${pageId32}`);
console.log(`   Payload size: ${Buffer.byteLength(payload)} bytes`);
console.log('');

// Send request
const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`📥 Response status: ${res.statusCode}`);
    console.log('');
    
    try {
      const response = JSON.parse(data);
      
      if (res.statusCode === 200) {
        console.log('✅ SUCCESS!');
        console.log('===========');
        
        // Extract data from sendSuccess wrapper
        const data = response.data || response;
        
        if (dryRun) {
          console.log(`🧪 Dry run mode - no changes made`);
          console.log(`📦 Extracted ${data.blocksExtracted} blocks`);
          console.log(`🎬 Has videos: ${data.hasVideos ? 'YES' : 'NO'}`);
          
          // Show block type breakdown (from response or calculate from children)
          let blockTypes = data.blockTypes || {};
          if (Object.keys(blockTypes).length === 0 && data.children) {
            data.children.forEach(block => {
              blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
            });
          }
          
          console.log('');
          console.log('📊 Block type breakdown:');
          Object.entries(blockTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
          });
        } else {
          console.log(`🆔 Page ID: ${data.pageId}`);
          console.log(`🔗 Page URL: ${data.pageUrl}`);
          console.log(`🗑️ Blocks deleted: ${data.blocksDeleted}`);
          console.log(`📤 Blocks added: ${data.blocksAdded}`);
          console.log(`🎬 Has videos: ${data.hasVideos ? 'YES' : 'NO'}`);
          
          if (data.validation) {
            console.log('');
            console.log('🔍 Validation Results:');
            console.log(`   Valid: ${data.validation.valid ? '✅ YES' : '❌ NO'}`);
            
            if (data.validation.issues?.length > 0) {
              console.log(`   Issues found: ${data.validation.issues.length}`);
              data.validation.issues.forEach((issue, i) => {
                console.log(`   ${i + 1}. ${issue.type}: ${issue.message}`);
              });
            }
            
            if (data.validation.counts) {
              console.log('');
              console.log('   Expected vs Actual counts:');
              Object.entries(data.validation.counts).forEach(([type, counts]) => {
                const status = counts.expected === counts.actual ? '✅' : '⚠️';
                console.log(`   ${status} ${type}: expected ${counts.expected}, got ${counts.actual}`);
              });
            }
          }
        }
        
        console.log('');
        console.log('✅ Test passed!');
      } else {
        console.log('❌ FAILED!');
        console.log('==========');
        console.log(JSON.stringify(response, null, 2));
      }
    } catch (err) {
      console.error('❌ Failed to parse response:', err.message);
      console.error('Raw response:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('❌ Request failed:', err.message);
  console.error('');
  console.error('Make sure the proxy server is running:');
  console.error('  npm start');
  process.exit(1);
});

req.write(payload);
req.end();
