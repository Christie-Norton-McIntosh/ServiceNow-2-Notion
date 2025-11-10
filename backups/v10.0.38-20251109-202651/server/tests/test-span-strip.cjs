const { convertRichTextBlock } = require('../converters/rich-text.cjs');

console.log('Test 1: span with only ph class');
const html1 = 'Contact <span class="ph">Customer Service and Support</span>';
console.log('Input:', html1);
const result1 = convertRichTextBlock(html1);
console.log('Output:', result1.map(r => r.text.content).join(''));
console.log('Full result:', JSON.stringify(result1, null, 2));

console.log('\nTest 2: span with ph and uicontrol classes');
const html2 = '<span class="ph uicontrol">Explore</span>';
console.log('Input:', html2);
const result2 = convertRichTextBlock(html2);
console.log('Output:', result2.map(r => r.text.content).join(''));
console.log('Full result:', JSON.stringify(result2, null, 2));

console.log('\nTest 3: Mixed content with list');
const html3 = '• <span class="ph">Item One</span>\n• <span class="ph">Item Two</span>';
console.log('Input:', html3);
const result3 = convertRichTextBlock(html3);
console.log('Output:', result3.map(r => r.text.content).join('|'));
console.log('Full result:', JSON.stringify(result3, null, 2));
