#!/usr/bin/env node
/**
 * Revalidation Helper Script
 * Scans patch/pages/pages-to-update for captured HTML pages and categorizes issues.
 * Outputs JSON summary and optional actionable lists for selective retries.
 *
 * Categories:
 *  - content_fail: Type: Content Validation Failure (similarity < 95%)
 *  - severe_content_loss: similarity < 70%
 *  - near_pass: similarity >= 90% and < 95%
 *  - zero_blocks: validation metadata shows 'got 0' or Block Count (actual): unknown w/ count 0
 *  - duplicate_callouts: metadata contains 'Duplicate callouts'
 *  - missing_callouts: metadata contains 'Missing callouts'
 *  - table_mismatch: metadata contains 'Table count mismatch'
 *
 * Usage:
 *   node revalidate-problem-pages.cjs [--json] [--filter=category] [--limit=N]
 *   node revalidate-problem-pages.cjs --retry=zero_blocks   (prints pageIds to retry)
 *
 * NOTE: This script does NOT modify Notion. It only reads local HTML fixtures.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../pages/pages-to-update');

function readHeadComment(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const headMatch = content.match(/<!--[\s\S]*?-->/);
  return headMatch ? headMatch[0] : '';
}

function parseMetadata(commentBlock) {
  const meta = {};
  const lines = commentBlock.split(/\n/).map(l => l.trim());
  for (const line of lines) {
    if (/^Page:\s*/i.test(line)) meta.page = line.replace(/^Page:\s*/i,'').trim();
    if (/^Page ID:\s*/i.test(line)) meta.pageId = line.replace(/^Page ID:\s*/i,'').trim();
    if (/^Similarity:\s*/i.test(line)) {
      const val = line.replace(/^Similarity:\s*/i,'').trim();
      const num = parseFloat(val);
      meta.similarity = isNaN(num) ? null : num;
    }
    if (/Validation Errors:/i.test(line)) meta.validationErrors = line.replace(/^Validation Errors:\s*/i,'').trim();
    if (/Warnings:/i.test(line)) meta.warnings = line.replace(/^Warnings:\s*/i,'').trim();
    if (/Block Count \(expected\):/i.test(line)) meta.expectedBlocks = parseInt(line.replace(/.*expected\):\s*/,'').trim(),10);
    if (/Block Count \(actual\):/i.test(line)) {
      const val = line.replace(/.*actual\):\s*/,'').trim();
      meta.actualBlocks = /unknown/i.test(val) ? null : parseInt(val,10);
    }
    if (/HTML chars:/i.test(line)) meta.htmlChars = parseInt(line.replace(/HTML chars:\s*/i,'').trim(),10);
    if (/Notion chars:/i.test(line)) meta.notionChars = parseInt(line.replace(/Notion chars:\s*/i,'').trim(),10);
    if (/Type:\s*Content Validation Failure/i.test(line)) meta.type = 'content_validation_failure';
  }
  return meta;
}

function categorize(meta) {
  const categories = [];
  if (meta.type === 'content_validation_failure') categories.push('content_fail');
  if (meta.similarity != null) {
    if (meta.similarity < 70) categories.push('severe_content_loss');
    else if (meta.similarity < 95) categories.push('near_pass');
  }
  const ve = (meta.validationErrors || '').toLowerCase();
  if (/duplicate callouts/.test(ve)) categories.push('duplicate_callouts');
  if (/missing callouts/.test(ve)) categories.push('missing_callouts');
  if (/table count mismatch/.test(ve)) categories.push('table_mismatch');
  if (ve.includes('block count too low') && /got 0/.test(ve)) categories.push('zero_blocks');
  if (meta.actualBlocks === 0) categories.push('zero_blocks');
  return categories;
}

function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const filterArg = args.find(a => a.startsWith('--filter='));
  const retryArg = args.find(a => a.startsWith('--retry='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1],10) : null;

  if (!fs.existsSync(ROOT)) {
    console.error('Directory not found:', ROOT);
    process.exit(1);
  }

  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const results = [];

  for (const file of files) {
    try {
      const full = path.join(ROOT, file);
      const comment = readHeadComment(full);
      if (!comment) continue; // skip malformed entries
      const meta = parseMetadata(comment);
      meta.file = file;
      meta.categories = categorize(meta);
      results.push(meta);
    } catch (e) {
      console.warn('Failed to parse', file, e.message);
    }
  }

  // Aggregate counts
  const counts = {};
  for (const r of results) {
    for (const c of r.categories) {
      counts[c] = (counts[c] || 0) + 1;
    }
  }

  const summary = {
    totalFiles: files.length,
    categorizedFiles: results.length,
    categoryCounts: counts,
    severeExamples: results.filter(r => r.categories.includes('severe_content_loss')).slice(0,5).map(r => ({file: r.file, similarity: r.similarity})),
    zeroBlockExamples: results.filter(r => r.categories.includes('zero_blocks')).slice(0,5).map(r => ({file: r.file, pageId: r.pageId}))
  };

  if (retryArg) {
    const target = retryArg.split('=')[1];
    const toRetry = results.filter(r => r.categories.includes(target));
    for (const r of toRetry) {
      console.log(r.pageId || '(no page id)', r.file);
    }
    process.exit(0);
  }

  let filtered = results;
  if (filterArg) {
    const fcat = filterArg.split('=')[1];
    filtered = filtered.filter(r => r.categories.includes(fcat));
  }
  if (limit != null) filtered = filtered.slice(0, limit);

  if (wantJson) {
    console.log(JSON.stringify({ summary, pages: filtered }, null, 2));
  } else {
    console.log('=== Revalidation Summary ===');
    console.log(`Total HTML files: ${summary.totalFiles}`);
    console.log('Category Counts:');
    Object.entries(summary.categoryCounts).forEach(([k,v]) => console.log(`  • ${k}: ${v}`));
    console.log('\nSevere Content Loss Examples:');
    summary.severeExamples.forEach(e => console.log(`  - ${e.file} (${e.similarity}%)`));
    console.log('\nZero Block Examples:');
    summary.zeroBlockExamples.forEach(e => console.log(`  - ${e.file} (${e.pageId})`));
    console.log('\nFiltered Pages:');
    filtered.forEach(r => console.log(`  - ${r.file} :: ${r.categories.join(', ')} :: sim=${r.similarity ?? 'n/a'}`));
    console.log('\nRun with --json for machine-readable output.');
    console.log('Use --retry=zero_blocks to list page IDs needing retry.');
  }
}

if (require.main === module) {
  main();
}
