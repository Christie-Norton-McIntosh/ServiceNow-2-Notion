#!/usr/bin/env node
/**
 * Inline split section HTML content directly into a parent Notion page.
 * Strategy: for each split HTML file (updated-pages/*-2025-11-16T03-57-24.html)
 * - POST /api/W2N with dryRun:true to convert HTML to children blocks
 * - Append the children to the parent via /api/blocks/append (server chunks at 100)
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';
const SRC_DIR = path.join(__dirname, '..', 'pages', 'updated-pages');
const LOG_DIR = path.join(__dirname, '..', 'logs');

function readFirstLines(filePath, maxLines = 60) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const size = Math.min(stat.size, 64 * 1024);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return buf.toString('utf8').split(/\r?\n/).slice(0, maxLines).join('\n');
  } finally {
    fs.closeSync(fd);
  }
}

function extractMeta(filePath) {
  const head = readFirstLines(filePath);
  const title = (head.match(/^\s*Page:\s*(.+)$/m) || [])[1] || 'Untitled';
  const url = (head.match(/^\s*URL:\s*(.+)$/m) || [])[1] || '';
  const sectionInfo = (head.match(/^\s*Section:\s*(\d+)\s+of\s+(\d+)/m) || []);
  const sectionIndex = sectionInfo[1] ? parseInt(sectionInfo[1], 10) : 9999;
  const sectionTotal = sectionInfo[2] ? parseInt(sectionInfo[2], 10) : null;
  return { title: title.trim(), url: url.trim(), sectionIndex, sectionTotal };
}

async function httpPostJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`POST ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0,19);
  const resultsPath = path.join(LOG_DIR, `inline-parent-${ts}.json`);

  const files = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('-2025-11-16T03-57-24.html'))
    .map(f => ({ file: f, meta: extractMeta(path.join(SRC_DIR, f)) }))
    .sort((a,b) => a.meta.sectionIndex - b.meta.sectionIndex);

  if (files.length === 0) {
    console.log(`[inline] No files found in ${SRC_DIR}`);
    process.exit(0);
  }

  console.log(`[inline] Appending ${files.length} sections to parent ${PARENT_PAGE_ID}`);

  const results = { parentPageId: PARENT_PAGE_ID, total: files.length, items: [] };

  for (const { file, meta } of files) {
    const fullPath = path.join(SRC_DIR, file);
    const html = fs.readFileSync(fullPath, 'utf8');
    process.stdout.write(`[inline] Converting (dryRun): ${meta.sectionIndex}/${meta.sectionTotal} ${meta.title}\n`);

    let dry;
    try {
      dry = await httpPostJson(`${API_BASE}/W2N`, { title: meta.title, databaseId: 'ignore', contentHtml: html, url: meta.url, dryRun: true });
    } catch (err) {
      results.items.push({ file, title: meta.title, section: meta.sectionIndex, status: 'dryRun-error', error: String(err.message || err) });
      continue;
    }

    const children = (dry && dry.data && dry.data.children) || dry.children || [];
    if (!Array.isArray(children) || children.length === 0) {
      results.items.push({ file, title: meta.title, section: meta.sectionIndex, status: 'no-children' });
      continue;
    }

    // Append to parent
    try {
      const appendRes = await httpPostJson(`${API_BASE}/blocks/append`, { blockId: PARENT_PAGE_ID, children });
      const appended = (appendRes && appendRes.data && appendRes.data.appended) || appendRes.appended || 0;
      results.items.push({ file, title: meta.title, section: meta.sectionIndex, status: 'appended', appended });
      console.log(`  ↳ appended: ${appended}`);
    } catch (err) {
      results.items.push({ file, title: meta.title, section: meta.sectionIndex, status: 'append-error', error: String(err.message || err) });
    }

    // small delay to be friendly
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`[inline] Wrote ${resultsPath}`);
}

main().catch(err => { console.error('[inline] Failed:', err && err.stack || err); process.exit(1); });
