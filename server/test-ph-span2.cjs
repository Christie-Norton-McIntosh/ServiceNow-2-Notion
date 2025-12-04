const { convertRichTextBlock } = require('./converters/rich-text.cjs');

const testCases = [
  'Use your instance records to build specific solutions for <span class="ph">Incident Management</span>.',
];

async function test() {
  for (let i = 0; i < testCases.length; i++) {
    const html = testCases[i];
    console.log(`\n📋 Test ${i + 1}:`);
    console.log(`   Input: ${html}\n`);
    
    const result = await convertRichTextBlock(html);
    console.log('   Result type:', typeof result);
    console.log('   Result keys:', Object.keys(result));
    console.log('   Result:', JSON.stringify(result, null, 2).substring(0, 500));
  }
}

test().catch(console.error);
