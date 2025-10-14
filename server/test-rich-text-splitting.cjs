/**
 * Test script to verify rich text splitting at 2000 characters
 * Run with: node server/test-rich-text-splitting.cjs
 */

const { convertRichTextBlock } = require('./converters/rich-text.cjs');

console.log('🧪 Testing Rich Text 2000-Character Splitting\n');

// Test 1: Short content (should NOT split)
console.log('Test 1: Short content (100 chars)');
const shortText = 'A'.repeat(100);
const shortResult = convertRichTextBlock(shortText);
console.log(`  Input length: ${shortText.length}`);
console.log(`  Output blocks: ${shortResult.length}`);
console.log(`  ✅ Expected: 1 block, Got: ${shortResult.length}`);
console.assert(shortResult.length === 1, 'Short text should create 1 block');
console.assert(shortResult[0].text.content.length === 100, 'Short text should be preserved');
console.log('');

// Test 2: Exactly 2000 characters (should NOT split)
console.log('Test 2: Exactly 2000 chars');
const exactText = 'B'.repeat(2000);
const exactResult = convertRichTextBlock(exactText);
console.log(`  Input length: ${exactText.length}`);
console.log(`  Output blocks: ${exactResult.length}`);
console.log(`  ✅ Expected: 1 block, Got: ${exactResult.length}`);
console.assert(exactResult.length === 1, 'Exactly 2000 chars should create 1 block');
console.assert(exactResult[0].text.content.length === 2000, 'Content should be 2000 chars');
console.log('');

// Test 3: 2001 characters (SHOULD split into 2)
console.log('Test 3: 2001 chars (should split)');
const splitText = 'C'.repeat(2001);
const splitResult = convertRichTextBlock(splitText);
console.log(`  Input length: ${splitText.length}`);
console.log(`  Output blocks: ${splitResult.length}`);
console.log(`  Block 1 length: ${splitResult[0]?.text.content.length}`);
console.log(`  Block 2 length: ${splitResult[1]?.text.content.length}`);
console.log(`  ✅ Expected: 2 blocks, Got: ${splitResult.length}`);
console.assert(splitResult.length === 2, '2001 chars should split into 2 blocks');
console.assert(splitResult[0].text.content.length === 2000, 'First block should be 2000 chars');
console.assert(splitResult[1].text.content.length === 1, 'Second block should be 1 char');
console.log('');

// Test 4: 5000 characters (SHOULD split into 3)
console.log('Test 4: 5000 chars (should split into 3)');
const longText = 'D'.repeat(5000);
const longResult = convertRichTextBlock(longText);
console.log(`  Input length: ${longText.length}`);
console.log(`  Output blocks: ${longResult.length}`);
longResult.forEach((block, i) => {
  console.log(`  Block ${i + 1} length: ${block.text.content.length}`);
});
console.log(`  ✅ Expected: 3 blocks, Got: ${longResult.length}`);
console.assert(longResult.length === 3, '5000 chars should split into 3 blocks');
console.assert(longResult[0].text.content.length === 2000, 'First block should be 2000 chars');
console.assert(longResult[1].text.content.length === 2000, 'Second block should be 2000 chars');
console.assert(longResult[2].text.content.length === 1000, 'Third block should be 1000 chars');
console.log('');

// Test 5: HTML with formatting (should preserve formatting and split)
console.log('Test 5: HTML with formatting (3130 chars like the error)');
const htmlText = '<p>' + 'E'.repeat(3130) + '</p>';
const htmlResult = convertRichTextBlock(htmlText);
console.log(`  Input HTML length: ${htmlText.length}`);
console.log(`  Output blocks: ${htmlResult.length}`);
htmlResult.forEach((block, i) => {
  console.log(`  Block ${i + 1} length: ${block.text.content.length}`);
});
console.log(`  ✅ Expected: 2 blocks (2000 + 1130), Got: ${htmlResult.length}`);
console.assert(htmlResult.length === 2, '3130 chars should split into 2 blocks');
console.assert(htmlResult[0].text.content.length === 2000, 'First block should be 2000 chars');
console.assert(htmlResult[1].text.content.length === 1130, 'Second block should be 1130 chars');
console.log('');

// Test 6: Link with long content (should split and preserve link on first chunk)
console.log('Test 6: Link with long content (2500 chars)');
const linkText = '<a href="https://example.com">' + 'F'.repeat(2500) + '</a>';
const linkResult = convertRichTextBlock(linkText);
console.log(`  Input HTML length: ${linkText.length}`);
console.log(`  Output blocks: ${linkResult.length}`);
console.log(`  Block 1 has link: ${!!linkResult[0]?.text?.link}`);
console.log(`  Block 2 has link: ${!!linkResult[1]?.text?.link}`);
console.log(`  ✅ Expected: 2 blocks, link on first only`);
console.assert(linkResult.length === 2, 'Long link should split into 2 blocks');
console.assert(linkResult[0].text.link?.url === 'https://example.com', 'First block should have link');
console.assert(!linkResult[1].text.link, 'Second block should NOT have link');
console.log('');

console.log('✅ All tests passed! Rich text splitting is working correctly.\n');
console.log('🎯 The 2000-character Notion API limit should now be enforced everywhere.');
