#!/usr/bin/env node
// scripts/validate-order-fixtures.cjs
// Run the existing debug validator for each html fixture in the
// patch/pages/validation-order-issues folder and produce a report

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const FIXTURE_DIR = path.resolve(__dirname, '..', 'patch', 'pages', 'validation-order-issues');
const REPORT_JSON = '/tmp/validation-order-issues-report.json';
const REPORT_MD = '/tmp/validation-order-issues-report.md';

function runFixture(file) {
  return new Promise(async (resolve) => {
    const fixtureName = path.basename(file, path.extname(file));
    console.log(`\n=== Running fixture: ${fixtureName}`);
    const htmlPath = path.join(FIXTURE_DIR, file);
    const html = fs.readFileSync(htmlPath, 'utf8');

    // require converter + validator functions directly
    const repoRoot = path.resolve(__dirname, '..');
    const { extractContentFromHtml } = require(path.join(repoRoot, 'server/services/servicenow.cjs'));
    const { extractPlainTextFromHtml, normalizeText, calculateSimilarity } = require(path.join(repoRoot, 'server/services/content-validator.cjs'));

    // Ensure the same global stubs used by the test harness are available
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

    // Run conversion
    let resultBlocks = [];
    try {
      const res = await extractContentFromHtml(html);
      resultBlocks = res && res.blocks ? res.blocks : [];
    } catch (e) {
      console.error('Error extracting content for', fixtureName, e);
    }

    // Extract segments
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

    const notionSegments = extractTextFromBlocksLocal(resultBlocks).map(normalizeText).filter(Boolean);
    const similarity = calculateSimilarity(htmlSegments, notionSegments);

    const out = [];
    out.push('\n--- Summary ---');
    out.push('HTML segments count: ' + htmlSegments.length);
    out.push('Notion segments count: ' + notionSegments.length);
    out.push('Similarity: ' + similarity.toFixed(1) + '%');

    const result = { fixture: fixtureName, htmlSegments: htmlSegments.length, notionSegments: notionSegments.length, similarity, htmlList: htmlSegments, notionList: notionSegments, blocks: resultBlocks };

    // dump blocks to tmp for later inspection
    const outPath = path.join('/tmp', `${fixtureName}.blocks.json`);
    try { fs.writeFileSync(outPath, JSON.stringify(resultBlocks, null, 2), 'utf8'); } catch (e) { /* ignore */ }

    // analyze duplicates in notionList
    result.duplicates = [];
    if (result.notionList && result.notionList.length) {
      const norm = result.notionList.map(s => s.replace(/\s+/g,' ').trim().toLowerCase());
      const counts = {};
      norm.forEach((s, i) => { counts[s] = counts[s] || []; counts[s].push(i); });
      for (const k of Object.keys(counts)) {
        if (counts[k].length > 1) result.duplicates.push({text: k, indexes: counts[k], count: counts[k].length});
      }
    }

    // analyze multi-type appearances (same text in paragraph and table cells)
    result.multiType = [];
    if (result.blocks && Array.isArray(result.blocks)) {
      const map = new Map();
      for (const b of result.blocks) {
        const type = b.type || 'unknown';
        let texts = [];
        try {
          if (b[type] && b[type].rich_text) {
            texts = b[type].rich_text.map(rt => (rt.text && rt.text.content) ? rt.text.content.replace(/\s+/g,' ').trim() : '').filter(Boolean);
          }
          if (type === 'table') {
            if (b.table && Array.isArray(b.table.children)) {
              for (const row of b.table.children) {
                if (row.table_row && Array.isArray(row.table_row.cells)) {
                  for (const cell of row.table_row.cells) {
                    for (const cellRt of cell.rich_text || []) {
                      const c = (cellRt.text && cellRt.text.content) ? cellRt.text.content.replace(/\s+/g,' ').trim() : '';
                      if (c) texts.push(c);
                    }
                  }
                }
              }
            }
          }
        } catch (e) {}
        for (const t of texts) {
          const key = t.toLowerCase();
          if (!map.has(key)) map.set(key, new Set());
          map.get(key).add(type);
        }
      }
      for (const [k, types] of map.entries()) {
        if (types.size > 1) result.multiType.push({text: k, types: Array.from(types)});
      }
    }

    // order analysis
    result.orderIssues = [];
    if (Array.isArray(result.htmlList) && Array.isArray(result.notionList)) {
      const normNotion = result.notionList.map(s => s.replace(/\s+/g,' ').trim().toLowerCase());
      let lastIdx = -1;
      result.htmlList.forEach((h, i) => {
        const key = h.replace(/\s+/g,' ').trim().toLowerCase();
        const idx = normNotion.indexOf(key);
        if (idx === -1) {
          result.orderIssues.push({htmlIndex: i, html: h, notionIndex: null});
        } else {
          if (idx < lastIdx) result.orderIssues.push({htmlIndex: i, html: h, notionIndex: idx, note: 'out-of-order'});
          lastIdx = idx;
        }
      });
    }

    resolve(result);
  });
}

(async function main() {
  const files = fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html'));
  const results = [];
  for (const f of files) {
    try {
      const r = await runFixture(f);
      results.push(r);
    } catch (e) {
      console.error('Error running fixture', f, e);
    }
  }

  fs.writeFileSync(REPORT_JSON, JSON.stringify(results, null, 2));

  // write a simple markdown report
  const md = [];
  md.push('# Validation Order Issues Report');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  for (const r of results) {
    md.push(`## ${r.fixture}`);
    md.push(`- similarity: ${r.similarity || 'N/A'}%`);
    md.push(`- html segments: ${r.htmlSegments || 0}`);
    md.push(`- notion segments: ${r.notionSegments || 0}`);
    md.push(`- duplicates found: ${r.duplicates.length || 0}`);
    if (r.duplicates.length) {
      md.push('  - duplicates (excerpt):');
      r.duplicates.slice(0,5).forEach(d => md.push(`    - "${d.text}" count=${d.count}`));
    }
    md.push(`- multi-type matches (same text in >1 block type): ${r.multiType.length || 0}`);
    if (r.multiType.length) {
      md.push('  - examples:');
      r.multiType.slice(0,5).forEach(m => md.push(`    - "${m.text}" types=${m.types.join(',')}`));
    }
    md.push(`- order issues: ${r.orderIssues.length || 0}`);
    if (r.orderIssues.length) {
      md.push('  - examples:');
      r.orderIssues.slice(0,5).forEach(o => md.push(`    - html[${o.htmlIndex}] => notion[${o.notionIndex}] ${o.note || ''}`));
    }
    md.push('');
  }

  fs.writeFileSync(REPORT_MD, md.join('\n'));
  console.log('\nReport written to:', REPORT_JSON, REPORT_MD);
})();
