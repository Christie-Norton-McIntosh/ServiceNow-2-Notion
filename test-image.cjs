const axios = require('axios');

// Test with a figure containing an image
const html = `
<p>Here is an image:</p>
<figure>
  <img src="https://example.com/test.png" alt="Test image">
  <figcaption>This is a test image caption</figcaption>
</figure>
<p>Text after image.</p>
`;

console.log('Testing image processing...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Image Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    if (block.image) {
      console.log(`  Image type: ${block.image.type}`);
      console.log(`  Caption: ${block.image.caption?.map(c => c.text.content).join('')}`);
    }
    console.log();
  });
})
.catch(error => {
  console.error('Error:', error.response?.data || error.message);
});
