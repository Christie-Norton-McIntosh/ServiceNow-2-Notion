#!/usr/bin/env node
/**
 * Batch HTML to Notion Conversion Validator
 * 
 * Validates multiple HTML files against their Notion block conversions.
 * Useful for testing a batch of pages before PATCH operations.
 * 
 * Usage:
 *   node batch-validate-conversions.cjs <directory>
 *   node batch-validate-conversions.cjs ../patch/pages-to-update
 * 
 * Features:
 * - Validates all HTML files in a directory
 * - Generates summary report
 * - Identifies problematic conversions
 * - Exports results to JSON for further analysis
 */

const fs = require('fs');
const path = require('path');
const { validateConversion, extractHtmlStructure, extractNotionStructure, compareStructures } = require('./validate-html-to-notion-conversion.cjs');

// Color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

/**
 * Validate a single file and return results
 */
async function validateFile(filePath) {
  const cheerio = require('cheerio');
  
  try {
    const html = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    
    // Extract structures
    const htmlStruct = extractHtmlStructure(html);
    
    // Convert to Notion blocks
    const payload = {
      title: fileName.replace(/\.html$/, '').replace(/-/g, ' '),
      databaseId: '282a89fedba5815e91f0db972912ef9f',
      contentHtml: html,
      dryRun: true,
    };

    const response = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        file: fileName,
        status: 'error',
        error: `Server error: ${response.status}`,
        htmlStruct,
        notionStruct: null,
        comparison: null,
      };
    }

    const result = await response.json();
    
    if (!result.success) {
      return {
        file: fileName,
        status: 'error',
        error: result.error || 'Conversion failed',
        htmlStruct,
        notionStruct: null,
        comparison: null,
      };
    }

    const children = result.data?.children || result.children;
    
    if (!children || !Array.isArray(children)) {
      return {
        file: fileName,
        status: 'error',
        error: 'No children array in response',
        htmlStruct,
        notionStruct: null,
        comparison: null,
      };
    }

    const notionStruct = extractNotionStructure(children);
    const comparison = compareStructures(htmlStruct, notionStruct);

    // Determine status
    let status;
    if (comparison.summary.errors === 0) {
      status = 'pass';
    } else if (comparison.summary.errors <= 2) {
      status = 'warn';
    } else {
      status = 'fail';
    }

    return {
      file: fileName,
      status,
      htmlStruct,
      notionStruct,
      comparison,
      blockCount: children.length,
    };

  } catch (error) {
    return {
      file: path.basename(filePath),
      status: 'error',
      error: error.message,
      htmlStruct: null,
      notionStruct: null,
      comparison: null,
    };
  }
}

/**
 * Main batch validation function
 */
async function batchValidate(directory) {
  log('\n' + '='.repeat(80), 'bright');
  log('Batch HTML to Notion Conversion Validator', 'bright');
  log('='.repeat(80) + '\n', 'bright');

  // Check if directory exists
  if (!fs.existsSync(directory)) {
    log(`❌ Directory not found: ${directory}`, 'red');
    process.exit(1);
  }

  // Get all HTML files
  const files = fs.readdirSync(directory)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(directory, f));

  if (files.length === 0) {
    log(`❌ No HTML files found in: ${directory}`, 'red');
    process.exit(1);
  }

  log(`📂 Directory: ${directory}`, 'cyan');
  log(`📊 Found ${files.length} HTML files\n`, 'cyan');

  const results = [];
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;
  let errorCount = 0;

  // Process each file
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    
    log(`[${i + 1}/${files.length}] ${fileName}`, 'cyan');
    
    const result = await validateFile(filePath);
    results.push(result);

    // Display result
    if (result.status === 'pass') {
      log(`  ✅ PASS`, 'green');
      passCount++;
    } else if (result.status === 'warn') {
      log(`  ⚠️  WARN (${result.comparison.summary.errors} errors)`, 'yellow');
      warnCount++;
    } else if (result.status === 'fail') {
      log(`  ❌ FAIL (${result.comparison.summary.errors} errors)`, 'red');
      failCount++;
    } else {
      log(`  ❌ ERROR: ${result.error}`, 'red');
      errorCount++;
    }

    // Short summary
    if (result.comparison) {
      const c = result.comparison;
      log(`     Passed: ${c.summary.passed}, Warnings: ${c.summary.warnings}, Errors: ${c.summary.errors}`, 'reset');
    }

    // Small delay to avoid overwhelming server
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary
  log('\n' + '='.repeat(80), 'bright');
  log('Batch Validation Summary', 'bright');
  log('='.repeat(80) + '\n', 'bright');

  log(`Total files: ${files.length}`, 'bright');
  log(`✅ Passed:   ${passCount}`, 'green');
  log(`⚠️  Warnings: ${warnCount}`, 'yellow');
  log(`❌ Failed:   ${failCount}`, 'red');
  log(`🔥 Errors:   ${errorCount}`, 'red');

  // List problematic files
  if (failCount > 0 || errorCount > 0) {
    log('\n📋 Problematic Files:', 'yellow');
    results
      .filter(r => r.status === 'fail' || r.status === 'error')
      .forEach(r => {
        const icon = r.status === 'fail' ? '❌' : '🔥';
        log(`  ${icon} ${r.file}`, 'red');
        if (r.error) {
          log(`     Error: ${r.error}`, 'red');
        } else if (r.comparison) {
          log(`     Errors: ${r.comparison.summary.errors}`, 'red');
        }
      });
  }

  // Export results to JSON
  const outputPath = path.join(directory, 'validation-results.json');
  const exportData = {
    timestamp: new Date().toISOString(),
    directory,
    totalFiles: files.length,
    summary: { pass: passCount, warn: warnCount, fail: failCount, error: errorCount },
    results: results.map(r => ({
      file: r.file,
      status: r.status,
      error: r.error,
      blockCount: r.blockCount,
      comparison: r.comparison ? {
        passed: r.comparison.summary.passed,
        warnings: r.comparison.summary.warnings,
        errors: r.comparison.summary.errors,
        details: r.comparison.details,
      } : null,
      htmlStructure: r.htmlStruct ? {
        headings: r.htmlStruct.headings.length,
        lists: r.htmlStruct.lists.length,
        tables: r.htmlStruct.tables.length,
        images: r.htmlStruct.images.length,
      } : null,
      notionStructure: r.notionStruct ? {
        headings: r.notionStruct.headings.length,
        lists: r.notionStruct.lists.length,
        tables: r.notionStruct.tables.length,
        images: r.notionStruct.images.length,
      } : null,
    })),
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  log(`\n💾 Results exported to: ${outputPath}`, 'cyan');

  // Exit code
  log('\n' + '='.repeat(80), 'bright');
  if (failCount === 0 && errorCount === 0) {
    log('✅ ALL VALIDATIONS PASSED', 'green');
    return 0;
  } else if (failCount <= 2 && errorCount === 0) {
    log('⚠️  VALIDATION PASSED WITH MINOR ISSUES', 'yellow');
    return 0;
  } else {
    log('❌ VALIDATION FAILED', 'red');
    return 1;
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log('Usage: node batch-validate-conversions.cjs <directory>', 'yellow');
    log('\nExample:', 'cyan');
    log('  node batch-validate-conversions.cjs ../patch/pages-to-update', 'cyan');
    process.exit(1);
  }

  const directory = path.resolve(args[0]);
  batchValidate(directory)
    .then(exitCode => process.exit(exitCode))
    .catch(err => {
      log(`\n❌ Unhandled error: ${err.message}`, 'red');
      process.exit(1);
    });
}

module.exports = { batchValidate };
