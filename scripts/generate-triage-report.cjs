#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'tests/fixtures/validation-issues');
const triagePath = path.join(fixturesDir, 'triage-top-10.json');
const outDir = path.join(repoRoot, 'triage');
const outPath = path.join(outDir, 'report-top-10.md');

if (!fs.existsSync(triagePath)) {
  console.error('Triage top-10 report not found. Run: node scripts/triage-top-fixtures.cjs');
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
const top = triage.top || [];

function safeLoadDetail(name) {
  const p = path.join(fixturesDir, `${name}.detail.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function suggestFix(entry, detail) {
  const tags = entry.tags || {};
  if (entry.error) return 'Conversion error during processing; inspect logs.';
  if (entry.markerLeak) return 'Marker leak detected — investigate marker collection/cleanup (collectAndStripMarkers / removeMarkerFromRichTextArray).';
  if (tags && tags.hasTable && entry.similarity < 96) return 'Table handling: converter sometimes splits a single table into multiple blocks (heading+table). Adjust table unwrapping/merging logic or preserve table as a single block.';
  if ((tags && (tags.hasOl || tags.hasUl)) && entry.similarity < 96) return 'List nesting/newline merging: ordered/unordered lists with nested blocks can deferral/reorder. Review enforceNestingDepthLimit and marker grouping rules for OL/UL items.';
  if (detail && detail.htmlFirst20 && detail.notionFirst20) {
    return 'Content mismatch: compare the first differing segments in the detail JSON to find the misaligned conversion (see detail file).';
  }
  return 'Review conversion output and validator diffs; flag as unknown root cause.';
}

let md = `# Validation Triage — Top 10 Failures\n\nGenerated: ${new Date().toISOString()}\n\n`;
md += `This report lists the top-10 fixtures with the lowest similarity and a concise suggested fix for each. Use the corresponding detail JSON and blocks JSON files in \`tests/fixtures/validation-issues/\` for deeper analysis.\n\n`;

top.forEach((entry, idx) => {
  const name = entry.name;
  const detail = safeLoadDetail(name);
  md += `## ${idx + 1}. ${entry.title || name}\n\n`;
  md += `- Fixture:\n  - name: \`${name}\`\n  - similarity: **${entry.similarity || 'ERR'}%**\n  - htmlSegments: ${entry.htmlSegments || '-'}\n  - notionSegments: ${entry.notionSegments || '-'}\n  - markerLeak: ${entry.markerLeak ? 'YES' : 'NO'}\n  - tags: ${entry.tags ? JSON.stringify(entry.tags) : 'N/A'}\n`;
  md += `\n- Suggested fix: ${suggestFix(entry, detail)}\n`;
  if (detail) {
    md += `\n- First HTML segments (up to 10):\n\n`;
    (detail.htmlFirst20 || []).slice(0,10).forEach(s => { md += `  - ${s}\n`; });
    md += `\n- First Notion segments (up to 10):\n\n`;
    (detail.notionFirst20 || []).slice(0,10).forEach(s => { md += `  - ${s}\n`; });
    md += '\n';
    md += `Detail JSON: \`tests/fixtures/validation-issues/${name}.detail.json\` and blocks: \`tests/fixtures/validation-issues/${name}.blocks.json\`\n`;
  }
  md += '\n---\n\n';
});

fs.writeFileSync(outPath, md);
console.log(`Wrote triage report: ${outPath}`);
