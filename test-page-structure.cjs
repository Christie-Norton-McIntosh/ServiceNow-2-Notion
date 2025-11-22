/**
 * Fetch viewing-api-data-connections page structure
 */

const { Client } = require('./server/node_modules/@notionhq/client');
require('dotenv').config({ path: './server/.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2b3a89fedba5817796acdeac63da97bb';

async function analyzePageStructure() {
  console.log('🔍 Fetching viewing-api-data-connections page structure...\n');
  
  try {
    const blocks = [];
    let cursor;
    
    do {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100
      });
      
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
    
    console.log(`📊 Total blocks: ${blocks.length}\n`);
    console.log('📋 Block structure:');
    blocks.forEach((b, idx) => {
      const type = b.type;
      let preview = '';
      
      if (type === 'paragraph') {
        preview = b.paragraph?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 60);
      } else if (type === 'heading_2') {
        preview = b.heading_2?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 60);
      } else if (type === 'callout') {
        preview = b.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 60);
      } else if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
        const textKey = type.replace('_item', '');
        preview = b[textKey]?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 60);
      }
      
      console.log(`  [${idx}] ${type.padEnd(20)} ${preview ? `"${preview}..."` : ''}`);
    });
    
    const callouts = blocks.filter(b => b.type === 'callout');
    console.log(`\n📊 Callout count: ${callouts.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

analyzePageStructure();
