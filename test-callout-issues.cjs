const axios = require('axios');

// Test 1: "Before you begin" with "Role required:"
const test1Html = `
<section class="section prereq">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: admin</p>
</section>
`;

// Test 2: Note callout in list item with wrapper
const test2Html = `
<ul class="ul">
  <li class="li">
    Admin account in GitHub.
    <div class="itemgroup info">
      <div class="note note note_note">
        <span class="note__title">Note:</span>
        The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.
      </div>
    </div>
  </li>
</ul>
`;

async function runTest(html, testName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${testName}`);
  console.log('='.repeat(60));
  
  try {
    const response = await axios.post('http://localhost:3004/api/W2N', {
      title: testName,
      contentHtml: html,
      dryRun: true
    });
    
    const blocks = response.data.data.children;
    console.log(`✅ Got ${blocks.length} block(s)\n`);
    
    blocks.forEach((block, i) => {
      console.log(`Block ${i + 1}: ${block.type}`);
      
      if (block.type === 'callout') {
        const content = block.callout.rich_text.map(rt => rt.text.content).join('');
        console.log(`  Content: "${content}"`);
        console.log(`  Rich text elements: ${block.callout.rich_text.length}`);
        block.callout.rich_text.forEach((rt, j) => {
          console.log(`    [${j}]: "${rt.text.content}" ${rt.text.content === '\n' ? '(NEWLINE)' : ''}`);
        });
      } else if (block.type === 'paragraph') {
        const content = block.paragraph.rich_text.map(rt => rt.text.content).join('');
        console.log(`  Content: "${content}"`);
      } else if (block.type === 'bulleted_list_item') {
        const content = block.bulleted_list_item.rich_text.map(rt => rt.text.content).join('');
        console.log(`  List item: "${content}"`);
      }
      console.log();
    });
  } catch (error) {
    console.error('❌ Error:', error.response?.data?.message || error.message);
  }
}

(async () => {
  await runTest(test1Html, 'Before you begin - Role required');
  await runTest(test2Html, 'Note callout in list item');
})();
