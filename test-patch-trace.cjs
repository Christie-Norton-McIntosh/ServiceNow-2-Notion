/**
 * PATCH viewing-api-data-connections to trace callout duplication
 */

const fs = require('fs');
const path = require('path');

async function testPatch() {
  const htmlFile = path.join(__dirname, 'patch/pages/pages-to-update/viewing-api-data-connections-for-a-service-graph-connector-w-patch-validation-failed-2025-11-22T06-30-54.html');
  const pageId = '2b3a89fe-dba5-8177-96ac-deac63da97bb';
  
  console.log('📂 Reading HTML file...');
  let html = fs.readFileSync(htmlFile, 'utf8');
  
  // Strip HTML comment metadata
  html = html.replace(/^<!--[\s\S]*?-->\s*/gm, '');
  
  console.log(`📄 HTML length: ${html.length} chars\n`);
  console.log(`🔄 PATCHing page ${pageId}...\n`);
  
  const payload = {
    title: 'Test PATCH: viewing-api-data-connections',
    contentHtml: html,
    url: 'https://example.com/test'
  };
  
  try {
    const response = await fetch(`http://localhost:3004/api/W2N/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('❌ PATCH failed:', response.status, response.statusText);
      console.error('Response:', JSON.stringify(result, null, 2));
      return;
    }
    
    console.log('✅ PATCH successful\n');
    console.log('Response:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

console.log('🚀 Starting PATCH test...');
console.log('📋 Check server logs for [CALLOUT-TRACE] entries\n');

testPatch();
