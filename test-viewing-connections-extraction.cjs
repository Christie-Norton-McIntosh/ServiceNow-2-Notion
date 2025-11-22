/**
 * Test viewing-api-data-connections page extraction
 */

const http = require('http');
const fs = require('fs');

const html = fs.readFileSync('patch/pages/pages-to-update/viewing-api-data-connections-for-a-service-graph-connector-w-patch-validation-failed-2025-11-22T06-30-54.html', 'utf8');

const data = JSON.stringify({
  title: 'Test Viewing API Connections',
  databaseId: '11de89fe23a78137afa0ebcbae8c02f2',
  contentHtml: html,
  dryRun: true
});

const options = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/W2N',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('🔍 Testing viewing-api-data-connections extraction...\n');

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    
    if (res.statusCode !== 200) {
      console.error('❌ Request failed with status:', res.statusCode);
      console.log('Response:', responseData.substring(0, 500));
      return;
    }
    
    try {
      const json = JSON.parse(responseData);
      const children = json.children || json.data?.children;
      
      if (!children) {
        console.error('❌ No children in response');
        return;
      }
      
      const callouts = children.filter(b => b.type === 'callout');
      
      console.log('\n📊 Results:');
      console.log('  Total blocks:', children.length);
      console.log('  Callouts:', callouts.length);
      console.log('  Expected: 2 (from 2 prereq sections)');
      
      console.log('\n📋 All callouts:');
      callouts.forEach((c, idx) => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 80);
        const emoji = c.callout?.icon?.emoji;
        console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
      });
      
      // Check for duplicates
      const calloutTexts = callouts.map(c => 
        c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').trim()
      );
      const uniqueTexts = new Set(calloutTexts);
      
      if (uniqueTexts.size < callouts.length) {
        console.log(`\n⚠️  ${callouts.length - uniqueTexts.size} duplicate callout(s) in extraction!`);
        
        // Show which are duplicates
        const textCounts = {};
        calloutTexts.forEach((text, idx) => {
          const key = text.substring(0, 50);
          textCounts[key] = textCounts[key] || [];
          textCounts[key].push(idx);
        });
        
        Object.entries(textCounts).forEach(([text, indices]) => {
          if (indices.length > 1) {
            console.log(`  Duplicate: "${text}..." at indices ${indices.join(', ')}`);
          }
        });
      }
      
      if (callouts.length === 2 && uniqueTexts.size === 2) {
        console.log('\n✅ SUCCESS: Correct number of unique callouts');
      } else {
        console.log(`\n❌ FAILED: Expected 2 unique callouts, got ${callouts.length} total (${uniqueTexts.size} unique)`);
      }
      
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.log('Response:', responseData.substring(0, 500));
    }
  });
});

req.on('error', (e) => console.error('❌ Error:', e.message));
req.write(data);
req.end();
