const fs = require('fs');
const axios = require('axios');

const html = fs.readFileSync('../patch/pages/pages-to-update/legacy-software-asset-management-plugin-roles-2025-12-04T05-21-41.html', 'utf8');
const pageId = '2bfa89fe-dba5-81dc-916a-f551ecfa6f59';

async function testTableFix() {
  console.log('🧪 Testing table cell formatting fix...\n');
  
  try {
    const response = await axios.patch(`http://localhost:3004/api/W2N/${pageId}`, {
      contentHtml: html,
      title: 'TEST - Legacy Software Asset Management plugin roles',
      url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/reference/r_SoftwareAssetManagementRoles.html',
      dryRun: true
    });
    
    console.log('✅ API Response received');
    console.log('Response keys:', Object.keys(response.data));
    
    if (!response.data.data.children) {
      console.log('❌ No children array in response');
      console.log('Response data:', JSON.stringify(response.data, null, 2).substring(0, 500));
      return;
    }
    
    const { children } = response.data;
    console.log(`Found ${children.length} blocks\n`);
    
    // Find the table
    const table = children.find(b => b.type === 'table');
    if (!table) {
      console.log('❌ No table found!');
      console.log('Block types:', children.map(b => b.type).join(', '));
      return;
    }
    
    console.log(`✅ Found table with ${table.table.children.length} rows\n`);
    
    // Check the second row (first data row)
    const dataRow = table.table.children[1];
    if (!dataRow || dataRow.type !== 'table_row') {
      console.log('❌ No data row found!');
      return;
    }
    
    console.log('📊 Second row (sam role) cells:\n');
    
    dataRow.table_row.cells.forEach((cell, idx) => {
      const text = cell.map(rt => rt.plain_text).join('');
      const hasCode = cell.some(rt => rt.annotations.code);
      const hasNewlines = text.includes('\n');
      
      console.log(`   Cell ${idx + 1}:`);
      console.log(`      Text: ${text.replace(/\n/g, '\\n')}`);
      console.log(`      Has code formatting: ${hasCode ? '✅' : '❌'}`);
      console.log(`      Has newlines: ${hasNewlines ? '✅' : '❌'}`);
      console.log(`      Rich text segments: ${cell.length}`);
      
      if (idx === 1) {
        // Second cell - should have 4 role names, each on its own line, each with code formatting
        console.log(`\n   📋 Detailed rich text analysis for "Contains Role Names" column:`);
        cell.forEach((rt, rtIdx) => {
          console.log(`      [${rtIdx}] "${rt.plain_text}" - code: ${rt.annotations.code}`);
        });
        
        // Check expectations
        const lines = text.split('\n');
        console.log(`\n   ✓ Expectations:`);
        console.log(`      Lines: ${lines.length} (expected 4)`);
        console.log(`      First line: "${lines[0]}" (expected "inventory_user")`);
        console.log(`      Code segments: ${cell.filter(rt => rt.annotations.code).length} (expected 4)`);
      }
      console.log('');
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testTableFix().catch(console.error);
