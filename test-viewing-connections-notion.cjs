/**
 * Fetch viewing-api-data-connections page from Notion to check for duplicates
 */

const { Client } = require('./server/node_modules/@notionhq/client');
require('dotenv').config({ path: './server/.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2b3a89fedba5817796acdeac63da97bb'; // viewing-api-data-connections

async function analyzePageForDuplicates() {
  console.log('🔍 Fetching viewing-api-data-connections page from Notion...\n');
  
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
    
    const callouts = blocks.filter(b => b.type === 'callout');
    console.log(`Callouts: ${callouts.length}`);
    console.log(`Expected: 2 (from 2 prereq sections in HTML)\n`);
    
    console.log('📋 All callouts:');
    callouts.forEach((c, idx) => {
      const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
      const emoji = c.callout?.icon?.emoji;
      console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
    });
    
    // Check for duplicates
    const calloutTexts = new Map();
    callouts.forEach((c, idx) => {
      const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').trim();
      const emoji = c.callout?.icon?.emoji;
      const key = `${emoji}:${text}`;
      
      if (calloutTexts.has(key)) {
        calloutTexts.get(key).push({ idx, id: c.id });
      } else {
        calloutTexts.set(key, [{ idx, id: c.id }]);
      }
    });
    
    const duplicates = Array.from(calloutTexts.entries()).filter(([key, items]) => items.length > 1);
    
    if (duplicates.length > 0) {
      console.log(`\n❌ Found ${duplicates.length} duplicate callout(s):\n`);
      duplicates.forEach(([key, items]) => {
        const [emoji, text] = key.split(':');
        console.log(`  ${emoji} "${text.substring(0, 80)}..."`);
        console.log(`  Appears ${items.length} times at indices: ${items.map(i => i.idx).join(', ')}`);
        console.log(`  FULL Block IDs:`);
        items.forEach((item, i) => {
          console.log(`    [${i}] ${item.id}`);
        });
        console.log('');
      });
    } else {
      console.log('\n✅ No duplicate callouts found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'object_not_found') {
      console.error('Page not found. Check the page ID.');
    }
  }
}

analyzePageForDuplicates();
