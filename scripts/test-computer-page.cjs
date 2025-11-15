#!/usr/bin/env node
/**
 * Test extraction and validation for computer page
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const htmlPath = path.join(__dirname, '..', 'patch', 'pages-to-update', 'computer-cmdb-ci-computer-class-2025-11-15T06-55-14.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

// Extract page info from comment
const pageIdMatch = html.match(/Page ID: ([a-f0-9-]+)/);
const pageId = pageIdMatch ? pageIdMatch[1].replace(/-/g, '') : null;

console.log('📄 Testing Computer Page');
console.log('Page ID:', pageId);
console.log('');

async function test() {
  try {
    // Do a dry-run extraction
    console.log('🔄 Running dry-run extraction...');
    const response = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Computer [cmdb_ci_computer] class',
      databaseId: '282a89fe-dba5-815e-91f0-db972912ef9f',
      contentHtml: html,
      dryRun: true
    });

    const { children, validation } = response.data.data;
    
    console.log('✅ Extraction successful');
    console.log(`   Total blocks: ${children.length}`);
    console.log('');
    
    // Count block types
    const blockCounts = {};
    function countBlocks(blocks) {
      for (const block of blocks) {
        const type = block.type;
        blockCounts[type] = (blockCounts[type] || 0) + 1;
        
        // Count children recursively
        if (block[type]?.children) {
          countBlocks(block[type].children);
        }
        
        // For tables, count rows
        if (type === 'table' && block.table?.children) {
          countBlocks(block.table.children);
        }
      }
    }
    
    countBlocks(children);
    
    console.log('📊 Block Type Counts:');
    Object.entries(blockCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   ${type}: ${count}`);
      });
    console.log('');
    
    // Find tables
    const tables = [];
    function findTables(blocks, depth = 0) {
      for (const block of blocks) {
        if (block.type === 'table') {
          const rowCount = block.table?.children?.length || 0;
          const width = block.table?.table_width || 0;
          tables.push({ depth, rowCount, width });
        }
        
        // Check children
        if (block[block.type]?.children) {
          findTables(block[block.type].children, depth + 1);
        }
      }
    }
    
    findTables(children);
    
    console.log(`📊 Table Analysis: Found ${tables.length} table(s)`);
    tables.forEach((table, idx) => {
      console.log(`   Table ${idx + 1}: ${table.rowCount} rows × ${table.width} columns (depth: ${table.depth})`);
    });
    console.log('');
    
    // Source HTML analysis
    console.log('📄 Source HTML Analysis:');
    const tableMatches = html.match(/<table[^>]*id=/g);
    console.log(`   <table> tags with id: ${tableMatches ? tableMatches.length : 0}`);
    
    // Extract table IDs
    const tableIds = [];
    const idRegex = /<table[^>]*id="([^"]+)"/g;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      tableIds.push(match[1]);
    }
    console.log('   Table IDs found:');
    tableIds.forEach(id => console.log(`      - ${id}`));
    console.log('');
    
    // Validation results
    if (validation) {
      console.log('✅ Validation Results:');
      console.log(`   Status: ${validation.status}`);
      if (validation.sourceComparison) {
        const sc = validation.sourceComparison;
        console.log('   Source Comparison:');
        console.log(`      HTML tables: ${sc.source?.tables || 0}`);
        console.log(`      Notion tables: ${sc.notion?.tables || 0}`);
        console.log(`      HTML images: ${sc.source?.images || 0}`);
        console.log(`      Notion images: ${sc.notion?.images || 0}`);
      }
      if (validation.errors && validation.errors.length > 0) {
        console.log('   ❌ Errors:');
        validation.errors.forEach(err => console.log(`      - ${err}`));
      }
      if (validation.warnings && validation.warnings.length > 0) {
        console.log('   ⚠️  Warnings:');
        validation.warnings.forEach(warn => console.log(`      - ${warn}`));
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

test();
