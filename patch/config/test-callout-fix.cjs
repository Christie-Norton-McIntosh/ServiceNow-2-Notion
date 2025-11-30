#!/usr/bin/env node
/**
 * Test the callout extraction fix with Performance overview page
 */

const fs = require('fs');
const http = require('http');

const HTML_FILE = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/performance-overview-2025-11-13T06-49-50.html';
const SERVER_URL = 'http://localhost:3004';
const DATABASE_ID = '282a89fedba5815e91f0db972912ef9f';

function makeRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 120000
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(data);
    req.end();
  });
}

async function testCalloutFix() {
  console.log('📄 Testing callout extraction fix with Performance overview');
  console.log('   HTML file:', HTML_FILE);

  // Read HTML
  const htmlContent = fs.readFileSync(HTML_FILE, 'utf-8');
  console.log('   HTML size:', (htmlContent.length / 1024).toFixed(1), 'KB\n');

  // Step 1: Dry run to see block structure
  console.log('🔍 Step 1: Dry-run validation');
  const dryRunPayload = {
    title: 'Performance Overview (DRY RUN)',
    databaseId: DATABASE_ID,
    contentHtml: htmlContent,
    dryRun: true
  };

  try {
    const dryResult = await makeRequest('/api/W2N', dryRunPayload);
    
    // Response is wrapped: { success: true, data: { children, hasVideos, warnings } }
    const data = dryResult.data || dryResult;
    const children = data.children;
    
    if (!children) {
      console.log('❌ Dry-run failed - no children array');
      console.log('Response keys:', Object.keys(dryResult));
      return false;
    }

    const calloutBlocks = children.filter(b => b.type === 'callout');
    console.log(`   Total blocks: ${children.length}`);
    console.log(`   Callout blocks: ${calloutBlocks.length}`);
    
    if (calloutBlocks.length >= 5) {
      console.log('   ✅ Found 5+ callouts in dry-run (fix appears to work!)\n');
    } else {
      console.log(`   ⚠️  Only found ${calloutBlocks.length} callouts (expected 5+)\n`);
    }

    // Step 2: Create actual page
    console.log('🚀 Step 2: Creating Notion page');
    const createPayload = {
      title: 'Performance Overview (CALLOUT FIX TEST)',
      databaseId: DATABASE_ID,
      contentHtml: htmlContent,
      url: 'https://example.servicenow.com/callout-fix-test'
      // Skip custom properties to avoid validation errors
    };

    const createResult = await makeRequest('/api/W2N', createPayload);
    
    if (!createResult.success) {
      console.log('❌ Page creation failed');
      if (createResult.error) {
        console.log('   Error:', createResult.error);
      }
      if (createResult.message) {
        console.log('   Message:', createResult.message);
      }
      return false;
    }

    const pageId = createResult.pageId;
    const validation = createResult.validation || {};
    
    console.log(`   ✅ Page created: ${pageId}`);
    console.log(`   URL: ${createResult.url}\n`);

    // Step 3: Check validation
    console.log('📊 Step 3: Validation results');
    console.log(`   Has Errors: ${validation.hasErrors}`);
    
    if (validation.source) {
      console.log(`\n   Source HTML counts:`);
      console.log(`      Tables:   ${validation.source.tables || 0}`);
      console.log(`      Images:   ${validation.source.images || 0}`);
      console.log(`      Lists:    ${validation.source.lists || 0}`);
      console.log(`      Callouts: ${validation.source.callouts || 0}`);
    }
    
    if (validation.notion) {
      console.log(`\n   Notion page counts:`);
      console.log(`      Tables:   ${validation.notion.tables || 0}`);
      console.log(`      Images:   ${validation.notion.images || 0}`);
      console.log(`      Lists:    ${validation.notion.lists || 0}`);
      console.log(`      Callouts: ${validation.notion.callouts || 0}`);
    }
    
    if (validation.errors && validation.errors.length > 0) {
      console.log(`\n   ❌ Validation errors:`);
      validation.errors.forEach(err => console.log(`      - ${err}`));
      return false;
    } else {
      console.log(`\n   ✅ No validation errors - fix successful!`);
      return true;
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

testCalloutFix()
  .then(success => {
    console.log(`\n${success ? '✅ TEST PASSED' : '❌ TEST FAILED'}`);
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
