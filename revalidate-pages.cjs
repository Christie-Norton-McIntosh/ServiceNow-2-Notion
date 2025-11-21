const http = require('http');

const pages = [
  { title: 'MID Server properties', id: '2b1a89fedba58105aa9fe2d5016a6904' },
  { title: 'MID Server parameters', id: '2b1a89fedba58103890ed1d72c7d9149' },
  { title: 'Install and uninstall Nmap on a MID Server', id: '2b1a89fedba5819b87fbf86f4dfde748' },
  { title: 'Install a MID Server on Windows', id: '2b1a89fedba58115b943c01486641932' },
  { title: 'Exploring Entity View Action Mapper', id: '2b1a89fedba5811d82f8edd6bbb89336' },
  { title: 'CMDB classes targeted in Service Graph Connector for Observability - Datadog', id: '2b1a89fedba581e49003ec41bb129de6' },
  { title: 'CMDB classes targeted in Service Graph Connector for Microsoft Azure', id: '2b1a89fedba581b4b716db520bc5061b' },
  { title: 'Attach a script file to a file synchronized MID Server', id: '2b1a89fedba581179c9ddaf1dc3e6c79' }
];

function validatePage(page) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      pageId: page.id,
      dryRun: false
    });

    const options = {
      hostname: 'localhost',
      port: 3004,
      path: `/api/W2N/${page.id}/validate`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            title: page.title,
            id: page.id,
            status: res.statusCode,
            response: response
          });
        } catch (err) {
          resolve({
            title: page.title,
            id: page.id,
            status: res.statusCode,
            error: err.message,
            body: data.substring(0, 200)
          });
        }
      });
    });

    req.on('error', (e) => {
      resolve({
        title: page.title,
        id: page.id,
        error: e.message
      });
    });

    req.write(payload);
    req.end();
  });
}

async function validateAll() {
  console.log('🔍 Revalidating 8 pages...\n');
  
  const results = [];
  let completed = 0;
  
  for (const page of pages) {
    const result = await validatePage(page);
    results.push(result);
    completed++;
    
    console.log(`[${completed}/8] ${result.title}`);
    console.log(`  Page ID: ${result.id}`);
    
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    } else if (result.status === 200) {
      const hasErrors = result.response.hasErrors;
      const issues = result.response.issues || [];
      const warnings = result.response.warnings || [];
      
      if (hasErrors) {
        console.log(`  ❌ Validation FAILED`);
        issues.forEach(issue => console.log(`     - ${issue}`));
      } else if (warnings.length > 0) {
        console.log(`  ⚠️  Validation PASSED with warnings`);
        warnings.forEach(warning => console.log(`     - ${warning}`));
      } else {
        console.log(`  ✅ Validation PASSED`);
      }
      
      // Show stats if available
      if (result.response.stats) {
        const stats = result.response.stats;
        const tables = stats.blockTypes?.table || 0;
        const images = stats.blockTypes?.image || 0;
        const callouts = stats.blockTypes?.callout || 0;
        console.log(`     Blocks: ${stats.totalBlocks}, Tables: ${tables}, Images: ${images}, Callouts: ${callouts}`);
      }
    } else {
      console.log(`  ❌ HTTP ${result.status}`);
      if (result.body) {
        console.log(`     ${result.body}`);
      }
    }
    console.log('');
  }
  
  // Summary
  const passed = results.filter(r => !r.error && r.status === 200 && !r.response.hasErrors).length;
  const warned = results.filter(r => !r.error && r.status === 200 && !r.response.hasErrors && r.response.warnings?.length > 0).length;
  const failed = results.filter(r => r.error || r.status !== 200 || r.response.hasErrors).length;
  
  console.log('\n📊 Summary:');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ⚠️  Warnings: ${warned}`);
  console.log(`  ❌ Failed: ${failed}`);
}

validateAll().catch(console.error);
