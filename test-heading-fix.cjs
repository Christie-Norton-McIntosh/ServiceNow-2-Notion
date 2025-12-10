#!/usr/bin/env node

/**
 * Test script to verify heading fix (v11.0.189)
 * Tests one Pattern A page with dryRun to check if headings are now preserved
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const pageDir = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update';
const testFile = 'predictive-intelligence-for-incident-failure-2025-12-08T01-37-16.html';
const filePath = path.join(pageDir, testFile);

console.log('\n========================================');
console.log('🧪 HEADING FIX TEST (v11.0.189)');
console.log('========================================\n');

if (!fs.existsSync(filePath)) {
  console.error(`❌ File not found: ${filePath}`);
  process.exit(1);
}

const html = fs.readFileSync(filePath, 'utf8');

// Extract metadata from HTML comments
let pageId = null;
let oldHeadingCount = null;
let oldListCount = null;

const metadataMatch = html.match(/Page ID: ([a-f0-9-]{32,})/);
if (metadataMatch) pageId = metadataMatch[1];

const headingMatch = html.match(/Headings: (\d+) → (\d+)/);
if (headingMatch) {
  oldHeadingCount = parseInt(headingMatch[1]);
}

const listMatch = html.match(/Unordered lists: (\d+) → (\d+)/);
if (listMatch) {
  oldListCount = parseInt(listMatch[1]);
}

console.log('📋 Test Configuration:');
console.log(`   File: ${testFile}`);
console.log(`   Page ID: ${pageId || 'NOT FOUND'}`);
console.log(`   Old Heading Count (HTML): ${oldHeadingCount}`);
console.log(`   Old List Count (HTML): ${oldListCount}`);

if (!pageId) {
  console.error('\n❌ Could not extract page ID from metadata');
  process.exit(1);
}

// Prepare PATCH request
const payload = {
  title: 'Test: Predictive Intelligence for Incident',
  contentHtml: html,
  dryRun: true
};

console.log('\n📤 Sending dryRun PATCH request to /api/W2N/' + pageId.substring(0, 8) + '...');
console.log('   Mode: dryRun (validation only, no Notion update)');

const postData = JSON.stringify(payload);

const options = {
  hostname: 'localhost',
  port: 3004,
  path: `/api/W2N/${pageId}`,
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length
  }
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', chunk => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`\n📥 Response Status: ${res.statusCode}`);

    try {
      const result = JSON.parse(data);

      if (res.statusCode === 200) {
        console.log('\n✅ DRY RUN SUCCESSFUL\n');

        console.log('📊 Block Generation Results:');
        console.log(`   Total blocks generated: ${result.children?.length || 0}`);

        // Count block types
        const blockCounts = {};
        (result.children || []).forEach(block => {
          blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
        });

        Object.entries(blockCounts).forEach(([type, count]) => {
          console.log(`   - ${type}: ${count}`);
        });

        // Check for headings
        const headingCount = Object.values(blockCounts).reduce((sum, count, _, arr) => {
          const types = Object.keys(blockCounts);
          const idx = types.indexOf(type);
          if (type.startsWith('heading_')) return sum + count;
          return sum;
        }, 0);

        const headings = (result.children || []).filter(b => b.type.startsWith('heading_'));
        console.log(`\n🎯 HEADING ANALYSIS:`);
        console.log(`   Headings created: ${headings.length}`);
        if (headings.length > 0) {
          headings.slice(0, 3).forEach((h, i) => {
            const text = h[`heading_${h.type.split('_')[1]}`]?.rich_text?.[0]?.text?.content || 'N/A';
            console.log(`   [${i + 1}] ${h.type}: "${text.substring(0, 60)}"`);
          });
        }

        // Status
        if (oldHeadingCount > 0 && headings.length > 0) {
          console.log(`\n✨ FIX VERIFIED: Headings are now being created!`);
          console.log(`   Expected: ${oldHeadingCount} headings`);
          console.log(`   Actual: ${headings.length} headings`);
        } else if (headings.length === 0) {
          console.log(`\n⚠️  Headings still not created (expected ${oldHeadingCount})`);
        }

      } else {
        console.log('\n❌ DRY RUN FAILED');
        console.log(`   Status: ${res.statusCode}`);
        console.log(`   Error: ${result.error || 'Unknown error'}`);
      }

    } catch (e) {
      console.log('\n❌ Failed to parse response');
      console.log(`   Error: ${e.message}`);
      console.log(`   Raw data: ${data.substring(0, 200)}`);
    }

    console.log('\n========================================\n');
  });
});

req.on('error', (e) => {
  console.error(`\n❌ Request failed: ${e.message}`);
  console.error(`   Is the server running on port 3004?`);
  process.exit(1);
});

req.write(postData);
req.end();
