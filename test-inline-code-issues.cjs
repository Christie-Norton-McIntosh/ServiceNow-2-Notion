#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { extractContentFromHtml } = require('./server/services/servicenow.cjs');

const fixturePath = path.join(__dirname, 'tests', 'fixtures', 'inline-code-issues.html');
const htmlContent = fs.readFileSync(fixturePath, 'utf8');

console.log('Testing inline code formatting issues...');
console.log('HTML fixture:', fixturePath);
console.log('HTML length:', htmlContent.length, 'characters');

async function runTest() {
  try {
    const result = await extractContentFromHtml(htmlContent);
    const children = result.blocks;

    console.log('\n=== RESULTS ===');
    console.log('Number of blocks:', children.length);

    // Analyze blocks for code formatting
    children.forEach((block, index) => {
      console.log(`\nBlock ${index + 1}: ${block.type}`);

      if (block.type === 'paragraph') {
        const richText = block.paragraph?.rich_text || [];
        console.log(`  Rich text elements: ${richText.length}`);
        richText.forEach((rt, i) => {
          const hasCode = rt.annotations?.code === true;
          const content = rt.text?.content || '';
          if (hasCode) {
            console.log(`    [CODE] "${content}"`);
          } else {
            console.log(`    [TEXT] "${content}"`);
          }
        });
      } else if (block.type === 'table') {
        console.log('  Table detected - analyzing cells...');
        block.table.children.forEach((row, rowIndex) => {
          row.table_row.cells.forEach((cell, cellIndex) => {
            console.log(`    Row ${rowIndex + 1}, Cell ${cellIndex + 1}:`);
            cell.forEach((rt, rtIndex) => {
              const hasCode = rt.annotations?.code === true;
              const content = rt.text?.content || '';
              if (hasCode) {
                console.log(`      [CODE] "${content}"`);
              } else {
                console.log(`      [TEXT] "${content}"`);
              }
            });
          });
        });
      }
    });

    // Count total code-formatted elements
    let totalCodeElements = 0;
    function countCodeInBlocks(blocks) {
      for (const block of blocks) {
        if (block.type === 'paragraph' && block.paragraph?.rich_text) {
          block.paragraph.rich_text.forEach(rt => {
            if (rt.annotations?.code === true) totalCodeElements++;
          });
        } else if (block.type === 'table') {
          block.table.children.forEach(row => {
            row.table_row.cells.forEach(cell => {
              cell.forEach(rt => {
                if (rt.annotations?.code === true) totalCodeElements++;
              });
            });
          });
        }
      }
    }
    countCodeInBlocks(children);

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total code-formatted elements: ${totalCodeElements}`);

    // Check for problematic patterns
    const problematicWords = ['test_document', 'random_word', 'file_name', 'user_input_field'];
    console.log('\n=== PROBLEMATIC WORDS CHECK ===');
    problematicWords.forEach(word => {
      const found = JSON.stringify(children).includes(`"${word}"`);
      console.log(`${found ? '❌ FOUND' : '✅ OK'} "${word}"`);
    });

  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

runTest();