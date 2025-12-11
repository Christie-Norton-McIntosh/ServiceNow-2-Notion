#!/usr/bin/env node

/**
 * Diagnostic: Check text extraction and comparison for Activate Procurement
 * Verify why "Components installed with Procurement" is not being detected
 */

const fs = require('fs');
const servicenow = require('./server/services/servicenow.cjs');

async function diagnose() {
  // Read the HTML file
  const htmlPath = './patch/pages/pages-to-update/activate-procurement-failure-2025-12-10T08-55-13.html';
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Remove the HTML comment header (auto-saved metadata)
  const htmlWithoutComment = htmlContent.replace(/<!--[\s\S]*?-->\s*/, '');

  console.log('📋 Extracting from Activate Procurement HTML...\n');

  // Call the servicenow extraction
  const result = await servicenow.extractContentFromHtml(htmlWithoutComment);

  console.log(`Extracted ${result.blocks.length} blocks\n`);

  // Flatten blocks to text (same way the comparator would)
  const blockTexts = [];
  function extractBlockText(block) {
    if (block.type === 'paragraph' && block.paragraph?.rich_text) {
      const text = block.paragraph.rich_text
        .map(rt => rt.text?.content || '')
        .join('');
      if (text.trim().length > 0) blockTexts.push(text.trim());
    } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
      const text = block.heading_1.rich_text
        .map(rt => rt.text?.content || '')
        .join('');
      if (text.trim().length > 0) blockTexts.push(text.trim());
    } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
      const text = block.bulleted_list_item.rich_text
        .map(rt => rt.text?.content || '')
        .join('');
      if (text.trim().length > 0) blockTexts.push(text.trim());
    }

    if (block.children && Array.isArray(block.children)) {
      for (const child of block.children) {
        extractBlockText(child);
      }
    }
  }

  for (const block of result.blocks) {
    extractBlockText(block);
  }

  const notionText = blockTexts.join('\n');

  console.log('🔍 Notion-extracted text:');
  console.log('─'.repeat(80));
  console.log(notionText);
  console.log('─'.repeat(80));
  console.log(`\nTotal chars: ${notionText.length}\n`);

  // Check for specific phrases that user reported missing
  const phrases = [
    'Components installed with Procurement',
    'Several types of components',
    'Related Content',
    'Procurement roles',
    'Procurement workflows',
    'Domain separation',
  ];

  console.log('🔍 Searching for reported missing phrases:');
  for (const phrase of phrases) {
    const found = notionText.includes(phrase);
    const icon = found ? '✅' : '❌';
    console.log(`  ${icon} "${phrase}"`);
  }

  // Now test the comparison
  console.log('\n\n📊 Comparison Analysis:');
  const comparison = servicenow.getDetailedTextComparison(
    htmlWithoutComment.replace(/<!--[\s\S]*?-->/g, ''),
    notionText
  );

  console.log(`Coverage: ${(comparison.coverage * 100).toFixed(2)}%`);
  console.log(`HTML tokens: ${comparison.htmlSegmentCount}`);
  console.log(`Notion tokens: ${comparison.notionSegmentCount}`);
  console.log(`Missing segments: ${comparison.missingSegments.length}`);
  console.log(`Method: ${comparison.method}`);

  if (comparison.missingSegments.length > 0) {
    console.log('\nMissing segments:');
    for (let i = 0; i < Math.min(5, comparison.missingSegments.length); i++) {
      const seg = comparison.missingSegments[i];
      console.log(`  ${i+1}. "${seg.text.substring(0, 80)}${seg.text.length > 80 ? '...' : ''}"`);
    }
  }
}

diagnose().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
