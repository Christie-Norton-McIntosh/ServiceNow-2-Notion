#!/usr/bin/env node
// Verify Notion page IDs referenced in patch/pages/** and move 404 pages to patch/pages/page-not-found
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '..', 'server', '.env') });

const ROOT = path.resolve(__dirname, '..');
const PATCH_DIR = path.join(ROOT, 'patch', 'pages');
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = process.env.NOTION_VERSION || '2022-06-28';

if (!NOTION_TOKEN) {
  console.error('ERROR: NOTION_TOKEN not found in server/.env');
  process.exit(2);
}

function findHtmlFiles(dir) {
  const results = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...findHtmlFiles(full));
    } else if (/\.html$/i.test(name)) {
      results.push(full);
    }
  }
  return results;
}

const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const hex32Regex = /\b([0-9a-f]{32})\b/i;

async function checkPage(id) {
  const url = `https://api.notion.com/v1/pages/${id}`;
  try {
    const res = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
      },
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  } catch (err) {
    return { error: err.message };
  }
}

(async function main() {
  console.log('Scanning HTML files under', PATCH_DIR);
  const files = findHtmlFiles(PATCH_DIR);
  const idToFiles = new Map();

  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const ids = new Set();
    const m1 = text.match(uuidRegex);
    if (m1) ids.add(m1[0]);
    const m2 = text.match(hex32Regex);
    if (m2) {
      // normalize 32-hex to hyphenated form? Not necessary for Notion; Notion accepts both
      ids.add(m2[1]);
    }
    if (ids.size === 0) continue;
    for (const id of ids) {
      if (!idToFiles.has(id)) idToFiles.set(id, []);
      idToFiles.get(id).push(f);
    }
  }

  if (idToFiles.size === 0) {
    console.log('No page IDs found in HTML files under', PATCH_DIR);
    return;
  }

  console.log('Found', idToFiles.size, 'unique page IDs. Verifying via Notion API...');

  const pageNotFoundDir = path.join(PATCH_DIR, 'page-not-found');
  if (!fs.existsSync(pageNotFoundDir)) fs.mkdirSync(pageNotFoundDir, { recursive: true });

  for (const [id, filesForId] of idToFiles.entries()) {
    process.stdout.write(`Checking ${id} ... `);
    const result = await checkPage(id);
    if (result.error) {
      console.log('ERROR', result.error);
      continue;
    }
    if (result.status === 200) {
      console.log('FOUND (200)');
    } else if (result.status === 404) {
      console.log('NOT FOUND (404) — moving', filesForId.length, 'file(s)');
      for (const f of filesForId) {
        const dest = path.join(pageNotFoundDir, path.basename(f));
        fs.renameSync(f, dest);
      }
    } else {
      console.log('STATUS', result.status);
    }
  }

  console.log('Done.');
})();
