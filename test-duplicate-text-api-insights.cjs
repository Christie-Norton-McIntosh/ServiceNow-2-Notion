/**
 * Test for duplicate text in "Identifying and remediating missing API data in API Insights"
 */

const http = require('http');
const fs = require('fs');

const html = fs.readFileSync('patch/pages/updated-pages/identifying-and-remediating-missing-api-data-in-api-insights-2025-11-22T05-31-58.html', 'utf8');

const data = JSON.stringify({
  title: 'Test Duplicate Text Detection',
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

console.log('🔍 Testing for duplicate text/blocks...\n');

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error('❌ Request failed:', res.statusCode);
      console.log(responseData.substring(0, 500));
      return;
    }
    
    try {
      const json = JSON.parse(responseData);
      const children = json.children || json.data?.children;
      
      if (!children) {
        console.error('❌ No children in response');
        return;
      }
      
      console.log(`📊 Total blocks: ${children.length}\n`);
      
      // Group blocks by type
      const blocksByType = {};
      children.forEach(b => {
        blocksByType[b.type] = blocksByType[b.type] || [];
        blocksByType[b.type].push(b);
      });
      
      console.log('Block types:');
      Object.entries(blocksByType).forEach(([type, blocks]) => {
        console.log(`  ${type}: ${blocks.length}`);
      });
      
      // Check for duplicate paragraphs
      console.log('\n🔍 Checking for duplicate paragraphs...');
      const paragraphs = blocksByType.paragraph || [];
      const paragraphTexts = new Map();
      
      paragraphs.forEach((p, idx) => {
        const text = p.paragraph?.rich_text?.map(rt => rt.text?.content || '').join('').trim();
        if (text.length > 20) { // Only check substantial text
          if (paragraphTexts.has(text)) {
            paragraphTexts.get(text).push(idx);
          } else {
            paragraphTexts.set(text, [idx]);
          }
        }
      });
      
      const duplicates = Array.from(paragraphTexts.entries()).filter(([text, indices]) => indices.length > 1);
      
      if (duplicates.length > 0) {
        console.log(`❌ Found ${duplicates.length} duplicate paragraph(s):\n`);
        duplicates.forEach(([text, indices]) => {
          console.log(`  Text: "${text.substring(0, 80)}..."`);
          console.log(`  Appears at indices: ${indices.join(', ')}\n`);
        });
      } else {
        console.log('✅ No duplicate paragraphs found');
      }
      
      // Check for duplicate callouts
      console.log('\n🔍 Checking for duplicate callouts...');
      const callouts = blocksByType.callout || [];
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
      
      const calloutDuplicates = Array.from(calloutTexts.entries()).filter(([key, indices]) => indices.length > 1);
      
      if (calloutDuplicates.length > 0) {
        console.log(`❌ Found ${calloutDuplicates.length} duplicate callout(s):\n`);
        calloutDuplicates.forEach(([key, indices]) => {
          const [emoji, text] = key.split(':');
          console.log(`  ${emoji} "${text.substring(0, 80)}..."`);
          console.log(`  Appears at indices: ${indices.join(', ')}\n`);
        });
      } else {
        console.log('✅ No duplicate callouts found');
      }
      
      // Show all callouts for reference
      console.log('\n📋 All callouts:');
      callouts.forEach((c, idx) => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 80);
        const emoji = c.callout?.icon?.emoji;
        console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
      });
      
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.log(responseData.substring(0, 500));
    }
  });
});

req.on('error', (e) => console.error('❌ Error:', e.message));
req.write(data);
req.end();
