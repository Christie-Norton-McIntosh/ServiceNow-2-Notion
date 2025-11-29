#!/usr/bin/env node
/*
Harvest validation issue HTML files into test fixtures with JSON sidecars.
Monitors both:
 - patch/pages/validation-order-issues
 - patch/pages/pages-to-update

Outputs to:
 - tests/fixtures/validation-issues/{slug}.html
 - tests/fixtures/validation-issues/{slug}.json

Usage:
  node scripts/harvest-validation-fixtures.cjs [--dry-run]
  node scripts/harvest-validation-fixtures.cjs --limit 20

The JSON sidecar uses a simple taxonomy and is prefilled via heuristics; edit as needed.
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const sources = [
  path.join(repoRoot, 'patch/pages/validation-order-issues'),
  path.join(repoRoot, 'patch/pages/pages-to-update'),
];
const outDir = path.join(repoRoot, 'tests/fixtures/validation-issues');

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function toSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 80);
}

function hashShort(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function detectTags(html) {
  const tags = {
    context: 'mixed',
    content: [],
    depth: 1,
    symptoms: [],
    notes: '',
  };
  const has = (re) => re.test(html);
  const count = (re) => (html.match(re) || []).length;

  const ul = has(/<ul[\s>]/i);
  const ol = has(/<ol[\s>]/i);
  if (ul && !ol) tags.context = 'ul';
  else if (ol && !ul) tags.context = 'ol';
  else if (!ul && !ol) tags.context = 'paragraph';

  if (has(/<table[\s>]/i)) tags.content.push('table');
  if (has(/<img[\s>]/i) || has(/<figure[\s>]/i)) tags.content.push('image');
  if (has(/<pre[\s>]/i) || has(/<code[\s>]/i)) tags.content.push('code');
  if (has(/class=["'][^"']*note[^"']*["']/i) || has(/role=["']note["']/i) || has(/<aside/i)) tags.content.push('callout');

  const nestedCount = count(/<ol[\s>][\s\S]*?<ol[\s>]/gi) + count(/<ul[\s>][\s\S]*?<ul[\s>]/gi);
  tags.depth = nestedCount > 0 ? 2 : 1;

  // Symptoms: infer from embedded validation comments or structural hints
  if (has(/Order Issues:/i) || has(/order issues/i)) tags.symptoms.push('order-inversions');
  if (has(/Missing Segments:/i) || has(/missing callout/i)) tags.symptoms.push('missing-callouts');
  if (has(/\(sn2n:[^)]+\)/i)) tags.symptoms.push('marker-leak');

  return tags;
}

function harvest({ dryRun = false, limit = null } = {}) {
  ensureDir(outDir);
  const outputs = [];

  for (const srcDir of sources) {
    let files = [];
    try {
      files = fs.readdirSync(srcDir)
        .filter(f => f.endsWith('.html'))
        .map(f => path.join(srcDir, f));
    } catch {
      continue; // directory may not exist yet
    }

    if (typeof limit === 'number' && limit > 0) files = files.slice(0, limit);

    for (const file of files) {
      const html = fs.readFileSync(file, 'utf8');
      // Title fallback from filename
      const base = path.basename(file, '.html');
      const slugBase = toSlug(base.replace(/\d{4}-\d{2}-\d{2}.*/,'').replace(/_/g,'-')) || 'fixture';
      const slug = `${slugBase}-${hashShort(html).slice(0, 6)}`;

      const outHtml = path.join(outDir, `${slug}.html`);
      const outJson = path.join(outDir, `${slug}.json`);

      const tags = detectTags(html);
      const sidecar = {
        title: base,
        source: path.relative(repoRoot, file),
        ...tags,
      };

      if (dryRun) {
        console.log(`[DRY-RUN] Would write: ${path.relative(repoRoot, outHtml)} and ${path.relative(repoRoot, outJson)}`);
        outputs.push({ file, slug, sidecar });
      } else {
        fs.writeFileSync(outHtml, html, 'utf8');
        fs.writeFileSync(outJson, JSON.stringify(sidecar, null, 2), 'utf8');
        console.log(`✅ Harvested ${path.relative(repoRoot, file)} → ${path.relative(repoRoot, outHtml)}`);
        outputs.push({ file, slug, sidecar });
      }
    }
  }

  if (outputs.length === 0) {
    console.log('ℹ️ No HTML files found to harvest.');
  } else {
    console.log(`📦 Harvested ${outputs.length} fixture(s).`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
  return { dryRun, limit };
}

const options = parseArgs();
try {
  harvest(options);
  process.exit(0);
} catch (e) {
  console.error('❌ Harvester error:', e);
  process.exit(1);
}
