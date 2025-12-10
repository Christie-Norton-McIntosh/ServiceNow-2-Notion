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
  
  const children = response.data?.data?.children || [];
  const table = children.find(b => b.type === 'table');
  const rows = table.table.children || [];
  const dataRow = rows[1];
  
  console.log('📊 Second cell (Contains Role Names) structure:\n');
  const cell = dataRow.table_row.cells[1];
  
  console.log(JSON.stringify(cell, null, 2));
}

testTableFix().catch(console.error);
