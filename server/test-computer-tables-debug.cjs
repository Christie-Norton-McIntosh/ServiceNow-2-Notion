const fs = require('fs');
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
  const html = fs.readFileSync('../patch/pages/pages-to-update/computer-cmdb-ci-computer-class-2025-11-17T03-22-31.html', 'utf8');
  
  // Strip HTML comment metadata
  const content = html.replace(/^<!--[\s\S]*?-->/, '');
  
  const result = await extractContentFromHtml(content);
  const tables = result.blocks.filter(b => b.type === 'table');
  
  console.log('Total blocks:', result.blocks.length);
  console.log('Table blocks:', tables.length);
  
  tables.forEach((t, i) => {
    const rows = t.table.children.length;
    const cols = t.table.table_width;
    const firstRowCells = t.table.children[0]?.table_row?.cells || [];
    const headers = firstRowCells.map(cell => 
      cell.map(rt => rt.plain_text || rt.text?.content || '').join('')
    ).join(' | ');
    
    console.log(`\nTable ${i+1}: ${cols} cols × ${rows} rows`);
    console.log(`  Headers: ${headers}`);
  });
})();
