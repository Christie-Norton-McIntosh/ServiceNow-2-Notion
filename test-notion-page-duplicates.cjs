/**
 * Fetch and analyze the actual Notion page for duplicate content
 */

const { Client } = require('./server/node_modules/@notionhq/client');
require('dotenv').config({ path: './server/.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2b3a89fedba5818bab59d1fa2cb47604'; // From the HTML file

async function analyzePageForDuplicates() {
  console.log('🔍 Fetching page blocks from Notion...\n');
  
  try {
    // Fetch all blocks recursively
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
    
    // Group by type
    const blocksByType = {};
    blocks.forEach(b => {
      blocksByType[b.type] = blocksByType[b.type] || [];
      blocksByType[b.type].push(b);
    });
    
    console.log('Block types:');
    Object.entries(blocksByType).forEach(([type, blks]) => {
      console.log(`  ${type}: ${blks.length}`);
    });
    
    // Check for duplicate paragraphs
    console.log('\n🔍 Checking for duplicate paragraphs...');
    const paragraphs = blocksByType.paragraph || [];
    const paragraphTexts = new Map();
    
    paragraphs.forEach((p, idx) => {
      const text = p.paragraph?.rich_text?.map(rt => rt.text?.content || '').join('').trim();
      if (text.length > 20) {
        if (paragraphTexts.has(text)) {
          paragraphTexts.get(text).push({ idx, id: p.id });
        } else {
          paragraphTexts.set(text, [{ idx, id: p.id }]);
        }
      }
    });
    
    const duplicates = Array.from(paragraphTexts.entries()).filter(([text, items]) => items.length > 1);
    
    if (duplicates.length > 0) {
      console.log(`❌ Found ${duplicates.length} duplicate paragraph(s):\n`);
      duplicates.forEach(([text, items]) => {
        console.log(`  Text: "${text.substring(0, 100)}..."`);
        console.log(`  Appears ${items.length} times at indices: ${items.map(i => i.idx).join(', ')}`);
        console.log(`  Block IDs: ${items.map(i => i.id).join(', ')}\n`);
      });
    } else {
      console.log('✅ No duplicate paragraphs found');
    }
    
    // Check for duplicate callouts
    console.log('\n🔍 Checking for duplicate callouts...');
    const callouts = blocksByType.callout || [];
    console.log(`Total callouts: ${callouts.length}`);
    
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
    
    const calloutDuplicates = Array.from(calloutTexts.entries()).filter(([key, items]) => items.length > 1);
    
    if (calloutDuplicates.length > 0) {
      console.log(`❌ Found ${calloutDuplicates.length} duplicate callout(s):\n`);
      calloutDuplicates.forEach(([key, items]) => {
        const [emoji, text] = key.split(':');
        console.log(`  ${emoji} "${text.substring(0, 100)}..."`);
        console.log(`  Appears ${items.length} times at indices: ${items.map(i => i.idx).join(', ')}`);
        console.log(`  Block IDs: ${items.map(i => i.id).join(', ')}\n`);
      });
    } else {
      console.log('✅ No duplicate callouts found');
    }
    
    // Show all callouts
    console.log('\n📋 All callouts:');
    callouts.forEach((c, idx) => {
      const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
      const emoji = c.callout?.icon?.emoji;
      console.log(`  [${idx}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'object_not_found') {
      console.error('Page not found. Check the page ID.');
    }
  }
}

analyzePageForDuplicates();
