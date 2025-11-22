const fs = require('fs');

const htmlFile = 'patch/pages/updated-pages/create-a-ci-reconciliation-rule-2025-11-22t05-37-42-patch-validation-failed-2025-11-22T05-54-51.html';
const html = fs.readFileSync(htmlFile, 'utf8');

// Extract content HTML
const contentMatch = html.match(/<div class="zDocsTopicPageBody"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>$/);
const contentHtml = contentMatch ? contentMatch[0] : html;

console.log('📋 Testing heading order for: CI Reconciliation Rule');
console.log('━'.repeat(70));

fetch('http://localhost:3004/api/W2N', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: 'Test Heading Order',
    databaseId: '282a89fedba5815e91f0db972912ef9f',
    contentHtml: contentHtml,
    dryRun: true
  })
})
.then(r => r.json())
.then(data => {
  const blocks = data.children || [];
  console.log(`\n✅ Total blocks: ${blocks.length}\n`);
  
  console.log('📋 Block sequence (showing structure):\n');
  
  let lastHeading = null;
  blocks.forEach((block, i) => {
    const type = block.type;
    let content = '';
    let prefix = '  ';
    
    if (type === 'heading_2' || type === 'heading_3') {
      content = block[type].rich_text.map(t => t.plain_text).join('');
      prefix = '\n🔷 ';
      lastHeading = content;
    } else if (type === 'paragraph') {
      content = block[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
    } else if (type === 'callout') {
      content = `📢 ${block[type].rich_text.map(t => t.plain_text).join('').slice(0, 50)}`;
    } else if (type === 'numbered_list_item') {
      content = `${i + 1}. ${block[type].rich_text.map(t => t.plain_text).join('').slice(0, 50)}`;
    } else if (type === 'table') {
      content = '📊 Table';
    }
    
    console.log(`${prefix}[${String(i+1).padStart(2)}] ${type.padEnd(22)} ${content}`);
  });
  
  console.log('\n\n🔍 Checking for heading bunching issue...\n');
  
  // Check if we have consecutive headings (bad pattern)
  let consecutiveHeadings = 0;
  let maxConsecutive = 0;
  let bunchingDetected = false;
  
  for (let i = 0; i < blocks.length - 1; i++) {
    const currentType = blocks[i].type;
    const nextType = blocks[i + 1].type;
    
    if ((currentType === 'heading_2' || currentType === 'heading_3') && 
        (nextType === 'heading_2' || nextType === 'heading_3')) {
      consecutiveHeadings++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveHeadings + 1);
      bunchingDetected = true;
    } else {
      consecutiveHeadings = 0;
    }
  }
  
  if (bunchingDetected) {
    console.log(`❌ HEADING BUNCHING DETECTED!`);
    console.log(`   Max consecutive headings: ${maxConsecutive}`);
    console.log(`   This means headings are separated from their content.\n`);
  } else {
    console.log(`✅ NO HEADING BUNCHING!`);
    console.log(`   Each heading is followed by its content.\n`);
  }
})
.catch(err => console.error('Error:', err.message));
