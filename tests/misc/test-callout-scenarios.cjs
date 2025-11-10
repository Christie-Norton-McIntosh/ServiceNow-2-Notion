const axios = require('axios');

// Test various callout HTML patterns
const tests = [
  {
    name: 'Standard note with paragraph',
    html: `<div class="note"><span class="note__title">Note:</span><p>Content here</p></div>`
  },
  {
    name: 'Note with nested spans',
    html: `<div class="note"><span class="note__title">Note:</span><p>Content with <span class="uicontrol">UI element</span> inside</p></div>`
  },
  {
    name: 'Note without paragraph tag',
    html: `<div class="note"><span class="note__title">Note:</span>Direct content without paragraph</div>`
  },
  {
    name: 'Note with list inside',
    html: `<div class="note"><span class="note__title">Note:</span><ul><li>Item 1</li><li>Item 2</li></ul></div>`
  },
  {
    name: 'Note with multiple paragraphs',
    html: `<div class="note"><span class="note__title">Note:</span><p>First paragraph</p><p>Second paragraph</p></div>`
  },
  {
    name: 'Note title without colon',
    html: `<div class="note"><span class="note__title">Note</span><p>Content here</p></div>`
  }
];

async function runTests() {
  for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST: ${test.name}`);
    console.log(`HTML: ${test.html.substring(0, 100)}...`);
    console.log('='.repeat(60));
    
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
          console.log(`   Callout content: "${content}"`);
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
