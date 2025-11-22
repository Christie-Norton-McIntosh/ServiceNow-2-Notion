const fs = require('fs');

const html = fs.readFileSync('patch/pages/updated-pages/create-a-ci-reconciliation-rule-2025-11-22t05-37-42-patch-validation-failed-2025-11-22T05-54-51.html', 'utf8');
const contentMatch = html.match(/<div class="zDocsTopicPageBody"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>$/);
const contentHtml = contentMatch ? contentMatch[0] : html;

console.log('Content HTML length:', contentHtml.length);
console.log('Sending POST request...\n');

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
.then(r => {
  console.log('Response status:', r.status);
  return r.json();
})
.then(response => {
  console.log('\nResponse keys:', Object.keys(response));
  console.log('Success:', response.success);
  
  if (response.data) {
    console.log('Data keys:', Object.keys(response.data));
    console.log('Data.children count:', response.data.children?.length || 0);
    
    if (response.data.children && response.data.children.length > 0) {
      const blocks = response.data.children;
      console.log('\n📋 Block sequence (first 30):\n');
      
      // Check for consecutive headings
      let consecutiveHeadings = 0;
      let maxConsecutive = 0;
      
      blocks.slice(0, 30).forEach((b, i) => {
        const type = b.type;
        let content = '';
        let prefix = '  ';
        
        if (type === 'heading_2' || type === 'heading_3') {
          content = b[type].rich_text.map(t => t.plain_text).join('');
          prefix = '\n🔷 ';
          
          // Check if previous block was also a heading
          if (i > 0) {
            const prevType = blocks[i-1].type;
            if (prevType === 'heading_2' || prevType === 'heading_3') {
              consecutiveHeadings++;
              maxConsecutive = Math.max(maxConsecutive, consecutiveHeadings + 1);
            } else {
              consecutiveHeadings = 0;
            }
          }
        } else if (type === 'paragraph') {
          content = b[type].rich_text.map(t => t.plain_text).join('').slice(0, 60);
          consecutiveHeadings = 0;
        } else if (type === 'callout') {
          content = `📢 ${b[type].rich_text.map(t => t.plain_text).join('').slice(0, 50)}`;
          consecutiveHeadings = 0;
        } else if (type === 'numbered_list_item') {
          content = b[type].rich_text.map(t => t.plain_text).join('').slice(0, 50);
          consecutiveHeadings = 0;
        } else {
          consecutiveHeadings = 0;
        }
        
        console.log(`${prefix}[${String(i+1).padStart(2)}] ${type.padEnd(22)} ${content}`);
      });
      
      if (maxConsecutive > 1) {
        console.log(`\n\n❌ HEADING BUNCHING DETECTED! Max consecutive headings: ${maxConsecutive}`);
      } else {
        console.log(`\n\n✅ NO HEADING BUNCHING! Each heading is followed by its content.`);
      }
    }
  }
  
  if (response.error) {
    console.log('\nError message:', response.error);
  }
})
.catch(err => console.error('Fetch error:', err.message));
