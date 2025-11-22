const fs = require('fs');

const htmlFile = 'patch/pages/pages-to-update/create-a-ci-reconciliation-rule-2025-11-22t05-37-42-patch-validation-failed-2025-11-22T05-54-51.html';
const html = fs.readFileSync(htmlFile, 'utf8');

// Extract content HTML
const contentMatch = html.match(/<div class="zDocsTopicPageBody"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>$/);
const contentHtml = contentMatch ? contentMatch[0] : html;

console.log('📋 Testing extraction for: CI Reconciliation Rule');
console.log('━'.repeat(50));

fetch('http://localhost:3004/api/W2N', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Test CI Reconciliation Rule',
    databaseId: '282a89fedba5815e91f0db972912ef9f',
    contentHtml: contentHtml,
    dryRun: true
  })
})
.then(r => r.json())
.then(data => {
  const blocks = data.children || [];
  console.log(`\n📊 Extraction Results:`);
  console.log('━'.repeat(50));
  console.log(`\n✅ Total blocks: ${blocks.length}`);
  
  // Count callouts
  const callouts = blocks.filter(b => b.type === 'callout');
  console.log(`📢 Callout blocks found: ${callouts.length}\n`);
  
  // Show first 40 blocks
  console.log('📋 First 40 blocks:\n');
  blocks.slice(0, 40).forEach((block, i) => {
    const type = block.type;
    let content = '';
    
    if (type === 'heading_2' || type === 'heading_3') {
      content = block[type].rich_text.map(t => t.plain_text).join('');
    } else if (type === 'paragraph') {
      content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
    } else if (type === 'callout') {
      content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
    } else if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
      content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
    }
    
    console.log(`  [${String(i+1).padStart(2)}] ${type.padEnd(22)} ${content}`);
  });
  
  // Show all callouts with details
  console.log(`\n\n📢 All ${callouts.length} callouts with preview:\n`);
  callouts.forEach((callout, i) => {
    const text = callout.callout.rich_text.map(t => t.plain_text).join('');
    console.log(`  Callout ${i+1}:`);
    console.log(`    Preview: ${text.slice(0, 80)}...`);
    console.log('');
  });
})
.catch(err => console.error('Error:', err.message));
