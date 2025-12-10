#!/usr/bin/env node

const fs = require('fs');
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
  const html = fs.readFileSync('/tmp/full-failing.html', 'utf8');
  console.log('HTML length:', html.length);
  
  const result = await extractContentFromHtml(html);
  
  console.log('\n✅ Extraction complete:');
  console.log('- Total blocks:', result.blocks.length);
  
  // Count content
  let totalChars = 0;
  let blockSummary = {};
  
  result.blocks.forEach((block, idx) => {
    let charCount = 0;
    
    if (block.type === 'table') {
      // For tables, count content from all cells
      const rows = block.table?.children || [];
      rows.forEach(row => {
        const cells = row.table_row?.cells || [];
        cells.forEach(cellArray => {
          const cellContent = (Array.isArray(cellArray) ? cellArray : [cellArray])
            .map(rt => rt?.text?.content || '')
            .join('');
          charCount += cellContent.length;
        });
      });
    } else {
      // For other blocks, count rich_text
      const rt = block[block.type]?.rich_text || [];
      charCount = rt.map(r => r.text?.content || '').join('').length;
    }
    
    totalChars += charCount;
    blockSummary[block.type] = (blockSummary[block.type] || 0) + charCount;
  });
  
  console.log('\n📊 Block type summary (characters):');
  Object.entries(blockSummary).forEach(([type, chars]) => {
    console.log(`  ${type.padEnd(25)} ${chars} chars`);
  });
  
  console.log('\n📊 Total characters in blocks:', totalChars);
  console.log('📊 Source HTML length:', html.length);
  console.log('📊 Coverage:', Math.round(100 * totalChars / html.length) + '%');
})();
