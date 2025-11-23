#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html';
const htmlContent = fs.readFileSync(htmlFile, 'utf8');

const payload = {
  databaseId: '2b2a89fe-dba5-8044-a4ec-c4492c4cc2ff',
  title: 'Test depth logging - CMDB Query Builder',
  contentHtml: htmlContent,
  url: 'https://docs.servicenow.com/bundle/xanadu-platform-administration/page/administer/managing-data/task/t_BuildQueryUsingQueryBuilder.html',
  // dryRun: true  // FIX: Enable dry run to inspect payload structure
};

fetch('http://localhost:3004/api/W2N', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(res => res.json())
.then(data => {
  console.log('Result:', JSON.stringify(data, null, 2));
})
.catch(err => {
  console.error('Error:', err.message);
});
