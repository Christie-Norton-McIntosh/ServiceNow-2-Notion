#!/usr/bin/env node
// Dump blocks for a fixture into repo tmp for inspection
const fs = require('fs');
const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/validation-issues');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/dump-blocks-to-workspace.cjs <fixture-base-or-json-file>');
  process.exit(2);
}

let jsonPath = name.endsWith('.json') ? path.join(fixturesDir, name) : path.join(fixturesDir, `${name}.json`);
if (!fs.existsSync(jsonPath)) {
  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json') && f.startsWith(name));
  if (files.length === 0) {
    console.error('Fixture not found:', name);
    process.exit(2);
  }
  jsonPath = path.join(fixturesDir, files[0]);
}

const raw = fs.readFileSync(jsonPath, 'utf8');
const sidecar = JSON.parse(raw);
const htmlPath = path.join(fixturesDir, path.basename(jsonPath).replace(/\.json$/, '.html'));
const html = fs.readFileSync(htmlPath, 'utf8');

if (!global.isValidImageUrl) {
  global.isValidImageUrl = function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^(https?:\/\/|data:image\/)/i.test(url.trim());
  };
}
if (!global.isValidNotionUrl) {
  global.isValidNotionUrl = function isValidNotionUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\//i.test(url.trim());
  };
}
if (!global.createImageBlock) {
  global.createImageBlock = async function createImageBlock(src, alt = '') {
    if (!src || !global.isValidImageUrl(src)) return null;
    return { object: 'block', type: 'image', image: { type: 'external', external: { url: src }, caption: alt ? [{ type: 'text', text: { content: alt } }] : [] } };
  };
}
if (!global.downloadAndUploadImage) {
  global.downloadAndUploadImage = async function downloadAndUploadImage(imageUrl) { if (!imageUrl) return null; return 'mock-upload-id'; };
}

const { extractContentFromHtml } = require(path.join(repoRoot, 'server/services/servicenow.cjs'));

(async function run() {
  console.log('Dumping blocks for', path.basename(jsonPath));
  const result = await extractContentFromHtml(html);
  const blocks = result && result.blocks ? result.blocks : [];
  const outDir = path.join(repoRoot, 'tmp');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, path.basename(jsonPath).replace(/\.json$/, '.blocks.json'));
  fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2), 'utf8');
  console.log('Wrote', outPath);
})();
