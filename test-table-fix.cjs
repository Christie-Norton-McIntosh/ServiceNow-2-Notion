const fs = require('fs');
const http = require('http');

const html = fs.readFileSync('./patch/pages/pages-to-update/duplicate-cis-remediation-2025-11-19T08-56-28.html', 'utf8');
const payload = JSON.stringify({
  title: 'Test Duplicate CIs remediation',
  databaseId: 'test',
  contentHtml: html,
  dryRun: true
});

const options = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/W2N',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('Sending dry-run POST request...');

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      const json = response.data || response;
      const tables = json.children.filter(c => c.type === 'table');
      
      console.log('\n📊 Dry-run conversion results:');
      console.log('  Total blocks:', json.children.length);
      console.log('  Total tables:', tables.length);
      console.log('  Expected tables: 3');
      console.log('  Status:', tables.length === 3 ? '✅ FIXED!' : '❌ Still wrong');
      
      // Count blocks by type
      const typeCounts = {};
      json.children.forEach(c => {
        typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
      });
      console.log('\n  Block type counts:');
      Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`);
      });
    } catch (err) {
      console.error('Error parsing response:', err.message);
      console.log('Response:', data.substring(0, 500));
    }
  });
});

req.on('error', (e) => console.error('Request error:', e.message));
req.write(payload);
req.end();
