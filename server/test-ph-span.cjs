const { convertRichTextBlock } = require('./converters/rich-text.cjs');

const testCases = [
  'Use your instance records to build specific solutions for <span class="ph">Incident Management</span>.',
  'These solution definitions are available as templates on instances where both <span class="ph">Predictive Intelligence</span> and <span class="ph">Incident Management</span> are active.',
  'For more information on classification and similarity solution, refer to <a href="https://example.com">Create solution definition</a>.'
];

async function test() {
  for (let i = 0; i < testCases.length; i++) {
    const html = testCases[i];
    console.log(`\n📋 Test ${i + 1}:`);
    console.log(`   Input: ${html}`);
    
    const result = await convertRichTextBlock(html);
    const text = result.rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('');
    
    console.log(`   Output: ${text}`);
    console.log(`   Expected includes: ${i === 0 ? '"Incident Management"' : i === 1 ? '"Predictive Intelligence" and "Incident Management"' : '"Create solution definition"'}`);
    console.log(`   Match: ${text.includes('Incident Management') || text.includes('Predictive Intelligence') || text.includes('Create solution definition') ? '✅' : '❌'}`);
  }
}

test().catch(console.error);
