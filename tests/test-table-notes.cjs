const axios = require('axios');

// Test note callouts in table cells
const tests = [
  {
    name: 'Note in table cell',
    html: `<table>
      <tr>
        <td>Regular cell content</td>
        <td><div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div></td>
      </tr>
    </table>`
  },
  {
    name: 'Note with text before it in cell',
    html: `<table>
      <tr>
        <td>Some text before the note.
        <div class="note note note_note"><span class="note__title">Note:</span> Important information here.</div></td>
      </tr>
    </table>`
  },
  {
    name: 'Multiple notes in cell',
    html: `<table>
      <tr>
        <td>
          <div class="note note note_note"><span class="note__title">Note:</span> First note.</div>
          <div class="note note note_note"><span class="note__title">Warning:</span> Second note.</div>
        </td>
      </tr>
    </table>`
  },
  {
    name: 'Note with formatted content',
    html: `<table>
      <tr>
        <td><div class="note note note_note"><span class="note__title">Note:</span> Use <span class="uicontrol">Settings</span> to configure <code>api_key</code>.</div></td>
      </tr>
    </table>`
  }
];

async function runTests() {
  for (const test of tests) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST: ${test.name}`);
    console.log('='.repeat(70));
    
    try {
      const response = await axios.post('http://localhost:3004/api/W2N', {
        title: test.name,
        contentHtml: test.html,
        dryRun: true
      });
      
      const blocks = response.data.data.children;
      console.log(`✅ Got ${blocks.length} block(s)`);
      
      blocks.forEach((block, i) => {
        console.log(`\nBlock ${i + 1}: ${block.type}`);
        
        if (block.type === 'table') {
          console.log(`  Table rows: ${block.table.table_width}x${block.table.children?.length || 0}`);
          block.table.children?.forEach((row, r) => {
            console.log(`  Row ${r + 1}:`);
            row.table_row.cells.forEach((cell, c) => {
              const cellText = cell.map(rt => rt.text.content).join('');
              console.log(`    Cell ${c + 1}: "${cellText}"`);
            });
          });
        } else if (block.type === 'callout') {
          const content = block.callout.rich_text.map(rt => rt.text.content).join('');
          console.log(`  ❌ UNEXPECTED CALLOUT: "${content}"`);
        }
      });
    } catch (error) {
      console.error(`❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

runTests();
