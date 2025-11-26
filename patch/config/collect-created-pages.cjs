#!/usr/bin/env node
/**
 * Collect created Notion pages from the target database that match the split file titles.
 * This avoids re-creating duplicates when a prior create run succeeded but the client didn't capture IDs.
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const DB_ID = process.env.SN2N_DB_ID || '282a89fedba5815e91f0db972912ef9f';
const SRC_DIR = path.join(__dirname, '..', 'pages-to-update');
const DEST_DIR = path.join(SRC_DIR, 'updated-pages');
const LOG_DIR = path.join(SRC_DIR, 'log');
const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RESULTS_JSON = path.join(LOG_DIR, `collected-pages-${TS}.json`);

function readFirstLines(filePath, maxLines = 50) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 64 * 1024); // read up to 64KB
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, 0);
    const head = buffer.toString('utf8');
    return head.split(/\r?\n/).slice(0, maxLines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

function extractMeta(filePath) {
  const head = readFirstLines(filePath, 60);
  const titleMatch = head.match(/^\s*Page:\s*(.+)$/m);
  const urlMatch = head.match(/^\s*URL:\s*(.+)$/m);
  return {
    title: titleMatch ? titleMatch[1].trim() : 'Untitled',
    url: urlMatch ? urlMatch[1].trim() : ''
  };
}

async function httpGetJson(url) {
  const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function httpPostJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    // Node < 18 fallback
    global.fetch = (await import('node-fetch')).default;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(DEST_DIR, { recursive: true });

  // files created by split script (hardcoded suffix for this run)
  const files = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('-2025-11-16T03-57-24.html'))
    .sort();
  if (files.length === 0) {
    console.log(`[collect] No files found in ${SRC_DIR}`);
    process.exit(0);
  }
  console.log(`[collect] Files: ${files.length}`);

  // get database schema to find title property name
  const dbInfo = await httpGetJson(`${API_BASE}/databases/${DB_ID}`);
  const schema = dbInfo && dbInfo.data && dbInfo.data.schema || {};
  const titlePropName = Object.entries(schema).find(([name, def]) => def && def.type === 'title')?.[0] || 'Name';
  console.log(`[collect] Title property: ${titlePropName}`);

  const results = {
    collectedAt: new Date().toISOString(),
    databaseId: DB_ID,
    totalFiles: files.length,
    titleProperty: titlePropName,
    items: []
  };

  for (const file of files) {
    const filePath = path.join(SRC_DIR, file);
    const { title, url } = extractMeta(filePath);
    process.stdout.write(`[collect] Query: ${title}\n`);

    try {
      const queryBody = {
        filter: {
          property: titlePropName,
          title: { equals: title }
        },
        sorts: [ { timestamp: 'last_edited_time', direction: 'descending' } ],
        page_size: 1
      };
      const qres = await httpPostJson(`${API_BASE}/databases/${DB_ID}/query`, queryBody);
      const result = (qres && qres.results && qres.results[0]) || null;
      if (result) {
        const pageId = result.id;
        const pageUrl = result.url || null;
        results.items.push({ file, title, url, pageId, pageUrl, status: 'found' });
        // Move file to updated-pages to mark as resolved
        try { fs.renameSync(filePath, path.join(DEST_DIR, file)); } catch (_) {}
      } else {
        results.items.push({ file, title, url, pageId: null, pageUrl: null, status: 'missing' });
      }
      // Small delay to be nice
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      results.items.push({ file, title, url, pageId: null, pageUrl: null, status: 'error', error: String(err && err.message || err) });
    }
  }

  fs.writeFileSync(RESULTS_JSON, JSON.stringify(results, null, 2));
  console.log(`[collect] Wrote ${RESULTS_JSON}`);
}

main().catch(err => {
  console.error('[collect] Failed:', err && err.stack || err);
  process.exit(1);
});
