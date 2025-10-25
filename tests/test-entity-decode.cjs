const axios = require('axios');

// Test HTML entity decoding
const html = `<table>
  <tr>
    <td><div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div></td>
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
  const cellText = cell.map(rt => rt.text.content).join('');
  
  console.log('Cell text:', cellText);
  console.log('Contains &amp;?', cellText.includes('&amp;'));
  console.log('Contains &?', cellText.includes('&'));
  console.log('\nExpected: "...GitHub & GitHub Enterprise..."');
  console.log('Got:     ', cellText.substring(60, 90));
})
.catch(error => {
  console.error('Error:', error.message);
});
