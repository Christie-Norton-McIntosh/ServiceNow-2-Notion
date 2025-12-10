const fs = require('fs');
const axios = require('axios');

const html = fs.readFileSync('../patch/pages/pages-to-update/legacy-software-asset-management-plugin-roles-2025-12-04T05-21-41.html', 'utf8');
const pageId = '2bfa89fe-dba5-81dc-916a-f551ecfa6f59';

async function patchPage() {
  console.log('📄 PATCHing Legacy Software Asset Management plugin roles page...\n');
  
  const response = await axios.patch(`http://localhost:3004/api/W2N/${pageId}`, {
    contentHtml: html,
    title: 'Legacy Software Asset Management plugin roles',
    url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/reference/r_SoftwareAssetManagementRoles.html',
    dryRun: false
  });
  
  console.log('✅ PATCH complete!');
  console.log('Response:', JSON.stringify(response.data, null, 2));
}

patchPage().catch(error => {
  console.error('❌ Error:', error.message);
  if (error.response) {
    console.error('Status:', error.response.status);
    console.error('Data:', JSON.stringify(error.response.data, null, 2));
  }
});
