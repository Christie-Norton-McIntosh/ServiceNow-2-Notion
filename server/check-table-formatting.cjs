const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2bfa89fedba581dc916af551ecfa6f59';

async function analyzePage() {
  console.log('📄 Fetching page blocks...\n');
  
  const blocks = [];
  let cursor;
  
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100
    });
    blocks.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);
  
  console.log(`Found ${blocks.length} blocks\n`);
  
  // Find tables
  const tables = blocks.filter(b => b.type === 'table');
  console.log(`Found ${tables.length} table(s)\n`);
  
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    console.log(`\n📊 TABLE ${i + 1}:`);
    console.log(`   Rows: ${table.table.table_width}x${table.table.has_column_header ? 'header+' : ''}${table.table.table_height}`);
    
    // Fetch table rows
    const rowsResponse = await notion.blocks.children.list({
      block_id: table.id,
      page_size: 100
    });
    
    console.log(`\n   Content:`);
    rowsResponse.results.forEach((row, idx) => {
      if (row.type === 'table_row') {
        const cells = row.table_row.cells.map(cell => {
          const text = cell.map(rt => rt.plain_text).join('');
          // Check for newlines or inline code
          const hasNewline = text.includes('\n');
          const hasCode = cell.some(rt => rt.annotations.code);
          let display = text.length > 60 ? text.substring(0, 60) + '...' : text;
          display = display.replace(/\n/g, '\\n');
          if (hasCode) display = `[CODE] ${display}`;
          if (hasNewline) display = `[NL] ${display}`;
          return display;
        });
        console.log(`   [${idx}] ${cells.join(' | ')}`);
      }
    });
  }
}

analyzePage().catch(console.error);
