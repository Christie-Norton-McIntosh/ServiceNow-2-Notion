const axios = require('axios');

// Test cmd span in table cell
const html = `
<table>
  <tbody>
    <tr>
      <td><span class="ph cmd">Leave the remaining fields empty (default).</span></td>
      <td>Another cell</td>
    </tr>
  </tbody>
</table>
`;

console.log('Testing <span class="ph cmd"> in table cell...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'CMD in Table Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    if (block.type === 'table') {
      console.log(`Block ${i + 1}: TABLE`);
      block.table.children.forEach((row, rowIdx) => {
        console.log(`  Row ${rowIdx + 1}:`);
        row.table_row.cells.forEach((cell, cellIdx) => {
          console.log(`    Cell ${cellIdx + 1}:`);
          const fullText = cell.map(rt => rt.text.content).join('');
          console.log(`      Text: "${fullText}"`);
          
          cell.forEach((rt, rtIdx) => {
            const annotations = rt.annotations || {};
            const typeStr = annotations.code ? '[CODE]' : annotations.bold ? '[BOLD]' : '[TEXT]';
            
            if (rt.text.content.includes('__BOLD_START__') || rt.text.content.includes('__')) {
              console.log(`      ❌ [${rtIdx}] ${typeStr} "${rt.text.content}" <-- CONTAINS MARKERS!`);
            } else {
              console.log(`      ✅ [${rtIdx}] ${typeStr} "${rt.text.content}"`);
            }
          });
        });
      });
    }
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
