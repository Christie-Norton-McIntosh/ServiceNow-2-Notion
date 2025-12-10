const fs = require('fs');
const axios = require('axios');

const html = fs.readFileSync('../patch/pages/validation-order-issues/predictive-intelligence-for-incident-management-order-issues-2025-12-04T05-19-58.html', 'utf8');
const pageId = '2bfa89fedba581ae87f5ffd9c0b08bfe';

async function testExtraction() {
  console.log('🧪 Testing extraction...\n');
  
  const response = await axios.patch(`http://localhost:3004/api/W2N/${pageId}`, {
    contentHtml: html,
    title: 'Predictive Intelligence for Incident Management',
    url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/predictive-intelligence/task/t_PredIntIncidentMgmt.html',
    dryRun: true
  });
  
  const children = response.data?.data?.children || [];
  console.log(`✅ Extracted ${children.length} blocks\n`);
  
  // Count block types
  const blockTypes = {};
  let totalChars = 0;
  
  children.forEach(block => {
    blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
    
    // Count characters
    if (block[block.type]?.rich_text) {
      const text = block[block.type].rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('');
      totalChars += text.length;
    }
  });
  
  console.log('📊 Block types:');
  Object.entries(blockTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });
  
  console.log(`\n📝 Total characters: ${totalChars}`);
  console.log(`📄 HTML characters: 4317`);
  console.log(`⚠️  Missing: ${4317 - totalChars} characters (${Math.round((1 - totalChars/4317) * 100)}%)\n`);
  
  // Show all blocks
  console.log('📋 All blocks:');
  children.forEach((block, idx) => {
    const text = block[block.type]?.rich_text?.map(rt => rt.plain_text || rt.text?.content || '').join('') || 
                 (block.type === 'table' ? `[TABLE ${block.table?.table_width}x${block.table?.children?.length || 0}]` : '');
    const preview = text.substring(0, 100).replace(/\n/g, '\\n');
    console.log(`   [${idx}] ${block.type}: ${preview}${text.length > 100 ? '...' : ''}`);
  });
}

testExtraction().catch(console.error);
