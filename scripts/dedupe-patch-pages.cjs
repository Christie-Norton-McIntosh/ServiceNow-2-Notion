#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PATCH_DIR = path.join(ROOT, 'patch', 'pages');
const ARCHIVE_DIR = path.join(PATCH_DIR, 'duplicates-archived');

function findHtmlFiles(dir) {
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (path.basename(full) === 'duplicates-archived') continue;
      results.push(...findHtmlFiles(full));
    } else if (/\.html$/i.test(name)) {
      results.push(full);
    }
  }
  return results;
}

function slugKeyFromFilename(filename) {
  // Split at first occurrence of -20YY- (e.g., -2025-) to derive the base slug
  const base = path.basename(filename);
  const m = base.match(/^(.*?)-20\d{2}-/);
  if (m) return m[1];
  // Fallback: strip trailing timestamp-like segments
  return base.replace(/-patch.*$/i, '').replace(/\.html$/i, '');
}

function latestTimestampFromFilename(filename) {
  const base = path.basename(filename);
  // find all occurrences like 2025-11-27t13-31-26 or 2025-11-27T13-31-26
  const re = /(\d{4}-\d{2}-\d{2}[tT]\d{2}-\d{2}-\d{2})/g;
  const matches = [...base.matchAll(re)].map(m => m[1]);
  if (matches.length === 0) {
    const stat = fs.statSync(filename);
    return stat.mtime.getTime();
  }
  // convert to JS time
  const times = matches.map(ts => {
    const parts = ts.split(/[tT]/);
    const date = parts[0];
    const time = parts[1].split('-').join(':');
    const iso = `${date}T${time}`;
    return Date.parse(iso);
  }).filter(Boolean);
  return Math.max(...times);
}

function ensureArchiveDir() {
  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

(function main(){
  console.log('Scanning patch pages for duplicates...');
  const files = findHtmlFiles(PATCH_DIR);
  const groups = new Map();
  for (const f of files) {
    const key = slugKeyFromFilename(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  ensureArchiveDir();
  let moved = 0;
  for (const [key, items] of groups.entries()) {
    if (items.length <= 1) continue;
    // pick latest
    items.sort((a,b) => latestTimestampFromFilename(b) - latestTimestampFromFilename(a));
    const keep = items[0];
    const remove = items.slice(1);
    console.log(`Keeping latest for ${key}: ${path.basename(keep)}; archiving ${remove.length} older file(s)`);
    for (const r of remove) {
      const dest = path.join(ARCHIVE_DIR, path.basename(r));
      fs.renameSync(r, dest);
      moved++;
    }
  }
  console.log(`Done. Moved ${moved} duplicate file(s) to ${ARCHIVE_DIR}`);
})();
