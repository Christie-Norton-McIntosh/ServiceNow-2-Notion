#!/usr/bin/env node
/**
 * Test extraction of create-a-ci-identification-rule page to debug missing callout
 */

const fs = require('fs');
const path = require('path');

async function testExtraction() {
  const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/create-a-ci-identification-rule-2025-11-22t05-37-00-patch-va-patch-validation-failed-2025-11-22T07-22-28.html');
  
  if (!fs.existsSync(htmlPath)) {
    console.error('❌ HTML file not found:', htmlPath);
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  console.log('\n📋 Testing extraction for: create-a-ci-identification-rule');
  console.log('━'.repeat(80));

  // Send to proxy for extraction
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Test CI Identification Rule Extraction',
      databaseId: '15c689a6dba5806497e0cbdbadf8e756',
      contentHtml: html,
      url: 'https://docs.servicenow.com/test',
      dryRun: true
    })
  });

  if (!response.ok) {
    console.error('❌ Request failed:', response.status, response.statusText);
    const text = await response.text();
    console.error('Response:', text);
    process.exit(1);
  }

  const result = await response.json();
  const data = result.data || result;
  
  console.log('\n📊 Extraction Results:');
  console.log('━'.repeat(80));
  
  // Check if children exist
  if (!data.children) {
    console.error('❌ No children in result');
    console.log('Full result:', JSON.stringify(result, null, 2).substring(0, 500));
    process.exit(1);
  }
  
  // Count callouts in result
  const callouts = data.children.filter(block => block.type === 'callout');
  console.log(`\n✅ Total blocks: ${data.children.length}`);
  console.log(`📢 Callout blocks found: ${callouts.length}`);
  
  if (callouts.length > 0) {
    console.log('\n📋 Callout details:');
    callouts.forEach((callout, idx) => {
      const text = callout.callout?.rich_text?.[0]?.text?.content || '';
      const preview = text.substring(0, 100);
      console.log(`\n  Callout ${idx + 1}:`);
      console.log(`    Position: Block ${data.children.indexOf(callout) + 1}`);
      console.log(`    Preview: ${preview}${text.length > 100 ? '...' : ''}`);
    });
  }
  
  // Look for note patterns in HTML
  console.log('\n\n🔍 Notes found in source HTML:');
  console.log('━'.repeat(80));
  
  const noteMatches = html.match(/<div class="note note note_note">.*?<\/div>/gs) || [];
  console.log(`\n📝 Total note_note divs: ${noteMatches.length}`);
  
  noteMatches.forEach((match, idx) => {
    // Extract the note content
    const contentMatch = match.match(/<span class="note__title">Note:<\/span>\s*(.*?)(?=<\/div>)/s);
    if (contentMatch) {
      const content = contentMatch[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 100);
      console.log(`\n  Note ${idx + 1}: ${content}...`);
    }
  });
  
  console.log('\n\n━'.repeat(80));
  console.log('✅ Test complete\n');
}

testExtraction().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
