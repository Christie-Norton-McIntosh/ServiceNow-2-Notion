#!/usr/bin/env node

const fs = require('fs');
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
  const html = fs.readFileSync('/tmp/test-actual-failing.html', 'utf8');
  console.log('HTML length:', html.length);
  console.log('HTML first 200 chars:', html.substring(0, 200));
  
  const result = await extractContentFromHtml(html);
  
  console.log('\n✅ Extraction complete:');
  console.log('- Total blocks:', result.blocks.length);
  console.log('- Block types:', result.blocks.map(b => b.type).join(', '));
  
  // Count content
  let totalChars = 0;
  result.blocks.forEach((block, idx) => {
    let charCount = 0;
    let content = '';
    
    if (block.type === 'table') {
      // For tables, count content from all cells
      const rows = block.table?.children || [];
      const cellsText = [];
      rows.forEach(row => {
        const cells = row.table_row?.cells || [];
        cells.forEach(cellArray => {
          const cellContent = (Array.isArray(cellArray) ? cellArray : [cellArray])
            .map(rt => rt?.text?.content || '')
            .join('');
          if (cellContent) cellsText.push(cellContent);
        });
      });
      content = cellsText.join(' | ');
      charCount = content.length;
    } else {
      // For other blocks, count rich_text
      const rt = block[block.type]?.rich_text || [];
      content = rt.map(r => r.text?.content || '').join('');
      charCount = content.length;
    }
    
    totalChars += charCount;
    if (charCount > 0) {
      console.log(`[${idx}] ${block.type.padEnd(20)} - ${charCount} chars: "${content.substring(0, 60)}"`);
    } else if (block.type === 'table') {
      console.log(`[${idx}] ${block.type.padEnd(20)} - ${charCount} chars (EMPTY TABLE!)`);
    }
  });
  
  console.log('\n📊 Total characters in blocks:', totalChars);
  console.log('📊 Source HTML length:', html.length);
  console.log('📊 Coverage:', Math.round(100 * totalChars / html.length) + '%');
})();
