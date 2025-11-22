/**
 * Direct test: extract blocks from viewing-api-data-connections HTML
 * Bypass HTTP server to see raw extraction output
 */

const fs = require('fs');
const path = require('path');

// Import the HTML-to-blocks converter directly
const servicenow = require('./server/services/servicenow.cjs');

async function testDirectExtraction() {
  const htmlFile = path.join(__dirname, 'patch/pages/pages-to-update/viewing-api-data-connections-for-a-service-graph-connector-w-patch-validation-failed-2025-11-22T06-30-54.html');
  
  console.log('📂 Reading HTML file...');
  let html = fs.readFileSync(htmlFile, 'utf8');
  
  // Strip HTML comment metadata
  html = html.replace(/^<!--[\s\S]*?-->\s*/gm, '');
  
  console.log(`📄 HTML length: ${html.length} chars\n`);
  
  console.log('🔄 Extracting blocks...');
  const result = await servicenow.extractContentFromHtml(html);
  
  console.log(`\n✅ Extracted ${result.blocks.length} blocks\n`);
  
  // Count callouts
  const callouts = result.blocks.filter(b => b.type === 'callout');
  console.log(`📊 Callout count: ${callouts.length}`);
  console.log('Expected: 2 (from 2 prereq sections)\n');
  
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
    console.log(`\n❌ Found ${duplicates.length} duplicate callout(s):`);
    duplicates.forEach(([key, items]) => {
      const [emoji, text] = key.split(':');
      console.log(`  ${emoji} "${text.substring(0, 80)}..."`);
      console.log(`  Appears ${items.length} times at indices: ${items.join(', ')}\n`);
    });
  } else {
    console.log('\n✅ No duplicate callouts in extraction');
  }
}

testDirectExtraction().catch(console.error);
