/**
 * Test validation of callout with nested list
 * Verifies that content validation catches missing intro text
 * when a div.p with nested <ul> loses its text content
 */

const { extractContentFromHtml } = require('./server/services/servicenow.cjs');

async function testCalloutWithNestedList() {
  console.log('\n=== Testing Callout with Nested List Validation ===\n');
  
  // HTML that triggered the bug: div.p with text + nested <ul>
  // Wrap in article to match ServiceNow structure
  const html = `
    <article>
      <div class="note note_note">
        <div class="p">If your instance is running on the <span class="ph">Kingston</span> release and you are upgrading to
          the <span class="ph">Yokohama</span> release:<ul class="ul" id="test__ul_ynv_tcc_x2b">
            <li class="li">In a global domain environment, use the new solutionNames array variable which
              requires that you explicitly provide the solutions that are called by the business
              rule.</li>
            <li class="li">In a domain-separated environment, such as an MSP environment, refer to the commented
              code in the business rule template for easy customization.</li>
            <li class="li">The business rule template now calls the applyPredictionForSolution() method to
              predict regardless of any changes to the default value.</li>
          </ul>
        </div>
      </div>
    </article>
  `;
  
  console.log('Input HTML (div.p with text + nested <ul>):');
  console.log(html.substring(0, 300) + '...\n');
  
  const result = await extractContentFromHtml(html);
  
  console.log('\n--- Extraction Result ---');
  console.log('Result keys:', Object.keys(result));
  
  // The result structure varies - check both possible locations
  const blocks = result.children || result.blocks || result;
  if (!blocks || !Array.isArray(blocks)) {
    console.error('❌ No blocks array found in result:', result);
    return;
  }
  
  console.log(`Total blocks: ${blocks.length}`);
  
  blocks.forEach((block, idx) => {
    console.log(`\nBlock ${idx + 1}: ${block.type}`);
    
    if (block.type === 'callout') {
      const calloutText = block.callout.rich_text
        .map(rt => rt.text.content)
        .join('');
      console.log(`  Callout text (${calloutText.length} chars): "${calloutText}"`);
      console.log(`  Has children: ${block.callout.children ? block.callout.children.length : 0}`);
      
      // Check for the intro text
      const hasIntroText = calloutText.includes('If your instance is running');
      const hasKingston = calloutText.includes('Kingston');
      const hasYokohama = calloutText.includes('Yokohama');
      
      console.log(`\n  ✓ Intro text present: ${hasIntroText}`);
      console.log(`  ✓ "Kingston" present: ${hasKingston}`);
      console.log(`  ✓ "Yokohama" present: ${hasYokohama}`);
      
      if (!hasIntroText) {
        console.log(`\n  ❌ VALIDATION FAIL: Missing intro text "If your instance is running..."`);
      } else {
        console.log(`\n  ✅ VALIDATION PASS: Intro text preserved`);
      }
      
      // Check child blocks
      if (block.callout.children) {
        console.log(`\n  Child blocks (${block.callout.children.length}):`);
        block.callout.children.forEach((child, childIdx) => {
          if (child.type === 'bulleted_list_item') {
            const itemText = child.bulleted_list_item.rich_text
              .map(rt => rt.text.content)
              .join('')
              .substring(0, 80);
            console.log(`    ${childIdx + 1}. ${child.type}: "${itemText}..."`);
          } else {
            console.log(`    ${childIdx + 1}. ${child.type}`);
          }
        });
      }
    }
  });
  
  console.log('\n=== Test Complete ===\n');
}

// Run test
testCalloutWithNestedList().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
