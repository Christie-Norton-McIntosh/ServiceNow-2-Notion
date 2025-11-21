/**
 * Test dry-run for Dynatrace guided setup page to verify complexity calculation
 */

const fs = require('fs');
const path = require('path');

const htmlPath = 'patch/pages/problematic-files/configure-service-graph-connector-for-observability-dynatrace-using-guided-setup-2025-11-20T04-31-23.html';
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract content (remove HTML comment metadata)
const commentEndIndex = html.indexOf('-->');
const content = commentEndIndex >= 0 ? html.substring(commentEndIndex + 3).trim() : html;

const payload = {
  title: 'Configure Service Graph Connector for Observability - Dynatrace using guided setup',
  databaseId: '2b1a89fedba5800000000000000000cd', // dummy ID for dry-run
  contentHtml: content,
  dryRun: true
};

console.log('📤 Sending dry-run POST request...');
console.log('   HTML length:', content.length, 'characters');

fetch('http://localhost:3004/api/W2N', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(r => r.json())
.then(data => {
  console.log('\n📊 Dry-run Results:');
  console.log('   Success:', data.success);
  
  if (data.success && data.data) {
    console.log('   Blocks extracted:', data.data.blocksExtracted);
    console.log('   Has videos:', data.data.hasVideos);
    console.log('\n📋 Block Type Distribution:');
    
    const types = data.data.blockTypes;
    const sortedTypes = Object.entries(types).sort((a, b) => b[1] - a[1]);
    
    sortedTypes.forEach(([type, count]) => {
      console.log(`      ${type}: ${count}`);
    });
    
    // Calculate expected complexity score
    const listItems = (types.numbered_list_item || 0) + (types.bulleted_list_item || 0);
    const tables = types.table || 0;
    const callouts = types.callout || 0;
    const totalBlocks = data.data.blocksExtracted;
    
    console.log('\n🧮 Complexity Analysis:');
    console.log(`   Total blocks: ${totalBlocks}`);
    console.log(`   List items: ${listItems}`);
    console.log(`   Tables: ${tables}`);
    console.log(`   Callouts: ${callouts}`);
    
    let score = totalBlocks / 10;
    score += tables * 5;
    score += callouts * 2;
    if (listItems > 100) {
      score += (listItems - 100) / 20;
    }
    
    const delayMs = Math.min(Math.round(score * 500), 30000);
    
    console.log(`   Complexity score: ${Math.round(score)}/100`);
    console.log(`   Pre-creation delay: ${delayMs}ms (${(delayMs / 1000).toFixed(1)}s)`);
    
  } else {
    console.log('   Error:', data.error || data.message);
    if (data.details) {
      console.log('   Details:', data.details);
    }
  }
})
.catch(err => {
  console.error('❌ Request failed:', err.message);
});
