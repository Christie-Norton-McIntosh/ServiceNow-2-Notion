#!/usr/bin/env node
/**
 * Clear parent page by PATCHing with minimal intro content (just title).
 * This uses the existing PATCH endpoint which deletes all blocks and uploads new ones.
 */
const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';

async function httpRequest(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`${options.method || 'POST'} ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  console.log(`[clear] Clearing page ${PARENT_PAGE_ID} via PATCH with empty content...`);
  
  // PATCH with a simple placeholder paragraph
  const result = await httpRequest(`${API_BASE}/W2N/${PARENT_PAGE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Generic policies in DevOps Config',
      contentHtml: '<p>Preparing content...</p>',
      url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/devops-config/reference/devops-config-gen-policies.html'
    })
  });

  console.log('[clear] ✅ Page cleared:', result.success ? 'success' : 'failed');
  if (result.data) {
    console.log('  Page URL:', result.data.pageUrl || result.data.url);
  }
}

main().catch(err => {
  console.error('[clear] Failed:', err && err.stack || err);
  process.exit(1);
});
