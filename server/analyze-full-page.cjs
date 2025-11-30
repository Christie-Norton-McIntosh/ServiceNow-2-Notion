const { Client } = require('@notionhq/client');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getBlockChildren(blockId, depth = 0) {
  const blocks = [];
  let cursor;
  
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100
    });
    
    for (const block of response.results) {
      blocks.push({ block, depth });
      
      // Recursively get children if block has them
      if (block.has_children) {
        const children = await getBlockChildren(block.id, depth + 1);
        blocks.push(...children);
      }
    }
    
    cursor = response.next_cursor;
  } while (cursor);
  
  return blocks;
}

async function analyzePage(pageId) {
  try {
    const cleanId = pageId.replace(/-/g, '');
    
    const page = await notion.pages.retrieve({ page_id: cleanId });
    const title = page.properties.Name?.title?.[0]?.plain_text || 'No title';
    
    console.log(`\n📄 Page: ${title}`);
    console.log(`📅 Created: ${page.created_time}\n`);
    console.log('='.repeat(100) + '\n');
    
    const allBlocks = await getBlockChildren(cleanId);
    
    console.log(`📊 Total blocks (including nested): ${allBlocks.length}\n`);
    
    let issues = {
      emptyListItems: [],
      titleOnlyCallouts: [],
      tables: [],
      allCallouts: []
    };
    
    allBlocks.forEach(({ block, depth }, idx) => {
      const type = block.type;
      const indent = '  '.repeat(depth);
      const blockNum = idx + 1;
      
      // List items
      if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
        const richText = block[type].rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        const hasChildren = block.has_children;
        
        console.log(`${indent}${blockNum}. ${type.toUpperCase()}${hasChildren ? ' (has children)' : ''}`);
        console.log(`${indent}   Text: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
        
        // Check for empty or problematic patterns
        if (!text || text.length === 0) {
          issues.emptyListItems.push({ blockNum, depth, type, hasChildren });
          console.log(`${indent}   ❌ EMPTY LIST ITEM`);
        }
        
        // Check for empty rich text elements
        const emptyElements = richText.filter(rt => !rt.plain_text || rt.plain_text.trim() === '');
        if (emptyElements.length > 0) {
          console.log(`${indent}   ⚠️ Has ${emptyElements.length} empty rich_text element(s)`);
        }
        
        // Check for specific text patterns from user's report
        if (text.includes('Relationship Types and Related Items') || 
            text.includes('Relationship Levels')) {
          console.log(`${indent}   🔍 KEY CONTEXT MATCH`);
        }
        
        console.log('');
      }
      
      // Callouts
      if (type === 'callout') {
        const richText = block.callout.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        const icon = block.callout.icon?.emoji || '📌';
        
        issues.allCallouts.push({ blockNum, depth, text, icon });
        
        console.log(`${indent}${blockNum}. CALLOUT ${icon}`);
        console.log(`${indent}   Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        
        // Check if title-only
        const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
        if (titleOnlyPattern.test(text)) {
          issues.titleOnlyCallouts.push({ blockNum, depth, text, icon });
          console.log(`${indent}   ❌ TITLE-ONLY CALLOUT`);
        }
        
        console.log('');
      }
      
      // Tables
      if (type === 'table') {
        const width = block.table.table_width;
        issues.tables.push({ blockNum, depth, width });
        
        console.log(`${indent}${blockNum}. TABLE (${width} cols)`);
        console.log('');
      }
      
      // Paragraphs with key text
      if (type === 'paragraph') {
        const richText = block.paragraph.rich_text;
        const text = richText.map(rt => rt.plain_text).join('').trim();
        
        if (text.includes('Connection UI Notations') || 
            text.includes('Relationship Types') ||
            text.includes('Relationship Levels')) {
          console.log(`${indent}${blockNum}. PARAGRAPH (KEY CONTEXT)`);
          console.log(`${indent}   "${text}"`);
          console.log('');
        }
      }
    });
    
    // Summary
    console.log('\n' + '='.repeat(100));
    console.log('\n🔍 ISSUES SUMMARY:\n');
    
    if (issues.emptyListItems.length > 0) {
      console.log(`❌ Empty list items: ${issues.emptyListItems.length}`);
      issues.emptyListItems.forEach(item => {
        console.log(`   Block ${item.blockNum} (depth ${item.depth}): ${item.type}${item.hasChildren ? ' with children' : ''}`);
      });
      console.log('');
    }
    
    if (issues.titleOnlyCallouts.length > 0) {
      console.log(`❌ Title-only callouts: ${issues.titleOnlyCallouts.length}`);
      issues.titleOnlyCallouts.forEach(item => {
        console.log(`   Block ${item.blockNum} (depth ${item.depth}): "${item.text}"`);
      });
      console.log('');
    }
    
    if (issues.tables.length > 0) {
      console.log(`📊 Tables: ${issues.tables.length}`);
      issues.tables.forEach((item, idx) => {
        console.log(`   ${idx + 1}. Block ${item.blockNum} (depth ${item.depth}): ${item.width} columns`);
      });
      
      // Check for duplicates by width
      const widthCounts = {};
      issues.tables.forEach(t => {
        widthCounts[t.width] = (widthCounts[t.width] || 0) + 1;
      });
      
      Object.entries(widthCounts).forEach(([width, count]) => {
        if (count > 1) {
          console.log(`   ⚠️ ${count} tables with ${width} columns (potential duplicates)`);
        }
      });
      console.log('');
    }
    
    console.log(`📋 All callouts: ${issues.allCallouts.length}`);
    issues.allCallouts.forEach(c => {
      const preview = c.text.substring(0, 60);
      console.log(`   Block ${c.blockNum} (depth ${c.depth}): "${preview}${c.text.length > 60 ? '...' : ''}"`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) console.error(error.stack);
  }
}

analyzePage('2b4a89fedba5813690a2d7028920ed6d');
