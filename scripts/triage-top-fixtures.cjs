#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/validation-issues');
const outPath = path.join(fixturesDir, 'triage-top-10.json');

// Reuse converters/validators from the repo (these modules expect to be run in repo root)
const { extractContentFromHtml } = require(path.join(repoRoot, 'server/services/servicenow.cjs'));
const { extractPlainTextFromHtml, normalizeText, calculateSimilarity } = require(path.join(repoRoot, 'server/services/content-validator.cjs'));

function listJsons() {
  try {
    return fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json')).map(f => path.join(fixturesDir, f));
  } catch (e) {
    console.error('Failed to list fixtures:', e.message);
    process.exit(1);
  }
}

function loadSidecar(jsonPath) {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const data = JSON.parse(raw);
  const htmlPath = path.join(fixturesDir, path.basename(jsonPath).replace(/\.json$/, '.html'));
  const html = fs.readFileSync(htmlPath, 'utf8');
  return { data, html, htmlPath };
}

function detectHtmlTags(html) {
  const hasTable = /<table\b/i.test(html);
  const hasUl = /<ul\b/i.test(html);
  const hasOl = /<ol\b/i.test(html);
  const hasCallout = /(class=("|')[^"']*(note|callout|warning|info|tip|caution)[^"']*("|'))/i.test(html);
  const marker = /(\(sn2n:[a-z0-9\-]+\))/i.test(html);
  return { hasTable, hasUl, hasOl, hasCallout, marker };
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

function hasMarkerLeakInBlocks(blocks) {
  const markerRe = /\(sn2n:[a-z0-9\-]+\)/i;
  let leaked = false;
  function textFromRich(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.map(rt => rt.plain_text || (rt.text && rt.text.content) || '').join('');
  }
  function walk(arr) {
    if (!Array.isArray(arr) || leaked) return;
    for (const block of arr) {
      if (!block || typeof block !== 'object') continue;
      const type = block.type;
      const data = block[type] || {};
      const chunks = [textFromRich(data.rich_text), textFromRich(data.title), textFromRich(data.caption)];
      if (chunks.some(t => markerRe.test(t || ''))) {
        leaked = true;
        return;
      }
      if (Array.isArray(block.children)) walk(block.children);
      if (data && Array.isArray(data.children)) walk(data.children);
    }
  }
  walk(blocks);
  return leaked;
}

async function run() {
  const jsons = listJsons();
  if (!jsons.length) {
    console.log('No fixtures found. Run: npm run harvest:fixtures');
    return process.exit(0);
  }

  const results = [];
  for (const j of jsons) {
    try {
      const { data, html } = loadSidecar(j);
      const name = path.basename(j).replace(/\.json$/, '');
      // Convert
      const extract = await extractContentFromHtml(html);
      const blocks = extract && extract.blocks ? extract.blocks : [];
      const htmlSegments = extractPlainTextFromHtml(html).map(normalizeText).filter(Boolean);
      const notionSegments = extractTextFromBlocksLocal(blocks).map(normalizeText).filter(Boolean);
      const similarity = calculateSimilarity(htmlSegments, notionSegments);
      const markerLeak = hasMarkerLeakInBlocks(blocks);
      const tags = detectHtmlTags(html);
      results.push({ name, title: data.title || name, similarity: parseFloat(similarity.toFixed(1)), htmlSegments: htmlSegments.length, notionSegments: notionSegments.length, markerLeak, tags });
    } catch (e) {
      results.push({ name: path.basename(j).replace(/\.json$/, ''), title: path.basename(j), error: e.message });
    }
  }

  results.sort((a,b) => {
    if (a.error && !b.error) return 1;
    if (b.error && !a.error) return -1;
    return (a.similarity || 0) - (b.similarity || 0);
  });

  const top10 = results.slice(0, 10);
  fs.writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), total: results.length, top: top10, all: results }, null, 2));
  console.log(`Wrote triage report: ${outPath}`);
  for (const r of top10) {
    console.log(`${r.name} → similarity: ${r.similarity || 'ERR'} | htmlSegs:${r.htmlSegments || '-'} notionSegs:${r.notionSegments || '-'} markerLeak:${r.markerLeak ? 'YES' : 'NO'} tags:${JSON.stringify(r.tags)}`);
  }
}

run().catch(err => {
  console.error('Triage failed:', err);
  process.exit(1);
});
