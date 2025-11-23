const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function analyzeProblematicPage(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    console.log(`\n📄 Fetching page: ${cleanId}\n`);
    
    const page = await notion.pages.retrieve({ page_id: cleanId });
    const title = page.properties.Name?.title?.[0]?.plain_text || 'No title';
    console.log(`📌 Title: ${title}\n`);
    console.log(`📅 Created: ${page.created_time}`);
    console.log(`📝 Last edited: ${page.last_edited_time}\n`);
    
    const blocks = [];
    let cursor;
    
    do {
      const response = await notion.blocks.children.list({
        block_id: cleanId,
        start_cursor: cursor,
        page_size: 100
      });
      blocks.push(...response.results);
      cursor = response.next_cursor;
    } while (cursor);
    
    console.log(`📊 Total blocks: ${blocks.length}\n`);
    console.log('=' .repeat(80) + '\n');
    
    // Track issues
    let emptyListItems = [];
    let titleOnlyCallouts = [];
    let tables = [];
    let allCallouts = [];
    
    blocks.forEach((block, idx) => {
      const type = block.type;
      const blockNum = idx + 1;
      
      // Check list items
      if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        const richText = block[type].rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        
        console.log(`${blockNum}. ${type.toUpperCase()}`);
        console.log(`   Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        console.log(`   Rich text elements: ${richText.length}`);
        
        // Check for empty
        if (!text || text.length === 0) {
          emptyListItems.push({ blockNum, type, text });
          console.log(`   ⚠️ EMPTY LIST ITEM`);
        }
        
        // Check for empty rich text elements
        const hasEmptyElements = richText.some(rt => !rt.plain_text || rt.plain_text.trim() === '');
        if (hasEmptyElements) {
          console.log(`   ⚠️ HAS EMPTY RICH_TEXT ELEMENTS:`);
          richText.forEach((rt, i) => {
            console.log(`      [${i}] "${rt.plain_text}" (len: ${rt.plain_text.length})`);
          });
        }
        
        console.log('');
      }
      
      // Check callouts
      if (type === 'callout') {
        const richText = block.callout.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        const icon = block.callout.icon?.emoji || '📌';
        
        allCallouts.push({ blockNum, text, icon });
        
        console.log(`${blockNum}. CALLOUT ${icon}`);
        console.log(`   Text: "${text}"`);
        console.log(`   Rich text elements: ${richText.length}`);
        
        // Check if title-only
        const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
        if (titleOnlyPattern.test(text)) {
          titleOnlyCallouts.push({ blockNum, text, icon });
          console.log(`   ⚠️ TITLE-ONLY CALLOUT (should be filtered)`);
        }
        
        console.log('');
      }
      
      // Check tables
      if (type === 'table') {
        const width = block.table.table_width;
        tables.push({ blockNum, width });
        
        console.log(`${blockNum}. TABLE`);
        console.log(`   Columns: ${width}`);
        console.log('');
      }
      
      // Show paragraphs near issues
      if (type === 'paragraph') {
        const richText = block.paragraph.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        
        if (text.includes('Relationship Types and Related Items') || 
            text.includes('Connection UI Notations') ||
            text.includes('Relationship Levels')) {
          console.log(`${blockNum}. PARAGRAPH (KEY CONTEXT)`);
          console.log(`   Text: "${text}"`);
          console.log('');
        }
      }
    });
    
    // Summary
    console.log('\n' + '=' .repeat(80));
    console.log('\n🔍 ISSUES FOUND:\n');
    
    if (emptyListItems.length > 0) {
      console.log(`❌ Empty list items: ${emptyListItems.length}`);
      emptyListItems.forEach(item => {
        console.log(`   - Block ${item.blockNum}: ${item.type}`);
      });
      console.log('');
    }
    
    if (titleOnlyCallouts.length > 0) {
      console.log(`❌ Title-only callouts: ${titleOnlyCallouts.length}`);
      titleOnlyCallouts.forEach(item => {
        console.log(`   - Block ${item.blockNum}: "${item.text}"`);
      });
      console.log('');
    }
    
    if (tables.length > 0) {
      console.log(`📊 Tables found: ${tables.length}`);
      tables.forEach(item => {
        console.log(`   - Block ${item.blockNum}: ${item.width} columns`);
      });
      
      // Check for duplicates
      const tablesByWidth = {};
      tables.forEach(t => {
        tablesByWidth[t.width] = (tablesByWidth[t.width] || 0) + 1;
      });
      
      Object.entries(tablesByWidth).forEach(([width, count]) => {
        if (count > 1) {
          console.log(`   ⚠️ ${count} tables with ${width} columns (possible duplicates)`);
        }
      });
      console.log('');
    }
    
    console.log(`📋 All callouts: ${allCallouts.length}`);
    allCallouts.forEach(c => {
      console.log(`   - Block ${c.blockNum}: "${c.text.substring(0, 50)}${c.text.length > 50 ? '...' : ''}"`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
  }
}

analyzeProblematicPage('2b4a89fedba5813690a2d7028920ed6d');
