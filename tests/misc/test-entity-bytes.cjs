const axios = require('axios');

const html = `<table>
  <tr>
    <td><div class="note note note_note"><span class="note__title">Note:</span> GitHub &amp; Enterprise</div></td>
  </tr>
</table>`;

axios.post('http://localhost:3004/api/W2N', {
  title: 'Entity Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  const cell = blocks[0].table.children[0].table_row.cells[0];
  
  console.log('Rich text elements:', cell.length);
  cell.forEach((rt, i) => {
    console.log(`[${i}] "${rt.text.content}" (length: ${rt.text.content.length})`);
    console.log(`    Bytes: ${Buffer.from(rt.text.content).toString('hex')}`);
  });
})
.catch(error => {
  console.error('Error:', error.message);
});
