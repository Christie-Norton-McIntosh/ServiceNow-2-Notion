const fs = require('fs');
const path = require('path');

// Start server and make request
async function testMarkerCollection() {
  const htmlPath = path.join(__dirname, '../tests/fixtures/validation-failures/software-asset-management-foundation-plugin-migration-2025-11-10T02-31-39.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test Marker Collection',
      databaseId: 'test',
      contentHtml: html,
      dryRun: true
    })
  });
  
  const result = await response.json();
  console.log('Dry run result:', JSON.stringify(result, null, 2));
}

testMarkerCollection().catch(console.error);
