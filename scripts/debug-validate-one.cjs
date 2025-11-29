#!/usr/bin/env node
// Quick debug runner: validate a single fixture from tests/fixtures/validation-issues
const fs = require('fs');
const path = require('path');
const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/validation-issues');

const name = process.argv[2];
if (!name) {
  console.error('Usage: node scripts/debug-validate-one.cjs <fixture-base-or-json-file>');
  process.exit(2);
}

let jsonPath = name.endsWith('.json') ? path.join(fixturesDir, name) : path.join(fixturesDir, `${name}.json`);
if (!fs.existsSync(jsonPath)) {
  // try to find by prefix
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

// Stubs same as test harness
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
    return {
      object: 'block', type: 'image', image: { type: 'external', external: { url: src }, caption: alt ? [{ type: 'text', text: { content: alt } }] : [] }
    };
  };
}
if (!global.downloadAndUploadImage) {
  global.downloadAndUploadImage = async function downloadAndUploadImage(imageUrl) { if (!imageUrl) return null; return 'mock-upload-id'; };
}

const { extractContentFromHtml } = require(path.join(repoRoot, 'server/services/servicenow.cjs'));
const { extractPlainTextFromHtml, normalizeText, calculateSimilarity } = require(path.join(repoRoot, 'server/services/content-validator.cjs'));

(async function run() {
  console.log('Running debug for', path.basename(jsonPath));
  const result = await extractContentFromHtml(html);
  const blocks = result && result.blocks ? result.blocks : [];

  const htmlSegments = extractPlainTextFromHtml(html).map(normalizeText).filter(Boolean);
  function extractTextFromBlocksLocal(blocks) {
    const segments = [];
    function textFromRich(arr) {
      if (!Array.isArray(arr) || arr.length === 0) return '';
      return arr.map(rt => rt.plain_text || (rt.text && rt.text.content) || '').join('').trim();
    }
    function walk(arr) {
      if (!Array.isArray(arr)) return;
      for (const block of arr) {
        if (!block || typeof block !== 'object') continue;
        const type = block.type;
        const data = block[type] || {};
        const candidates = [data.rich_text, data.title, data.caption];
        for (const c of candidates) {
          if (Array.isArray(c) && c.length > 1) {
            for (const rt of c) {
              const single = textFromRich([rt]); if (single) segments.push(single);
            }
          } else {
            const t = textFromRich(c); if (t) segments.push(t);
          }
        }
        if (type === 'table_row' && Array.isArray(data.cells)) {
          for (const cell of data.cells) {
            const t = textFromRich(cell); if (t) segments.push(t);
          }
        }
        if (Array.isArray(block.children)) walk(block.children);
        if (data && Array.isArray(data.children)) walk(data.children);
      }
    }
    walk(blocks);
    return segments;
  }

  const notionSegments = extractTextFromBlocksLocal(blocks).map(normalizeText).filter(Boolean);
  const similarity = calculateSimilarity(htmlSegments, notionSegments);

  console.log('\n--- Summary ---');
  console.log('HTML segments count:', htmlSegments.length);
  console.log('Notion segments count:', notionSegments.length);
  console.log('Similarity:', similarity.toFixed(1) + '%');

  console.log('\n--- HTML segments (first 20) ---');
  htmlSegments.slice(0, 20).forEach((s, i) => console.log(String(i+1).padStart(2)+'.', s.slice(0,200)));

  console.log('\n--- Notion segments (first 40) ---');
  notionSegments.slice(0, 40).forEach((s, i) => console.log(String(i+1).padStart(2)+'.', s.slice(0,200)));

  console.log('\n--- Blocks (top-level) ---');
  console.log(JSON.stringify(blocks.slice(0,20), null, 2));

  const tableBlocks = [];
  function collectTables(arr) {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'table') tableBlocks.push(b);
      const data = b[b.type] || {};
      if (Array.isArray(b.children)) collectTables(b.children);
      if (data && Array.isArray(data.children)) collectTables(data.children);
    }
  }
  collectTables(blocks);
  console.log('\n--- Table blocks found: ' + tableBlocks.length + ' ---');
  tableBlocks.forEach((t, i) => {
    console.log('\n--- Table #' + (i+1) + ' ---');
    console.log(JSON.stringify(t, null, 2));
  });

  // Compute differences between HTML and Notion segments
  function diffArrays(a, b) {
    const setB = new Set(b);
    const missing = a.filter(x => !setB.has(x));
    return missing;
  }
  const missingInNotion = diffArrays(htmlSegments, notionSegments);
  const extraInNotion = diffArrays(notionSegments, htmlSegments);
  console.log('\n--- Missing in Notion (count ' + missingInNotion.length + ') ---');
  missingInNotion.slice(0, 20).forEach((s, i) => console.log(String(i+1).padStart(2)+'.', s.slice(0,200)));
  console.log('\n--- Extra in Notion (count ' + extraInNotion.length + ') ---');
  extraInNotion.slice(0, 40).forEach((s, i) => console.log(String(i+1).padStart(2)+'.', s.slice(0,200)));

  // Dump full blocks to tmp for deeper analysis
  const outPath = path.join('/tmp', path.basename(jsonPath).replace(/\.json$/, '.blocks.json'));
  fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2), 'utf8');
  console.log('\nFull blocks written to', outPath);
})();
