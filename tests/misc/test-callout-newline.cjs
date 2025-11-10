const axios = require('axios');

// Test callout with newline in content
const htmlWithNewline = `<div class="note">
  <span class="note__title">Note:</span>
  <p>Text with
newline in middle</p>
</div>`;

const htmlWithoutNewline = `<div class="note"><span class="note__title">Note:</span><p>Text without newline</p></div>`;

console.log('Testing callout with newline in content...\n');

async function test() {
  try {
    const response1 = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Test With Newline',
      contentHtml: htmlWithNewline,
      dryRun: true
    });
    
    const blocks1 = response1.data.data.children;
    console.log('=== WITH NEWLINE ===');
    console.log('Content:', JSON.stringify(blocks1[0].callout.rich_text.map(rt => rt.text.content).join('')));
    console.log('Has literal \\n?', blocks1[0].callout.rich_text.map(rt => rt.text.content).join('').includes('\n'));
    
    const response2 = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Test Without Newline',
      contentHtml: htmlWithoutNewline,
      dryRun: true
    });
    
    const blocks2 = response2.data.data.children;
    console.log('\n=== WITHOUT NEWLINE ===');
    console.log('Content:', JSON.stringify(blocks2[0].callout.rich_text.map(rt => rt.text.content).join('')));
    console.log('Has literal \\n?', blocks2[0].callout.rich_text.map(rt => rt.text.content).join('').includes('\n'));
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

test();
