#!/usr/bin/env node
/**
 * Extract intro paragraphs from original HTML (shortdesc + Important callout + note),
 * strip miniTOC/related content from all split files,
 * prepend intro to parent,
 * then re-inline cleaned sections.
 */
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';
const ORIG_FILE = path.join(__dirname, '..', 'pages-to-update', 'problematic-files', 'generic-policies-in-devops-config-2025-11-11T10-02-11.html');
const SRC_DIR = path.join(__dirname, '..', 'pages-to-update', 'updated-pages');
const LOG_DIR = path.join(__dirname, '..', 'pages-to-update', 'log');

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

function extractIntroHtml(origHtml) {
  // Extract everything from shortdesc through the end of section_jrm_r1q_wqb (before section __a)
  const introMatch = origHtml.match(/<p class="shortdesc">[\s\S]*?<\/section>\s*<section class="section" id="devops-config-gen-policies__a">/i);
  if (!introMatch) return '';
  const rawIntro = introMatch[0].replace(/<section class="section" id="devops-config-gen-policies__a">/i, '');
  
  // Wrap in proper document structure that the server expects
  return `<div class="zDocsTopicPageBody"><div dir="ltr" class="zDocsTopicPageBodyContent"><div><article><main role="main"><article role="article" class="dita"><div class="body refbody">${rawIntro}</div></article></main></article></div></div></div>`;
}

function stripMiniTocAndRelated(html) {
  // Remove contentPlaceholder divs (contains "On this page" miniTOC + related content sidebar)
  // This regex handles nested divs and captures everything from contentPlaceholder to the end
  let cleaned = html.replace(/<div class="contentPlaceholder"[\s\S]*$/i, '');
  
  // Also strip any trailing empty divs that might be left
  cleaned = cleaned.replace(/(<\/div>\s*)+$/i, match => {
    // Keep only the closing tags that are part of the actual content structure
    return '</div></div></div>';
  });
  
  return cleaned;
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
  const resultsPath = path.join(LOG_DIR, `reinline-parent-${ts}.json`);

  const origHtml = fs.readFileSync(ORIG_FILE, 'utf8');
  const introHtml = extractIntroHtml(origHtml);

  console.log(`[reinline] Extracted intro HTML (${introHtml.length} chars)`);

  // Convert intro to blocks
  let introBlocks = [];
  try {
    console.log('[reinline] Converting intro to blocks via dryRun...');
    const dry = await httpPostJson(`${API_BASE}/W2N`, { title: 'Generic policies in DevOps Config', databaseId: 'ignore', contentHtml: introHtml, url: '', dryRun: true });
    console.log('[reinline] dryRun response:', JSON.stringify(dry, null, 2).substring(0, 500));
    introBlocks = (dry && dry.data && dry.data.children) || dry.children || [];
    console.log(`[reinline] Intro blocks: ${introBlocks.length}`);
    if (introBlocks.length === 0) {
      console.error('[reinline] Warning: No intro blocks generated. Response:', JSON.stringify(dry, null, 2));
    }
  } catch (err) {
    console.error('[reinline] Failed to convert intro:', err.message);
    process.exit(1);
  }

  // Append intro to parent
  try {
    const appendRes = await httpPostJson(`${API_BASE}/blocks/append`, { blockId: PARENT_PAGE_ID, children: introBlocks });
    console.log(`[reinline] Appended intro: ${(appendRes.data && appendRes.data.appended) || appendRes.appended || 0} blocks`);
  } catch (err) {
    console.error('[reinline] Failed to append intro:', err.message);
    process.exit(1);
  }

  // Process split files
  const files = fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('-2025-11-16T03-57-24.html'))
    .map(f => ({ file: f, meta: extractMeta(path.join(SRC_DIR, f)) }))
    .sort((a,b) => a.meta.sectionIndex - b.meta.sectionIndex);

  if (files.length === 0) {
    console.log(`[reinline] No files found in ${SRC_DIR}`);
    process.exit(0);
  }

  console.log(`[reinline] Processing ${files.length} sections`);

  const results = { parentPageId: PARENT_PAGE_ID, total: files.length, items: [] };

  for (const { file, meta } of files) {
    const fullPath = path.join(SRC_DIR, file);
    let html = fs.readFileSync(fullPath, 'utf8');
    html = stripMiniTocAndRelated(html);

    process.stdout.write(`[reinline] Converting: ${meta.sectionIndex}/${meta.sectionTotal} ${meta.title}\n`);

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

    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`[reinline] Wrote ${resultsPath}`);
}

main().catch(err => { console.error('[reinline] Failed:', err && err.stack || err); process.exit(1); });
