const axios = require('axios');

// Test multiple callouts to see which one loses content
const html = `
<h2>First Callout (outside table)</h2>
<div class="note note note_note">
  <span class="note__title">Note:</span>
  <p>This is the first callout with regular content.</p>
</div>

<h2>Second Callout (outside table)</h2>
<div class="note note note_note">
  <span class="note__title">Note:</span>
  <p>This is the second callout with different content.</p>
</div>

<h2>Table with callout in cell</h2>
<table>
  <tr>
    <td>
      <div class="note note note_note">
        <span class="note__title">Note:</span>
        <p>This callout is inside a table cell.</p>
      </div>
    </td>
  </tr>
</table>
`;

console.log('Testing multiple callouts...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Multiple Callouts Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    
    if (block.type === 'callout') {
      const content = block.callout.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Content: "${content}"`);
      console.log(`  Color: ${block.callout.color}`);
      console.log(`  Icon: ${block.callout.icon.emoji}`);
    } else if (block.type === 'heading_2') {
      const content = block.heading_2.rich_text.map(rt => rt.text.content).join('');
      console.log(`  Text: "${content}"`);
    } else if (block.type === 'table') {
      console.log(`  Table: ${block.table.table_width} cols x ${block.table.children?.length || 0} rows`);
      if (block.table.children && block.table.children.length > 0) {
        const cell = block.table.children[0].table_row.cells[0];
        const cellText = cell.map(rt => rt.text.content).join('');
        console.log(`  First cell: "${cellText}"`);
      }
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
