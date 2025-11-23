#!/usr/bin/env node

const { Client } = require('@notionhq/client');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'server', '.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

if (!process.env.NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN not found in environment!');
  process.exit(1);
}

async function analyzePage() {
  const pageId = '2b4a89fe-dba5-819e-99ec-ee705a40aef1';
  
  // Recursively fetch all blocks
  async function getAllBlocks(blockId, path = []) {
    const blocks = [];
    let cursor;
    
    do {
      const response = await notion.blocks.children.list({
        block_id: blockId,
        page_size: 100,
        start_cursor: cursor
      });
      
      for (const block of response.results) {
        const currentPath = [...path, blocks.length];
        blocks.push({ block, path: currentPath.join('.') });
        
        // Recurse into children (always try, even if has_children is false)
        if (block.has_children) {
          try {
            const children = await getAllBlocks(block.id, currentPath);
            blocks.push(...children);
          } catch (e) {
            // Ignore errors fetching children
          }
        }
      }
      
      cursor = response.next_cursor;
    } while (cursor);
    
    return blocks;
  }
  
  const allBlocks = await getAllBlocks(pageId);
  
  console.log(`Total blocks found: ${allBlocks.length}\n`);
  
  // Show ALL block types (truncated for readability)
  console.log('📋 All blocks (all, showing around blocks 34-45):');
  allBlocks.slice(30, 50).forEach(({ block, path }) => {
    const depth = path.split('.').length - 1;
    const indent = '  '.repeat(depth);
    console.log(`${indent}[${path}] ${block.type}`);
  });
  if (allBlocks.length > 50) {
    console.log(`  ... (${allBlocks.length - 50} more blocks)\n`);
  } else {
    console.log('')  ;
  }
  
  // Find items of interest
  const findings = [];
  allBlocks.forEach(({ block, path }) => {
    const blockData = block[block.type];
    const depth = path.split('.').length - 1;
    
    // Caption
    if (block.type === 'heading_3' && blockData.rich_text) {
      const text = blockData.rich_text.map(rt => rt.plain_text).join('');
      if (text.includes('Connection UI Notations')) {
        findings.push({ type: 'caption', path, text, depth });
      }
    }
    
    // Tables
    if (block.type === 'table') {
      findings.push({ type: 'table', path, cols: block.table.table_width, depth });
    }
    
    // Add Tags text
    if (blockData && blockData.rich_text) {
      const text = blockData.rich_text.map(rt => rt.plain_text || '').join('');
      if (text.includes('Add Tags') && text.includes('close') && text.includes('dialog')) {
        findings.push({ type: 'addTags', path, text: text.substring(0, 60), depth });
      }
      
      // Markers
      const markers = text.match(/\(sn2n:[a-z0-9-]+\)/gi);
      if (markers) {
        findings.push({ type: 'marker', path, markers, text: text.substring(0, 80), depth });
      }
    }
  });
  
  console.log(`Found ${findings.length} items of interest:\n`);
  findings.forEach(f => {
    if (f.type === 'caption') {
      console.log(`[${f.path}] depth ${f.depth} CAPTION: "${f.text}"`);
    } else if (f.type === 'table') {
      console.log(`[${f.path}] depth ${f.depth} TABLE: ${f.cols} cols`);
    } else if (f.type === 'addTags') {
      console.log(`[${f.path}] depth ${f.depth} ADD TAGS: "${f.text}..."`);
    } else if (f.type === 'marker') {
      console.log(`[${f.path}] depth ${f.depth} MARKER: ${f.markers.join(', ')} in "${f.text}..."`);
    }
  });
  
  // Analysis
  const tables = findings.filter(f => f.type === 'table');
  const addTags = findings.find(f => f.type === 'addTags');
  const markers = findings.filter(f => f.type === 'marker');
  
  console.log(`\n📈 Analysis:`);
  console.log(`   Tables found: ${tables.length}`);
  tables.forEach((t, idx) => {
    console.log(`     [${idx + 1}] ${t.path} (depth ${t.depth})`);
  });
  if (addTags) console.log(`   Add Tags: ${addTags.path} (depth ${addTags.depth})`);
  console.log(`   Markers: ${markers.length}`);
  
  if (tables.length > 0 && addTags) {
    console.log(`\n🔍 Table positions relative to Add Tags:`);
    tables.forEach((table, idx) => {
      const tablePath = table.path.split('.').map(Number);
      const addTagsPath = addTags.path.split('.').map(Number);
      
      for (let i = 0; i < Math.min(tablePath.length, addTagsPath.length); i++) {
        if (tablePath[i] < addTagsPath[i]) {
          console.log(`   Table ${idx + 1}: ✅ BEFORE Add Tags`);
          break;
        } else if (tablePath[i] > addTagsPath[i]) {
          console.log(`   Table ${idx + 1}: ❌ AFTER Add Tags (WRONG!)`);
          break;
        }
      }
    });
  }
}

analyzePage().catch(e => console.error('Error:', e.message));
