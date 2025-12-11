#!/usr/bin/env node
/**
 * Analyze failing pages in patch/pages/pages-to-update/
 * Extracts metadata, groups by patterns, identifies root causes
 */

const fs = require('fs');
const path = require('path');

const PAGE_DIR = path.join(__dirname, 'patch/pages/pages-to-update');

// Extract metadata from HTML comment
function extractMetadata(htmlContent) {
  const commentMatch = htmlContent.match(/<!--([\s\S]*?)-->/);
  if (!commentMatch) return null;

  const comment = commentMatch[1];
  const metadata = {};

  // Extract key-value pairs
  const pageIdMatch = comment.match(/Page ID: ([a-f0-9-]+)/);
  const titleMatch = comment.match(/Page Title: (.+)/);
  const urlMatch = comment.match(/Page URL: (.+)/);
  const sourceMatch = comment.match(/Source URL: (.+)/);
  const createdMatch = comment.match(/Created: (.+)/);
  const versionMatch = comment.match(/v\d+\.\d+\.\d+/);

  if (pageIdMatch) metadata.pageId = pageIdMatch[1];
  if (titleMatch) metadata.title = titleMatch[1].trim();
  if (urlMatch) metadata.notionUrl = urlMatch[1].trim();
  if (sourceMatch) metadata.sourceUrl = sourceMatch[1].trim();
  if (createdMatch) metadata.created = createdMatch[1].trim();
  if (versionMatch) metadata.version = versionMatch[0];

  // Extract failure reasons
  const failureMatch = comment.match(/Failure Reasons:\n([\s\S]*?)\n\nContent Comparison/);
  if (failureMatch) {
    metadata.failureReasons = failureMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('•'));
  }

  // Extract content comparison
  const comparisonMatch = comment.match(/Content Comparison Status: (.*?)\n([\s\S]*?)\n\nAudit Coverage/);
  if (comparisonMatch) {
    metadata.comparisonStatus = comparisonMatch[1].includes('FAIL') ? 'FAIL' : 'PASS';
    const comparisonLines = comparisonMatch[2].split('\n');
    comparisonLines.forEach(line => {
      const match = line.match(/^(\w+.*?): (\d+) → (\d+)/);
      if (match) {
        const key = match[1].toLowerCase().replace(/ /g, '_');
        metadata[`${key}_expected`] = parseInt(match[2]);
        metadata[`${key}_actual`] = parseInt(match[3]);
      }
    });
  }

  // Extract AUDIT coverage
  const auditMatch = comment.match(/Audit Coverage: ([\d.]+)%/);
  const thresholdMatch = comment.match(/Audit Threshold: ([\d\-%.]+)/);
  const auditStatusMatch = comment.match(/Audit Status: (.*?)\n/);

  if (auditMatch) metadata.auditCoverage = parseFloat(auditMatch[1]);
  if (thresholdMatch) metadata.auditThreshold = thresholdMatch[1];
  if (auditStatusMatch) metadata.auditStatus = auditStatusMatch[1].includes('FAIL') ? 'FAIL' : 'PASS';

  return metadata;
}

// Analyze all pages
function analyzePages() {
  const files = fs.readdirSync(PAGE_DIR).filter(f => f.endsWith('.html'));
  const pages = [];
  const patterns = {};

  console.log(`\n📊 Analyzing ${files.length} failing pages...\n`);

  files.forEach((file, idx) => {
    try {
      const htmlContent = fs.readFileSync(path.join(PAGE_DIR, file), 'utf-8');
      const metadata = extractMetadata(htmlContent);

      if (!metadata) {
        console.log(`⚠️  No metadata in ${file}`);
        return;
      }

      metadata.filename = file;
      pages.push(metadata);

      // Create pattern key
      const key = `${metadata.comparisonStatus}_${metadata.auditStatus}`;
      if (!patterns[key]) {
        patterns[key] = { count: 0, files: [] };
      }
      patterns[key].count++;
      patterns[key].files.push(file);
    } catch (err) {
      console.error(`❌ Error reading ${file}: ${err.message}`);
    }
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('PATTERN SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  Object.entries(patterns).forEach(([key, data]) => {
    console.log(`Pattern: ${key}`);
    console.log(`  Count: ${data.count} pages`);
    console.log(`  Examples:`);
    data.files.slice(0, 3).forEach(f => console.log(`    - ${f}`));
    if (data.files.length > 3) console.log(`    ... and ${data.files.length - 3} more`);
    console.log();
  });

  // Analyze specific failure metrics
  console.log('═══════════════════════════════════════════════════════════');
  console.log('FAILURE METRICS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const failureTypes = {
    callout_mismatch: [],
    list_mismatch: [],
    paragraph_mismatch: [],
    audit_coverage_high: [],
    audit_coverage_low: [],
  };

  pages.forEach(page => {
    // Detect specific issues
    if (page.callouts_expected !== undefined && page.callouts_expected !== page.callouts_actual) {
      failureTypes.callout_mismatch.push(page.filename);
    }
    if (page.ordered_lists_expected !== undefined && 
        (page.ordered_lists_expected !== page.ordered_lists_actual || 
         page.unordered_lists_expected !== page.unordered_lists_actual)) {
      failureTypes.list_mismatch.push(page.filename);
    }
    if (page.paragraphs_expected !== undefined && page.paragraphs_expected !== page.paragraphs_actual) {
      failureTypes.paragraph_mismatch.push(page.filename);
    }
    if (page.auditCoverage !== undefined) {
      if (page.auditCoverage > 110) {
        failureTypes.audit_coverage_high.push({ file: page.filename, coverage: page.auditCoverage });
      }
      if (page.auditCoverage < 70) {
        failureTypes.audit_coverage_low.push({ file: page.filename, coverage: page.auditCoverage });
      }
    }
  });

  Object.entries(failureTypes).forEach(([type, items]) => {
    if (items.length > 0) {
      console.log(`${type}: ${items.length} pages affected`);
      items.slice(0, 2).forEach(item => {
        const display = typeof item === 'string' ? item : `${item.file} (${item.coverage}%)`;
        console.log(`  - ${display}`);
      });
      if (items.length > 2) console.log(`  ... and ${items.length - 2} more`);
      console.log();
    }
  });

  // Summary statistics
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY STATISTICS');
  console.log('═══════════════════════════════════════════════════════════\n');

  const comparisonFails = pages.filter(p => p.comparisonStatus === 'FAIL').length;
  const auditFails = pages.filter(p => p.auditStatus === 'FAIL').length;
  const avgCoverage = pages.reduce((sum, p) => sum + (p.auditCoverage || 0), 0) / pages.length;

  console.log(`Total pages: ${pages.length}`);
  console.log(`Comparison failures: ${comparisonFails}`);
  console.log(`Audit failures: ${auditFails}`);
  console.log(`Average AUDIT coverage: ${avgCoverage.toFixed(1)}%`);
  console.log();

  // Export detailed CSV
  const csvPath = path.join(__dirname, 'patch/analysis-failing-pages.csv');
  const csvContent = [
    'filename,pageId,title,comparisonStatus,auditStatus,auditCoverage,callouts_expected,callouts_actual',
    ...pages.map(p => 
      `"${p.filename}","${p.pageId || ''}","${p.title || ''}","${p.comparisonStatus}","${p.auditStatus}","${p.auditCoverage || ''}","${p.callouts_expected || ''}","${p.callouts_actual || ''}"`
    )
  ].join('\n');

  fs.writeFileSync(csvPath, csvContent);
  console.log(`✅ Detailed analysis exported to: patch/analysis-failing-pages.csv\n`);

  return { pages, patterns, failureTypes };
}

analyzePages();
