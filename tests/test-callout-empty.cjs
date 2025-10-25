const axios = require('axios');

// Test callout with ONLY the title
const tests = [
  {
    name: 'Only title, no content',
    html: `<div class="note"><span class="note__title">Note:</span></div>`
  },
  {
    name: 'Only title, empty paragraph',
    html: `<div class="note"><span class="note__title">Note:</span><p></p></div>`
  },
  {
    name: 'Only title, whitespace paragraph',
    html: `<div class="note"><span class="note__title">Note:</span><p>   </p></div>`
  },
  {
    name: 'Title with special chars in span',
    html: `<div class="note"><span class="note__title">Note <b>Warning</b>:</span><p>Content</p></div>`
  }
];

async function runTests() {
  for (const test of tests) {
    console.log(`\nTEST: ${test.name}`);
    
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
          console.log(`   Callout: "${content}" (${block.callout.rich_text.length} elements)`);
        } else {
          console.log(`   Block ${i + 1}: ${block.type}`);
        }
      });
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
  }
}

runTests();
