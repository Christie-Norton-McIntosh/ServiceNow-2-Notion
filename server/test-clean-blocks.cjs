// Test the cleanInvalidBlocks function in isolation
const { cleanInvalidBlocks } = require('./utils/notion-format.cjs');
const fs = require('fs');

// Create a test structure that matches the error pattern:
// children[5].numbered_list_item.children[2].numbered_list_item.children[0] has no type

const testBlocks = [
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Block 0' } }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Block 1' } }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Block 2' } }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Block 3' } }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Block 4' } }] } },
  {
    type: 'numbered_list_item',
    numbered_list_item: {
      rich_text: [{ type: 'text', text: { content: 'Block 5 - Parent list item' } }],
      children: [
        { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Child 0' } }] } },
        { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Child 1' } }] } },
        {
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ type: 'text', text: { content: 'Child 2 - Nested list item' } }],
            children: [
              {}, // ❌ INVALID: Empty object with no type property
              { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Valid child' } }] } }
            ]
          }
        }
      ]
    }
  }
];

console.log('📋 Original test blocks:');
console.log(JSON.stringify(testBlocks, null, 2));

console.log('\n🧹 Running cleanInvalidBlocks...\n');
const cleaned = cleanInvalidBlocks(testBlocks);

console.log('\n✅ Cleaned blocks:');
console.log(JSON.stringify(cleaned, null, 2));

// Write to files for inspection
fs.writeFileSync('/tmp/blocks-before.json', JSON.stringify(testBlocks, null, 2));
fs.writeFileSync('/tmp/blocks-after.json', JSON.stringify(cleaned, null, 2));

console.log('\n📁 Saved to:');
console.log('   Before: /tmp/blocks-before.json');
console.log('   After:  /tmp/blocks-after.json');

// Check if the invalid block was removed
const block5 = cleaned[5];
if (block5 && block5.numbered_list_item && block5.numbered_list_item.children) {
  const child2 = block5.numbered_list_item.children[2];
  if (child2 && child2.numbered_list_item && child2.numbered_list_item.children) {
    const hasEmptyBlock = child2.numbered_list_item.children.some(b => !b || !b.type);
    if (hasEmptyBlock) {
      console.log('\n❌ FAILED: Empty block still present at children[5].numbered_list_item.children[2].numbered_list_item.children');
    } else {
      console.log('\n✅ SUCCESS: Empty block was removed!');
    }
    console.log(`   children[2] now has ${child2.numbered_list_item.children.length} children`);
  }
}
