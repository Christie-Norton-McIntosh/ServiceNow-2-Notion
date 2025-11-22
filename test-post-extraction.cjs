/**
 * Test POST extraction (dry-run) for viewing-api-data-connections
 */

const fs = require('fs');
const path = require('path');

async function testPostExtraction() {
  const htmlFile = path.join(__dirname, 'patch/pages/pages-to-update/viewing-api-data-connections-for-a-service-graph-connector-w-patch-validation-failed-2025-11-22T06-30-54.html');
  
  console.log('📂 Reading HTML file...');
  let html = fs.readFileSync(htmlFile, 'utf8');
  
  // Strip HTML comment metadata
  html = html.replace(/^<!--[\s\S]*?-->\s*/gm, '');
  
  console.log(`📄 HTML length: ${html.length} chars\n`);
  
  // Make POST request with dryRun=true
  console.log('🔄 Sending POST /api/W2N with dryRun=true...\n');
  
  const payload = {
    title: 'Test: viewing-api-data-connections',
    databaseId: 'test-database-id',
    contentHtml: html,
    url: 'https://example.com/test',
    dryRun: true
  };
  
  try {
    const response = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error('❌ Request failed:', response.status, response.statusText);
      console.error('Response:', result);
      return;
    }
    
    console.log(`✅ Extracted ${result.blocksExtracted} blocks\n`);
    
    // Count block types
    console.log('📊 Block types:');
    Object.entries(result.blockTypes || {}).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // Focus on callouts
    const calloutCount = result.blockTypes?.callout || 0;
    console.log(`\n📊 Callout count: ${calloutCount}`);
    console.log('Expected: 2 (from 2 prereq sections)\n');
    
    // Check for duplicates in returned children
    const callouts = result.children.filter(b => b.type === 'callout');
    
    if (callouts.length > 0) {
      console.log('📋 All callouts:');
      callouts.forEach((c, idx) => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
        const emoji = c.callout?.icon?.emoji;
        console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
      });
    }
    
    // Check for duplicates
    const calloutTexts = new Map();
    callouts.forEach((c, idx) => {
      const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').trim();
      const emoji = c.callout?.icon?.emoji;
      const key = `${emoji}:${text}`;
      
      if (calloutTexts.has(key)) {
        calloutTexts.get(key).push(idx);
      } else {
        calloutTexts.set(key, [idx]);
      }
    });
    
    const duplicates = Array.from(calloutTexts.entries()).filter(([key, items]) => items.length > 1);
    
    if (duplicates.length > 0) {
      console.log(`\n❌ Found ${duplicates.length} duplicate callout(s) in extraction:`);
      duplicates.forEach(([key, items]) => {
        const [emoji, text] = key.split(':');
        console.log(`  ${emoji} "${text.substring(0, 80)}..."`);
        console.log(`  Appears ${items.length} times at indices: ${items.join(', ')}\n`);
      });
    } else {
      console.log('\n✅ No duplicate callouts in extraction');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testPostExtraction();
