#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

(async () => {
  const htmlPath = path.join(__dirname, 'patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test',
      databaseId: '2b2a89fe-dba5-8044-a4ec-c4492c4cc2ff',
      contentHtml: html,
      url: 'https://docs.servicenow.com/test',
      properties: {},
      dryRun: true
    })
  });
  const result = await response.json();
  if (result.success) {
    const item917 = result.data.children[9].numbered_list_item.children[17];
    console.log('Item 9.17 type:', item917.type);
    const text = item917[item917.type].rich_text.map(rt => rt.text?.content || '').join('');
    console.log('Item 9.17 full text:', text);
    console.log('Has marker token:', text.includes('(sn2n:'));
    console.log('Has children:', !!item917[item917.type].children);
    console.log('Children count:', item917[item917.type].children ? item917[item917.type].children.length : 0);
  }
})();
