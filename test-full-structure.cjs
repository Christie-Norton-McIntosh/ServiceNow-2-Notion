#!/usr/bin/env node

// Comprehensive structure test
const fs = require('fs');
const path = require('path');

async function testFullStructure() {
  const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  
  const payload = {
    title: 'Full Structure Test - CMDB Query Builder',
    databaseId: '2b2a89fe-dba5-8044-a4ec-c4492c4cc2ff',
    contentHtml: html,
    url: 'https://docs.servicenow.com/test',
    properties: {},
    dryRun: true
  };
  
  console.log('🧪 Testing full page structure...\n');
  
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (result.success) {
    console.log('✅ Dry-run conversion successful!');
    console.log(`📊 Total root blocks: ${result.data.children.length}\n`);
    
    // Show full structure
    function showStructure(blocks, indent = '', path = []) {
      blocks.forEach((block, idx) => {
        const currentPath = [...path, idx];
        const pathStr = currentPath.join('.');
        const blockData = block[block.type];
        
        // Get text preview
        let preview = '';
        if (blockData && blockData.rich_text) {
          preview = blockData.rich_text.map(rt => rt.text?.content || '').join('').substring(0, 60);
        } else if (block.type === 'table') {
          const rows = blockData.children ? blockData.children.length : 0;
          const cols = block.table.table_width;
          preview = `${cols}x${rows} table`;
        }
        
        console.log(`${indent}[${pathStr}] ${block.type}: ${preview}${preview.length >= 60 ? '...' : ''}`);
        
        // Recurse into children
        if (blockData && blockData.children && blockData.children.length > 0) {
          showStructure(blockData.children, indent + '  ', currentPath);
        }
      });
    }
    
    showStructure(result.data.children);
    
    // Count tables
    function countTables(blocks) {
      let count = 0;
      for (const block of blocks) {
        if (block.type === 'table') count++;
        const blockData = block[block.type];
        if (blockData && blockData.children) {
          count += countTables(blockData.children);
        }
      }
      return count;
    }
    
    console.log(`\n📊 Total tables found: ${countTables(result.data.children)}`);
    
  } else {
    console.error('❌ Conversion failed:', result.error);
  }
}

testFullStructure().catch(console.error);
