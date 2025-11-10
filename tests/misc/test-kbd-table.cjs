const axios = require('axios');

// Test kbd tags inside table cells
const html = `
<table>
  <thead>
    <tr>
      <th>Field</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Navigate to <kbd class="ph userinput">My GitHub App Certificate</kbd></td>
      <td>Enter <kbd>https://<instance-name>.service-now.com</kbd> in the URL field</td>
    </tr>
    <tr>
      <td>Click <kbd>Save</kbd> button</td>
      <td>Use field <kbd>sys_id</kbd> for lookup</td>
    </tr>
  </tbody>
</table>
`;

console.log('Testing <kbd> tags in table cells...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'KBD in Table Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    if (block.type === 'table') {
      console.log(`Block ${i + 1}: TABLE`);
      console.log(`  Rows: ${block.table.children.length}`);
      console.log(`  Columns: ${block.table.table_width}`);
      console.log(`  Has header: ${block.table.has_column_header}\n`);
      
      block.table.children.forEach((row, rowIdx) => {
        console.log(`  Row ${rowIdx + 1}:`);
        row.table_row.cells.forEach((cell, cellIdx) => {
          console.log(`    Cell ${cellIdx + 1}:`);
          cell.forEach((rt, rtIdx) => {
            const text = rt.text.content;
            const hasCode = rt.annotations?.code;
            const hasBold = rt.annotations?.bold;
            let typeStr = hasCode ? '[CODE]' : hasBold ? '[BOLD]' : '[TEXT]';
            console.log(`      [${rtIdx}] ${typeStr} "${text}"`);
          });
        });
      });
      console.log();
    }
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
