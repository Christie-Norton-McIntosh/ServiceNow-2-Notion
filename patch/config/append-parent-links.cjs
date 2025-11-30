#!/usr/bin/env node
/**
 * Append link_to_page blocks to the original parent page, using collected child page IDs.
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';
const LOG_DIR = path.join(__dirname, '..', 'pages-to-update', 'log');

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

function findLatestCollectedJson(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => /^collected-pages-\d{4}-\d{2}-\d{2}T/.test(f))
    .sort();
  if (files.length === 0) return null;
  return path.join(dir, files[files.length - 1]);
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  const latest = findLatestCollectedJson(LOG_DIR);
  if (!latest) {
    console.error('[append] No collected-pages-*.json found');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(latest, 'utf8'));
  const items = (data.items || []).filter(it => it.status === 'found' && it.pageId);
  if (items.length === 0) {
    console.error('[append] No found items in', latest);
    process.exit(1);
  }
  console.log(`[append] Using ${latest}, ${items.length} items`);

  const children = [];
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: 'Sections' } }] }
  });

  for (const it of items) {
    children.push({
      object: 'block',
      type: 'link_to_page',
      link_to_page: { page_id: it.pageId }
    });
  }

  // Notion cap is 100 per request; we have <= 44 including heading
  const body = { blockId: PARENT_PAGE_ID, children };
  const resp = await httpPostJson(`${API_BASE}/blocks/append`, body);
  console.log('[append] Append result:', resp);
}

main().catch(err => {
  console.error('[append] Failed:', err && err.stack || err);
  process.exit(1);
});
