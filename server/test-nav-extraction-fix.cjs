const fs = require('fs');
const path = require('path');

// Import the extraction function
const { extractContentFromHtml } = require('./services/servicenow.cjs');

const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-procurement-failure-2025-12-10T08-55-13.html', 'utf8');

console.log('\n=== TEST: Nav Extraction After Fix ===\n');

// Test the extraction
extractContentFromHtml(html).then(result => {
  console.log('\n=== EXTRACTION COMPLETE ===');
  console.log('Result:', JSON.stringify(result, null, 2).substring(0, 500));
  
  if (!result || !result.children) {
    console.error('ERROR: No children array in result');
    console.error('Result keys:', Object.keys(result || {}));
    process.exit(1);
  }
  
  console.log(`Total blocks: ${result.blocks.length}`);
  
  // Look for nav-related content
  const textBlocks = result.blocks.filter(b => 
    (b.type === 'paragraph' && b.paragraph?.rich_text?.some(rt => 
      rt.text?.content?.toLowerCase().includes('components installed') ||
      rt.text?.content?.toLowerCase().includes('related content')
    ))
  );
  
  console.log(`\nBlocks mentioning "components installed" or "related content": ${textBlocks.length}`);
  textBlocks.forEach((block, i) => {
    const text = block.paragraph.rich_text.map(rt => rt.text.content).join('');
    console.log(`  [${i}] ${text.substring(0, 100)}...`);
  });
  
  // Check for shortdesc paragraphs
  const shortdescBlocks = result.blocks.filter(b =>
    b.type === 'paragraph' && b.paragraph?.rich_text?.some(rt =>
      rt.text?.content?.toLowerCase().includes('several types of components')
    )
  );
  
  console.log(`\nBlocks with "several types of components": ${shortdescBlocks.length}`);
  shortdescBlocks.forEach((block, i) => {
    const text = block.paragraph.rich_text.map(rt => rt.text.content).join('');
    console.log(`  [${i}] ${text}`);
  });
  
  process.exit(0);
}).catch(err => {
  console.error('ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
