#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { extractContentFromHtml } = require('./server/services/servicenow.cjs');

const fixturePath = path.join(__dirname, 'tests', 'fixtures', 'div-p-with-spans-and-ul.html');
const htmlContent = fs.readFileSync(fixturePath, 'utf8');

console.log('Testing div.p with spans and ul extraction...');
console.log('HTML fixture:', fixturePath);
console.log('HTML length:', htmlContent.length, 'characters');

async function runTest() {
  try {
    const result = await extractContentFromHtml(htmlContent);
    const children = result.blocks;
    console.log('Number of blocks:', children.length);

    // Analyze the blocks for text content
    let textBlocks = 0;
    let paragraphBlocks = 0;
    let listBlocks = 0;

    children.forEach((block, index) => {
      console.log(`\nBlock ${index + 1}: ${block.type}`);

      if (block.type === 'paragraph') {
        paragraphBlocks++;
        if (block.paragraph?.rich_text) {
          const text = block.paragraph.rich_text.map(rt => rt.text?.content || rt.plain_text || '').join('');
          console.log(`  Text: "${text}"`);
          textBlocks++;
        }
      } else if (block.type === 'bulleted_list_item') {
        listBlocks++;
        if (block.bulleted_list_item?.rich_text) {
          const text = block.bulleted_list_item.rich_text.map(rt => rt.text?.content || rt.plain_text || '').join('');
          console.log(`  List item: "${text}"`);
          textBlocks++;
        }
      }
    });

    console.log('\n=== SUMMARY ===');
    console.log(`Paragraph blocks: ${paragraphBlocks}`);
    console.log(`List blocks: ${listBlocks}`);
    console.log(`Total text blocks: ${textBlocks}`);

    // Check for the expected content
    const allText = children
      .filter(block => block.type === 'paragraph' || block.type === 'bulleted_list_item')
      .map(block => {
        const richText = block.paragraph?.rich_text || block.bulleted_list_item?.rich_text || [];
        return richText.map(rt => rt.text?.content || rt.plain_text || '').join('');
      })
      .join(' ');

    console.log('\n=== EXTRACTED TEXT ANALYSIS ===');
    console.log('Full extracted text:', allText);

    // Check for expected phrases
    const expectedPhrases = [
      'If your instance is running on the Kingston release',
      'and you are upgrading to the Yokohama release:',
      'In a global domain environment',
      'In a domain-separated environment',
      'The business rule template now calls'
    ];

    console.log('\n=== EXPECTED PHRASES CHECK ===');
    expectedPhrases.forEach(phrase => {
      const found = allText.includes(phrase);
      console.log(`${found ? '✅' : '❌'} "${phrase}"`);
    });

    // Check for word dropping issues
    console.log('\n=== WORD DROPPING ANALYSIS ===');
    const words = allText.split(/\s+/);
    console.log(`Total words extracted: ${words.length}`);

    // Look for multi-line issues (words that should be on same line)
    const lines = allText.split('\n');
    console.log(`Number of lines: ${lines.length}`);
    if (lines.length > 1) {
      console.log('Lines:');
      lines.forEach((line, i) => {
        console.log(`  Line ${i + 1}: "${line.trim()}"`);
      });
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

runTest();