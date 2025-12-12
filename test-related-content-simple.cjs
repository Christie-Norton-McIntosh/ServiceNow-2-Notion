#!/usr/bin/env node

/**
 * Simple Related Content Test
 * Test the current v11.0.241 approach with the Activate Procurement HTML
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Test HTML from Activate Procurement page
const TEST_HTML = fs.readFileSync(path.join(__dirname, 'tests/fixtures/activate-procurement-with-placeholders.html'), 'utf8');

const CONFIG = {
  serverUrl: 'http://localhost:3004',
  testTitle: 'Activate Procurement - Simple Test',
  testDatabaseId: '2b2a89fedba58033a6aeee258611a908',
  timeout: 30000
};

// Utility functions
function makeHttpRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ statusCode: res.statusCode, response });
        } catch (e) {
          resolve({ statusCode: res.statusCode, response: body });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Check if response contains Related Content blocks
function checkForRelatedContent(response) {
  if (!response.children || !Array.isArray(response.children)) {
    console.log('❌ No children array in response');
    return false;
  }

  console.log(`📊 Response has ${response.children.length} children`);

  // Look for heading blocks with "Related Content"
  const headingBlocks = response.children.filter(block =>
    block.type === 'heading_2' || block.type === 'heading_3' || block.type === 'heading_1'
  );

  console.log(`📊 Found ${headingBlocks.length} heading blocks`);

  const relatedContentHeadings = headingBlocks.filter(block => {
    const text = getBlockText(block);
    const hasRelated = text && text.toLowerCase().includes('related content');
    console.log(`   Heading: "${text}" - Related Content: ${hasRelated}`);
    return hasRelated;
  });

  if (relatedContentHeadings.length > 0) {
    console.log(`✅ Found ${relatedContentHeadings.length} Related Content heading(s)`);
    return true;
  }

  // Also check for any text blocks containing "Related Content"
  const textBlocks = response.children.filter(block =>
    block.type === 'paragraph' || block.type === 'bulleted_list_item'
  );

  console.log(`📊 Found ${textBlocks.length} text blocks`);

  const relatedContentText = textBlocks.filter(block => {
    const text = getBlockText(block);
    const hasRelated = text && text.toLowerCase().includes('related content');
    if (hasRelated) {
      console.log(`   Text block: "${text}" - Related Content: ${hasRelated}`);
    }
    return hasRelated;
  });

  if (relatedContentText.length > 0) {
    console.log(`✅ Found Related Content in text blocks`);
    return true;
  }

  console.log('❌ No Related Content found in response');
  return false;
}

// Extract text from a Notion block
function getBlockText(block) {
  if (!block[block.type] || !block[block.type].rich_text) {
    return null;
  }

  return block[block.type].rich_text
    .map(rt => rt.plain_text || '')
    .join('')
    .trim();
}

// Main test function
async function runSimpleTest() {
  console.log('🧪 Simple Related Content Test');
  console.log('=' .repeat(40));
  console.log('Testing current v11.0.241 approach with Activate Procurement HTML');

  // Check if server is running
  try {
    console.log('🔍 Checking server status...');
    const healthCheck = await makeHttpRequest(`${CONFIG.serverUrl}/health`);
    if (healthCheck.statusCode !== 200) {
      console.log('❌ Server is not responding. Please start the server first.');
      console.log('Run: npm start');
      process.exit(1);
    }
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Cannot connect to server:', error.message);
    console.log('Please start the server first with: npm start');
    process.exit(1);
  }

  // Test with dryrun API call
  console.log('\n📡 Sending test HTML to server with dryrun...');
  console.log(`📄 HTML length: ${TEST_HTML.length} characters`);

  // Count placeholders in HTML
  const placeholderCount = (TEST_HTML.match(/contentPlaceholder/g) || []).length;
  const relatedContentCount = (TEST_HTML.match(/Related Content/gi) || []).length;
  console.log(`📊 Found ${placeholderCount} contentPlaceholder divs`);
  console.log(`📊 Found ${relatedContentCount} "Related Content" mentions`);

  const testData = {
    title: CONFIG.testTitle,
    databaseId: CONFIG.testDatabaseId,
    contentHtml: TEST_HTML,
    dryRun: true
  };

  try {
    const result = await makeHttpRequest(`${CONFIG.serverUrl}/api/W2N`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, testData);

    if (result.statusCode !== 200) {
      console.log(`❌ API call failed with status ${result.statusCode}`);
      console.log('Response:', result.response);
      return;
    }

    console.log('✅ API call successful');

    // Analyze the response
    const response = result.response;
    const hasRelatedContent = checkForRelatedContent(response);

    if (hasRelatedContent) {
      console.log('\n🎉 SUCCESS! Related Content is working!');
      console.log('The current v11.0.241 approach successfully extracts Related Content.');
      console.log('\n📝 Next steps:');
      console.log('   1. Build and deploy: npm run build');
      console.log('   2. Reload userscript in Tampermonkey');
      console.log('   3. Test extraction on the real Activate Procurement page');
    } else {
      console.log('\n❌ FAILURE: Related Content not found in response');
      console.log('The current approach is not working. Need to investigate further.');

      // Save response for debugging
      const debugFile = path.join(__dirname, 'debug-response.json');
      fs.writeFileSync(debugFile, JSON.stringify(response, null, 2));
      console.log(`📄 Full response saved to: ${debugFile}`);

      console.log('\n🔍 Debugging info:');
      console.log(`   - Response has ${response.children ? response.children.length : 0} children`);
      if (response.children) {
        const blockTypes = {};
        response.children.forEach(block => {
          blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
        });
        console.log(`   - Block types: ${JSON.stringify(blockTypes)}`);
      }
    }

  } catch (error) {
    console.log('❌ Error during test:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  runSimpleTest().catch(console.error);
}