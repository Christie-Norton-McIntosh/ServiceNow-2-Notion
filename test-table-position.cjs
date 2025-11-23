#!/usr/bin/env node

// Test table positioning with detailed logging
const fs = require('fs');
const path = require('path');

async function testTablePosition() {
  const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  const payload = {
    title: 'Table Position Test - CMDB Query Builder',
    databaseId: '2b2a89fe-dba5-8044-a4ec-c4492c4cc2ff',
    contentHtml: html,
    url: 'https://docs.servicenow.com/test',
    properties: {},
    dryRun: true  // Just convert, don't create page
  };
  
  console.log('🧪 Sending extraction request...\n');
  
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('✅ Dry-run conversion successful!');
    console.log(`📊 Total root blocks: ${result.data.children.length}\n`);
    
    // Recursively search all blocks
    function searchBlocks(blocks, path = []) {
      const findings = [];
      
      blocks.forEach((block, idx) => {
        const currentPath = [...path, idx];
        const pathStr = currentPath.join('.');
        const blockData = block[block.type];
        
        // Check for caption
        if (block.type === 'heading_3' && blockData.rich_text) {
          const text = blockData.rich_text.map(rt => rt.text?.content || '').join('');
          if (text.includes('Connection UI Notations')) {
            findings.push({ type: 'caption', path: pathStr, text, depth: path.length });
          }
        }
        
        // Check for table
        if (block.type === 'table') {
          // Get row count to help identify which table this is
          const rowCount = blockData.children ? blockData.children.length : 0;
          findings.push({ type: 'table', path: pathStr, cols: block.table.table_width, rows: rowCount, depth: path.length });
        }
        
        // Check for "Add Tags" text
        if (blockData && blockData.rich_text) {
          const text = blockData.rich_text.map(rt => rt.text?.content || '').join('');
          if (text.includes('Add Tags') && text.includes('close') && text.includes('dialog')) {
            findings.push({ type: 'addTags', path: pathStr, text: text.substring(0, 60), depth: path.length });
          }
        }
        
        // Check for markers in text
        if (blockData && blockData.rich_text) {
          const text = blockData.rich_text.map(rt => rt.text?.content || '').join('');
          const markers = text.match(/\(sn2n:[a-z0-9-]+\)/gi);
          if (markers) {
            findings.push({ type: 'marker', path: pathStr, markers, text: text.substring(0, 80), depth: path.length });
          }
        }
        
        // Recurse into children
        if (blockData && blockData.children && blockData.children.length > 0) {
          findings.push(...searchBlocks(blockData.children, currentPath));
        }
      });
      
      return findings;
    }
    
    const findings = searchBlocks(result.data.children);
    
    console.log(`🔍 Found ${findings.length} items of interest:\n`);
    findings.forEach(f => {
      if (f.type === 'caption') {
        console.log(`[${f.path}] (depth ${f.depth}) CAPTION: "${f.text}"`);
      } else if (f.type === 'table') {
        console.log(`[${f.path}] (depth ${f.depth}) TABLE: ${f.cols} cols x ${f.rows} rows`);
      } else if (f.type === 'addTags') {
        console.log(`[${f.path}] (depth ${f.depth}) ADD TAGS: "${f.text}..."`);
      } else if (f.type === 'marker') {
        console.log(`[${f.path}] (depth ${f.depth}) MARKER: ${f.markers.join(', ')} in "${f.text}..."`);
      }
    });
    
    // Analyze ordering
    const caption = findings.find(f => f.type === 'caption');
    const tables = findings.filter(f => f.type === 'table');
    const addTags = findings.find(f => f.type === 'addTags');
    const markers = findings.filter(f => f.type === 'marker');
    
    console.log(`\n📈 Analysis:`);
    if (caption) console.log(`   Caption: ${caption.path} (depth ${caption.depth})`);
    console.log(`   Tables found: ${tables.length}`);
    tables.forEach((t, idx) => {
      console.log(`     [${idx + 1}] ${t.path} (depth ${t.depth}) - ${t.cols}x${t.rows}`);
    });
    if (addTags) console.log(`   Add Tags: ${addTags.path} (depth ${addTags.depth})`);
    console.log(`   Markers found: ${markers.length}`);
    
    if (tables.length > 0 && addTags) {
      console.log(`\n🔍 Checking table positions relative to "Add Tags" text:`);
      tables.forEach((table, idx) => {
        // Compare paths as arrays to determine which comes first
        const tablePath = table.path.split('.').map(Number);
        const addTagsPath = addTags.path.split('.').map(Number);
        
        for (let i = 0; i < Math.min(tablePath.length, addTagsPath.length); i++) {
          if (tablePath[i] < addTagsPath[i]) {
            console.log(`   Table ${idx + 1} (${table.path}): ✅ BEFORE Add Tags (correct)`);
            break;
          } else if (tablePath[i] > addTagsPath[i]) {
            console.log(`   Table ${idx + 1} (${table.path}): ❌ AFTER Add Tags (WRONG!)`);
            break;
          }
        }
      });
    }
  } else {
    console.error('\n❌ Extraction failed:', result);
  }
}

testTablePosition().catch(console.error);
