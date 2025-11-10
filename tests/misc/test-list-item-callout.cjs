const axios = require('axios');

// Test callout inside div.itemgroup.info inside a list item
const html = `
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

console.log('Testing list item with callout inside div.itemgroup.info...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'List Item Callout Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`\n✅ Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    
    if (block.type === 'bulleted_list_item') {
      const content = block.bulleted_list_item.rich_text.map(rt => rt.text.content).join('');
      console.log(`  List item text: "${content}"`);
      
      const children = block.bulleted_list_item.children || [];
      console.log(`  Has ${children.length} immediate children`);
      
      children.forEach((child, ci) => {
        console.log(`    Child ${ci + 1}: ${child.type}`);
        if (child.type === 'callout') {
          const calloutText = child.callout.rich_text.map(rt => rt.text.content).join('');
          console.log(`      Callout text: "${calloutText}"`);
        }
      });
    } else if (block.type === 'callout') {
      const content = block.callout.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Callout text: "${content}"`);
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
  if (error.response?.data?.details) {
    console.error('Details:', JSON.stringify(error.response.data.details, null, 2));
  }
});
