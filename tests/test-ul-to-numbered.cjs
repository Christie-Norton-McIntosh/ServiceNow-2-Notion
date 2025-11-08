/**
 * Test case: <ul> incorrectly converted to numbered list instead of bullet points
 * 
 * Expected: bulleted_list_item blocks
 * Actual: numbered_list_item blocks
 */

const { extractContentFromHtml } = require('../server/services/servicenow.cjs');

async function testUlToBulletPoints() {
  console.log('\n🧪 TEST: <ul> should create bullet points, not numbered list\n');

  const html = `
    <ul class="ul" id="dev-ops-github-apps-oath-jwt__ul_rxd_mpy_jsb">
      <li class="li">oauth_admin in <span class="ph">DevOps Change Velocity</span>.</li>
      <li class="li">Admin account in <span class="ph">GitHub</span>.<div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div></li>
    </ul>
  `;

  console.log('📋 Input HTML:');
  console.log(html);
  console.log('\n' + '='.repeat(80) + '\n');

  try {
    const result = await extractContentFromHtml(html);
    
    console.log('✅ Extraction complete');
    console.log(`📊 Total blocks: ${result.blocks?.length || 0}`);
    console.log('\n📦 Blocks:\n');
    
    if (result.blocks) {
      result.blocks.forEach((block, idx) => {
        console.log(`[${idx}] ${block.type}:`);
        if (block.type === 'bulleted_list_item') {
          const text = block.bulleted_list_item.rich_text
            .map(rt => rt.text?.content || '')
            .join('');
          console.log(`     ✅ CORRECT: Bulleted list item`);
          console.log(`     Text: "${text}"`);
        } else if (block.type === 'numbered_list_item') {
          const text = block.numbered_list_item.rich_text
            .map(rt => rt.text?.content || '')
            .join('');
          console.log(`     ❌ WRONG: Numbered list item (should be bulleted)`);
          console.log(`     Text: "${text}"`);
        }
        console.log('');
      });
    }

    // Check if all items are bulleted
    const listBlocks = result.blocks?.filter(b => 
      b.type === 'bulleted_list_item' || b.type === 'numbered_list_item'
    );
    const allBulleted = listBlocks?.every(block => block.type === 'bulleted_list_item');
    const anyNumbered = listBlocks?.some(block => block.type === 'numbered_list_item');

    if (listBlocks && listBlocks.length > 0) {
      if (allBulleted) {
        console.log(`✅ SUCCESS: All ${listBlocks.length} list items are bulleted_list_item (correct)`);
        process.exit(0);
      } else if (anyNumbered) {
        console.log('❌ FAILURE: Found numbered_list_item blocks (should be bulleted)');
        process.exit(1);
      }
    } else {
      console.log('⚠️ WARNING: No list items found');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testUlToBulletPoints();
