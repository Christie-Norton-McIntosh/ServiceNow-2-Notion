#!/usr/bin/env node

/**
 * test-text-after-ol.cjs
 * Test extraction of text that appears after </ol> but inside div.p wrapper
 */

const http = require('http');

// Minimal HTML with the exact structure causing the issue
const testHtml = `
<article class="dita" id="test">
  <div class="body">
    <section class="section">
      <ol class="ol">
        <li class="li">Add filters to a class node: Apply filters to narrow down a class query to a specific set of CIs or to a single specific CI.
          <div class="p">
            <ol class="ol" type="a">
              <li class="li">Point to the node to add a filter to</li>
              <li class="li">In the Filters section, add attribute</li>
              <li class="li">Close the Filters section</li>
            </ol>
            For example: Add a filter for database location to query for databases located in Seattle.
          </div>
          <p class="p">Select Applied Filters in the right-side bar to view all filters for each node on the canvas.</p>
        </li>
      </ol>
    </section>
  </div>
</article>
`;

const payload = JSON.stringify({
  title: 'Test: Text After OL',
  databaseId: 'f6aeba1c-e5ae-4d44-81e9-cbbf0f3797d4',
  contentHtml: testHtml,
  url: 'http://test.local/text-after-ol',
  dryRun: true
});

const options = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/W2N',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('📤 Sending test extraction...\n');

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      const result = JSON.parse(data);
      console.log('\n✅ Test extraction completed\n');
      console.log('📊 Results:');
      console.log(`   Total blocks: ${result.children ? result.children.length : 0}`);
      
      if (result.children) {
        result.children.forEach((block, idx) => {
          if (block.type === 'numbered_list_item') {
            const textContent = block.numbered_list_item?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
            console.log(`\n[${idx}] numbered_list_item:`);
            console.log(`   Text: ${textContent.substring(0, 200)}${textContent.length > 200 ? '...' : ''}`);
            console.log(`   Contains "For example": ${textContent.includes('For example')}`);
            console.log(`   Children: ${block.numbered_list_item?.children?.length || 0}`);
          }
        });
      }
    } else {
      console.error(`\n❌ Error: ${res.statusCode}`);
      console.error(data);
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ Request failed: ${e.message}`);
});

req.write(payload);
req.end();
