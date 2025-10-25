// Test with actual HTML from the logs
const { convertRichTextBlock } = require('./converters/rich-text.cjs');

console.log('Test: Actual HTML from server logs');
const actualHtml = `
               <p class="p nowrap"><span class="ph uicontrol">Explore</span></p>
               <ul>
                 <li><span class="ph">Item One</span></li>
                 <li>Contact <span class="ph">Customer Service and Support</span></li>
               </ul>`;

console.log('Input HTML:');
console.log(actualHtml);
console.log('\nProcessing...\n');

const result = convertRichTextBlock(actualHtml, { skipSoftBreaks: true });

console.log('Result:');
result.forEach((block, i) => {
  console.log(`[${i}]`, JSON.stringify(block.text.content), block.annotations);
});

console.log('\nFull text concatenated:');
console.log(result.map(r => r.text.content).join(''));

// Check for any remaining HTML tags
const fullText = result.map(r => r.text.content).join('');
if (fullText.includes('<') || fullText.includes('>')) {
  console.log('\n❌ WARNING: HTML tags still present!');
  console.log('Tags found:', fullText.match(/<[^>]*>/g));
} else {
  console.log('\n✅ No HTML tags found - all cleaned!');
}
