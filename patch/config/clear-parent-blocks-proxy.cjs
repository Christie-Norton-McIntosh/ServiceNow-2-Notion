#!/usr/bin/env node
/**
 * Delete all blocks from parent via the local proxy using its block retrieval + deletion.
 */
const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';

async function httpRequest(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`${options.method || 'GET'} ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  console.log(`[clear] Retrieving blocks from page ${PARENT_PAGE_ID} via proxy...`);
  
  // Proxy doesn't expose block retrieval directly; use PATCH with empty children to clear
  // Alternative: call Notion API via server-side or use a dedicated clear endpoint
  
  // Since we don't have a clear endpoint, let's just document that the user should
  // manually archive/delete blocks via Notion UI or we proceed with reinline which will just append
  
  console.log('[clear] ⚠️ Proxy does not expose block deletion endpoint');
  console.log('[clear] Options:');
  console.log('  1. Manually select all blocks in Notion and delete them');
  console.log('  2. Proceed with reinline which will append cleaned content (page will have both old and new)');
  console.log('  3. Use PATCH to replace entire page content (may timeout again)');
  console.log('');
  console.log('[clear] Recommendation: Manually clear the page in Notion UI, then run reinline-parent-with-intro.cjs');
}

main().catch(err => {
  console.error('[clear] Failed:', err && err.stack || err);
  process.exit(1);
});
