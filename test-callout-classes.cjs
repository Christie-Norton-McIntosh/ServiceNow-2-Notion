const axios = require('axios');

// Test with exact ServiceNow class pattern
const tests = [
  {
    name: 'Single note class',
    html: `<div class="note"><span class="note__title">Note:</span><p>Content inside note</p></div>`
  },
  {
    name: 'Multiple note classes (note note note_note)',
    html: `<div class="note note note_note"><span class="note__title">Note:</span><p>Content inside note note note_note</p></div>`
  },
  {
    name: 'Multiple note classes without title span',
    html: `<div class="note note note_note"><p>Direct content without title span</p></div>`
  },
  {
    name: 'Multiple note classes with mixed content',
    html: `<div class="note note note_note">
      <span class="note__title">Note:</span>
      <p>First paragraph with <strong>bold</strong> text.</p>
      <p>Second paragraph with <code>code</code>.</p>
    </div>`
  }
];

async function runTests() {
  for (const test of tests) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TEST: ${test.name}`);
    console.log(`HTML: ${test.html.substring(0, 150).replace(/\n/g, ' ')}...`);
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
        if (block.type === 'callout') {
          const content = block.callout.rich_text.map(rt => rt.text.content).join('');
          console.log(`   📦 Callout:`);
          console.log(`      Color: ${block.callout.color}`);
          console.log(`      Icon: ${block.callout.icon.emoji}`);
          console.log(`      Content: "${content}"`);
          console.log(`      Rich text elements: ${block.callout.rich_text.length}`);
        } else {
          console.log(`   Block ${i + 1}: ${block.type}`);
        }
      });
    } catch (error) {
      console.error(`❌ Error: ${error.response?.data?.error || error.message}`);
    }
  }
}

runTests();
