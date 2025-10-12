const fs = require('fs');
const path = require('path');
const { htmlToNotionBlocks } = require('./sn2n-proxy.cjs');

async function testCombinedIssues() {
  const html = fs.readFileSync(
    path.join(__dirname, 'test-combined-issues.html'),
    'utf8'
  );

  console.log('Testing combined issues: uicontrol blue text + empty list lines...');

  try {
    const result = await htmlToNotionBlocks(html);
    const blocks = result.blocks;

    console.log(`Generated ${blocks.length} blocks`);

    // Check for list items with non-breaking space
    const listItems = blocks.filter(b => b.type === 'numbered_list_item' || b.type === 'bulleted_list_item');
    console.log(`Found ${listItems.length} list items`);

    listItems.forEach((item, idx) => {
      const richText = item[item.type].rich_text;
      if (richText && richText.length > 0) {
        const content = richText[0].text?.content || '';
        console.log(`List item ${idx}: "${content}" (length: ${content.length})`);
        if (content === '\u00A0') {
          console.log(`  ✓ Uses non-breaking space (good)`);
        } else if (content.trim() === '') {
          console.log(`  ✗ Empty content (bad)`);
        } else {
          console.log(`  ✓ Has text content`);
        }
      }

      // Check for blue bold text in rich text
      if (richText && richText.length > 0) {
        richText.forEach((rt, rtIdx) => {
          if (rt.annotations?.bold && rt.annotations?.color === 'blue') {
            console.log(`  ✓ Rich text ${rtIdx}: "${rt.text?.content}" is blue and bold`);
          }
        });
      }
    });

    // Write to file for inspection
    const output = {
      ts: new Date().toISOString(),
      blocks: blocks,
      summary: {
        totalBlocks: blocks.length,
        listItems: listItems.length,
        hasBlueBoldText: blocks.some(b =>
          b[b.type]?.rich_text?.some(rt =>
            rt.annotations?.bold && rt.annotations?.color === 'blue'
          )
        ),
        hasNonBreakingSpace: blocks.some(b =>
          (b.type === 'numbered_list_item' || b.type === 'bulleted_list_item') &&
          b[b.type]?.rich_text?.[0]?.text?.content === '\u00A0'
        )
      }
    };

    const outputPath = path.join(__dirname, 'logs', 'combined-test.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\nWrote results to ${outputPath}`);

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Blue bold text (uicontrol): ${output.summary.hasBlueBoldText ? '✓ WORKING' : '✗ BROKEN'}`);
    console.log(`Non-breaking space in lists: ${output.summary.hasNonBreakingSpace ? '✓ WORKING' : '✗ BROKEN'}`);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testCombinedIssues();