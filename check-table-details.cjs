#!/usr/bin/env node
const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').join(__dirname, 'server/.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2b4a89fedba5818aa350cb8e1a3c8369';

async function checkTableDetails() {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100
  });

  let blockIndex = 0;
  for (const block of response.results) {
    if (block.type === 'table') {
      console.log(`\n[${String(blockIndex).padStart(3, '0')}] TABLE`);
      
      // Get table children to see content
      const tableChildren = await notion.blocks.children.list({
        block_id: block.id,
        page_size: 100
      });
      
      console.log(`  Rows: ${tableChildren.results.length}`);
      for (let i = 0; i < Math.min(3, tableChildren.results.length); i++) {
        const row = tableChildren.results[i];
        if (row.type === 'table_row') {
          const cells = row.table_row.cells;
          const text = cells.map(cell => 
            cell.map(t => t.plain_text).join('').substring(0, 40)
          ).join(' | ');
          console.log(`    Row ${i}: ${text}`);
        }
      }
    }
    blockIndex++;
  }
}

checkTableDetails().catch(console.error);
