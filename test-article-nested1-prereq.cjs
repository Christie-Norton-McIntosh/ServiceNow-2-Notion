/**
 * Test article.nested1 with single prereq section
 */

const http = require('http');
const fs = require('fs');

// Read the extracted article HTML
const articleHtml = fs.readFileSync('/tmp/test-article-nested1.html', 'utf8');

const testHtml = `<article>${articleHtml}</article>`;

const data = JSON.stringify({
  title: 'Test Article Nested1 Prereq',
  databaseId: '11de89fe23a78137afa0ebcbae8c02f2',
  contentHtml: testHtml,
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

console.log('🔍 Testing article.nested1 with single prereq section...\n');

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
      
      // Count callouts
      const callouts = children.filter(b => b.type === 'callout');
      
      console.log('\n📊 Results:');
      console.log('  Total blocks:', children.length);
      console.log('  Callouts:', callouts.length);
      
      console.log('\n📋 All callouts:');
      callouts.forEach((c, idx) => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
        const emoji = c.callout?.icon?.emoji;
        console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
      });
      
      if (callouts.length === 1) {
        console.log('\n✅ SUCCESS: Only 1 callout created from 1 prereq section');
      } else {
        console.log(`\n❌ FAILED: Expected 1 callout, got ${callouts.length}`);
        
        // Check if they're duplicates
        if (callouts.length > 1) {
          const calloutTexts = callouts.map(c => 
            c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').trim()
          );
          const uniqueTexts = new Set(calloutTexts);
          if (uniqueTexts.size < callouts.length) {
            console.log(`⚠️  ${callouts.length - uniqueTexts.size} duplicate callout(s) detected!`);
          }
        }
      }
      
      console.log('\n📋 All block types:');
      const blockTypes = {};
      children.forEach(b => {
        blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
      });
      Object.entries(blockTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.log('Response:', responseData.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.write(data);
req.end();
