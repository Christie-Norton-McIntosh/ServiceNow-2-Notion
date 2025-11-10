/**
 * Test case: "Admin account in" text disappearing from list item
 * Only "GitHub" appears, missing "Admin account in"
 * 
 * Original HTML:
 * <li class="li">Admin account in <span class="ph">GitHub</span>.<div class="note note note_note"><span class="note__title">Note:</span> The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.</div></li>
 */

const { extractContentFromHtml } = require('../../server/services/servicenow.cjs');

async function testAdminAccountMissing() {
  console.log('\n🧪 TEST: Admin account in GitHub - text extraction\n');

  const html = `
    <ul class="ul">
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
            .map(rt => rt.text?.content || rt.plain_text || '')
            .join('');
          console.log(`     Text: "${text}"`);
          console.log(`     Rich_text elements: ${block.bulleted_list_item.rich_text.length}`);
          block.bulleted_list_item.rich_text.forEach((rt, i) => {
            console.log(`       [${i}] "${rt.text?.content || ''}"`);
          });
          if (block.bulleted_list_item.children?.length > 0) {
            console.log(`     Nested children: ${block.bulleted_list_item.children.length}`);
          }
        }
        console.log('');
      });
    }

    // Check if "Admin account in" appears
    const hasAdminAccount = result.blocks?.some(block => {
      if (block.type === 'bulleted_list_item') {
        const text = block.bulleted_list_item.rich_text
          .map(rt => rt.text?.content || '')
          .join('');
        return text.includes('Admin account in');
      }
      return false;
    });

    if (hasAdminAccount) {
      console.log('✅ SUCCESS: "Admin account in" text is preserved');
    } else {
      console.log('❌ FAILURE: "Admin account in" text is MISSING');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
  
  process.exit(0);
}

testAdminAccountMissing();
