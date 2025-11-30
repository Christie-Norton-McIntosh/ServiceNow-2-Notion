#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/validation-issues');
const triagePath = path.join(fixturesDir, 'triage-top-10.json');

if (!fs.existsSync(triagePath)) {
  console.error('Triage top-10 report not found. Run: node scripts/triage-top-fixtures.cjs');
  process.exit(1);
}

const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
const top = triage.top || [];

const { extractContentFromHtml } = require(path.join(repoRoot, 'server/services/servicenow.cjs'));
const { extractPlainTextFromHtml, normalizeText } = require(path.join(repoRoot, 'server/services/content-validator.cjs'));

// Provide the same global stubs used by the test runner so this script
// can run headlessly without network or Notion client availability.
if (!global.isValidImageUrl) {
  global.isValidImageUrl = function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^(https?:\/\/|data:image\/)/i.test(url.trim());
  };
}

if (!global.isValidNotionUrl) {
  global.isValidNotionUrl = function isValidNotionUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/./i.test(url.trim());
  };
}

if (!global.createImageBlock) {
  global.createImageBlock = async function createImageBlock(src, alt = "") {
    if (!src || !global.isValidImageUrl(src)) return null;
    return {
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: src },
        caption: alt ? [{ type: "text", text: { content: alt } }] : [],
      },
    };
  };
}

if (!global.downloadAndUploadImage) {
  global.downloadAndUploadImage = async function downloadAndUploadImage(imageUrl) {
    if (!imageUrl || !global.isValidImageUrl(imageUrl)) return null;
    return "mock-upload-id";
  };
}

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
        const t = textFromRich(c);
        if (t) segments.push(t);
      }
      if (type === 'table_row' && Array.isArray(data.cells)) {
        for (const cell of data.cells) {
          const t = textFromRich(cell);
          if (t) segments.push(t);
        }
      }
      if (Array.isArray(block.children)) walk(block.children);
      if (data && Array.isArray(data.children)) walk(data.children);
    }
  }
  walk(blocks);
  return segments;
}

async function run() {
  for (const entry of top) {
    const name = entry.name;
    const jsonPath = path.join(fixturesDir, `${name}.json`);
    const htmlPath = path.join(fixturesDir, `${name}.html`);
    if (!fs.existsSync(jsonPath) || !fs.existsSync(htmlPath)) {
      console.warn(`Skipping ${name} - missing files`);
      continue;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    console.log(`Processing ${name} ...`);
    try {
      const extract = await extractContentFromHtml(html);
      const blocks = extract && extract.blocks ? extract.blocks : [];
      const rawBlocksPath = path.join(fixturesDir, `${name}.blocks.json`);
      fs.writeFileSync(rawBlocksPath, JSON.stringify(blocks, null, 2));

      const htmlSegments = extractPlainTextFromHtml(html).map(normalizeText).filter(Boolean);
      const notionSegments = extractTextFromBlocksLocal(blocks).map(normalizeText).filter(Boolean);

      const diff = {
        name,
        title: entry.title,
        similarity: entry.similarity,
        htmlSegmentsCount: htmlSegments.length,
        notionSegmentsCount: notionSegments.length,
        markerLeak: entry.markerLeak,
        tags: entry.tags,
        htmlFirst20: htmlSegments.slice(0,20),
        notionFirst20: notionSegments.slice(0,20),
      };
      const out = path.join(fixturesDir, `${name}.detail.json`);
      fs.writeFileSync(out, JSON.stringify(diff, null, 2));
      console.log(`  Wrote blocks -> ${rawBlocksPath}`);
      console.log(`  Wrote detail  -> ${out}`);
    } catch (e) {
      console.error(`  Error processing ${name}: ${e && e.message ? e.message : e}`);
    }
  }
  console.log('Done.');
}

run().catch(err => {
  console.error('Dump failed:', err);
  process.exit(1);
});
