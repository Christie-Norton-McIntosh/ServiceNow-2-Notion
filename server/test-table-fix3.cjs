const fs = require('fs');
const axios = require('axios');

const html = fs.readFileSync('../patch/pages/pages-to-update/legacy-software-asset-management-plugin-roles-2025-12-04T05-21-41.html', 'utf8');
const pageId = '2bfa89fe-dba5-81dc-916a-f551ecfa6f59';

async function testTableFix() {
  console.log('🧪 Testing table cell formatting fix...\n');
  
  const response = await axios.patch(`http://localhost:3004/api/W2N/${pageId}`, {
    contentHtml: html,
    title: 'TEST - Legacy Software Asset Management plugin roles',
    url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/reference/r_SoftwareAssetManagementRoles.html',
    dryRun: true
  });
  
  const children = response.data?.data?.children || response.data?.children || [];
  console.log(`Found ${children.length} blocks\n`);
  
  // Find the table
  const table = children.find(b => b.type === 'table');
  if (!table) {
    console.log('❌ No table found!');
    console.log('Block types:', children.map(b => b.type).join(', '));
    return;
  }
  
  console.log(`✅ Found table\n`);
  
  // Get table rows
  const rows = table.table.children || table.table.table_rows || [];
  console.log(`   Table has ${rows.length} rows\n`);
  
  if (rows.length < 2) {
    console.log('❌ Table does not have enough rows');
    return;
  }
  
  // Check the second row (first data row)
  const dataRow = rows[1];
  
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
      
      // Final verdict
      const isCorrect = lines.length === 4 && 
                       lines[0] === 'inventory_user' &&
                       cell.filter(rt => rt.annotations.code).length === 4;
      console.log(`\n   ${isCorrect ? '✅ PASS' : '❌ FAIL'}: Table cell formatting`);
    }
    console.log('');
  });
}

testTableFix().catch(console.error);
