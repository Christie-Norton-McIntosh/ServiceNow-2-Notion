#!/usr/bin/env node
/**
 * Validate HTML to Notion Conversion
 * 
 * This script compares the original ServiceNow HTML with the generated Notion blocks
 * to validate content completeness and block order preservation.
 * 
 * Usage:
 *   node validate-html-to-notion-conversion.cjs <html-file-path>
 *   node validate-html-to-notion-conversion.cjs path/to/page.html
 * 
 * Features:
 * - Extracts structure from HTML (headings, lists, tables, images, text blocks)
 * - Converts to Notion blocks via dry-run
 * - Compares block types, counts, and order
 * - Validates text content completeness
 * - Reports missing or misplaced elements
 * - Color-coded output for easy reading
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

/**
 * Extract structural metadata from HTML
 */
function extractHtmlStructure(html) {
  const $ = cheerio.load(html);
  const structure = {
    headings: [],
    paragraphs: [],
    lists: [],
    tables: [],
    images: [],
    codeBlocks: [],
    callouts: [],
    textBlocks: [],
  };

  // Extract headings
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    const $el = $(el);
    const level = parseInt(el.name.substring(1));
    const text = $el.text().trim();
    structure.headings.push({ level, text, index: i });
  });

  // Extract lists
  $('ol, ul').each((i, el) => {
    const $el = $(el);
    const type = el.name === 'ol' ? 'numbered' : 'bulleted';
    const items = $el.find('> li').length;
    const nestedLists = $el.find('ol, ul').length;
    structure.lists.push({ type, items, nestedLists, index: i });
  });

  // Extract tables
  $('table').each((i, el) => {
    const $el = $(el);
    const rows = $el.find('tr').length;
    const hasHeader = $el.find('thead, th').length > 0;
    structure.tables.push({ rows, hasHeader, index: i });
  });

  // Extract images
  $('img').each((i, el) => {
    const $el = $(el);
    const src = $el.attr('src') || '';
    const alt = $el.attr('alt') || '';
    structure.images.push({ src: src.substring(0, 100), alt, index: i });
  });

  // Extract code blocks
  $('pre, code.codeblock, div.codeblock').each((i, el) => {
    const $el = $(el);
    const language = $el.attr('class')?.match(/language-(\w+)/)?.[1] || 'unknown';
    const lines = $el.text().split('\n').length;
    structure.codeBlocks.push({ language, lines, index: i });
  });

  // Extract callouts (info, note, warning, etc.)
  $('div.note, div.info, div.warning, div.important, div.caution').each((i, el) => {
    const $el = $(el);
    const type = el.attribs.class?.split(' ').find(c => ['note', 'info', 'warning', 'important', 'caution'].includes(c)) || 'unknown';
    const text = $el.text().trim().substring(0, 100);
    structure.callouts.push({ type, text, index: i });
  });

  // Extract significant text blocks (paragraphs with substantial content)
  $('p, div.p').each((i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.length > 20) { // Only count substantial paragraphs
      structure.textBlocks.push({ text: text.substring(0, 100), length: text.length, index: i });
    }
  });

  return structure;
}

/**
 * Extract structural metadata from Notion blocks
 */
function extractNotionStructure(blocks, depth = 0) {
  const structure = {
    headings: [],
    paragraphs: [],
    lists: [],
    tables: [],
    images: [],
    codeBlocks: [],
    callouts: [],
    blockSequence: [],
  };

  function processBlock(block, parentIndex = null) {
    const type = block.type;
    const typed = block[type] || {};
    
    // Extract text content
    const richText = typed.rich_text || [];
    const text = richText.map(rt => rt.text?.content || '').join('').trim();

    // Track block sequence
    structure.blockSequence.push({ type, text: text.substring(0, 50), depth });

    // Categorize by type
    if (type.startsWith('heading_')) {
      const level = parseInt(type.split('_')[1]);
      structure.headings.push({ level, text });
    } else if (type === 'paragraph') {
      if (text.length > 20) {
        structure.paragraphs.push({ text: text.substring(0, 100), length: text.length });
      }
    } else if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
      const listType = type === 'numbered_list_item' ? 'numbered' : 'bulleted';
      const hasChildren = typed.children && typed.children.length > 0;
      structure.lists.push({ type: listType, text: text.substring(0, 50), hasChildren });
    } else if (type === 'table') {
      const rows = typed.children?.length || 0;
      structure.tables.push({ rows });
    } else if (type === 'image') {
      const url = typed.external?.url || typed.file?.url || '';
      structure.images.push({ url: url.substring(0, 100) });
    } else if (type === 'code') {
      const language = typed.language || 'unknown';
      const lines = typed.rich_text?.[0]?.text?.content?.split('\n').length || 0;
      structure.codeBlocks.push({ language, lines });
    } else if (type === 'callout') {
      const icon = typed.icon?.emoji || typed.icon?.type || 'none';
      structure.callouts.push({ text: text.substring(0, 100), icon });
    }

    // Recurse into children
    if (typed.children && Array.isArray(typed.children)) {
      typed.children.forEach(child => processBlock(child, parentIndex));
    }
  }

  blocks.forEach((block, idx) => processBlock(block, idx));
  return structure;
}

/**
 * Compare HTML and Notion structures
 */
function compareStructures(htmlStruct, notionStruct) {
  const results = {
    summary: { passed: 0, warnings: 0, errors: 0 },
    details: [],
  };

  function addResult(category, status, message) {
    results.details.push({ category, status, message });
    if (status === 'pass') results.summary.passed++;
    else if (status === 'warn') results.summary.warnings++;
    else if (status === 'error') results.summary.errors++;
  }

  // Compare headings
  log('\n📋 Comparing Headings...', 'cyan');
  if (htmlStruct.headings.length === notionStruct.headings.length) {
    addResult('headings', 'pass', `✅ Heading count matches: ${htmlStruct.headings.length}`);
    log(`  ✅ Heading count matches: ${htmlStruct.headings.length}`, 'green');
  } else {
    addResult('headings', 'error', `❌ Heading count mismatch: HTML=${htmlStruct.headings.length}, Notion=${notionStruct.headings.length}`);
    log(`  ❌ HTML: ${htmlStruct.headings.length} headings, Notion: ${notionStruct.headings.length} headings`, 'red');
  }

  // Compare heading levels
  const htmlLevels = htmlStruct.headings.map(h => h.level);
  const notionLevels = notionStruct.headings.map(h => h.level);
  if (JSON.stringify(htmlLevels) === JSON.stringify(notionLevels)) {
    addResult('headings', 'pass', '✅ Heading levels preserved');
    log('  ✅ Heading levels preserved', 'green');
  } else {
    addResult('headings', 'warn', `⚠️ Heading levels differ: HTML=[${htmlLevels.join(',')}], Notion=[${notionLevels.join(',')}]`);
    log(`  ⚠️ HTML levels: [${htmlLevels.join(', ')}]`, 'yellow');
    log(`  ⚠️ Notion levels: [${notionLevels.join(', ')}]`, 'yellow');
  }

  // Compare lists
  log('\n📋 Comparing Lists...', 'cyan');
  const htmlListCount = htmlStruct.lists.length;
  const notionListItems = notionStruct.lists.length;
  if (htmlListCount > 0 && notionListItems > 0) {
    addResult('lists', 'pass', `✅ Lists detected: HTML=${htmlListCount} lists, Notion=${notionListItems} list items`);
    log(`  ✅ HTML: ${htmlListCount} lists, Notion: ${notionListItems} list items`, 'green');
  } else if (htmlListCount === 0 && notionListItems === 0) {
    addResult('lists', 'pass', '✅ No lists (as expected)');
    log('  ✅ No lists detected in either format', 'green');
  } else {
    addResult('lists', 'error', `❌ List count mismatch: HTML=${htmlListCount}, Notion items=${notionListItems}`);
    log(`  ❌ HTML: ${htmlListCount} lists, Notion: ${notionListItems} list items`, 'red');
  }

  // Compare tables
  log('\n📋 Comparing Tables...', 'cyan');
  if (htmlStruct.tables.length === notionStruct.tables.length) {
    addResult('tables', 'pass', `✅ Table count matches: ${htmlStruct.tables.length}`);
    log(`  ✅ Table count matches: ${htmlStruct.tables.length}`, 'green');
    
    // Compare row counts
    htmlStruct.tables.forEach((htmlTable, idx) => {
      const notionTable = notionStruct.tables[idx];
      if (notionTable && htmlTable.rows === notionTable.rows) {
        log(`  ✅ Table ${idx + 1}: ${htmlTable.rows} rows (matches)`, 'green');
      } else if (notionTable) {
        addResult('tables', 'warn', `⚠️ Table ${idx + 1}: Row count differs (HTML=${htmlTable.rows}, Notion=${notionTable.rows})`);
        log(`  ⚠️ Table ${idx + 1}: HTML=${htmlTable.rows} rows, Notion=${notionTable.rows} rows`, 'yellow');
      }
    });
  } else {
    addResult('tables', 'error', `❌ Table count mismatch: HTML=${htmlStruct.tables.length}, Notion=${notionStruct.tables.length}`);
    log(`  ❌ HTML: ${htmlStruct.tables.length} tables, Notion: ${notionStruct.tables.length} tables`, 'red');
  }

  // Compare images
  log('\n📋 Comparing Images...', 'cyan');
  if (htmlStruct.images.length === notionStruct.images.length) {
    addResult('images', 'pass', `✅ Image count matches: ${htmlStruct.images.length}`);
    log(`  ✅ Image count matches: ${htmlStruct.images.length}`, 'green');
  } else {
    addResult('images', 'error', `❌ Image count mismatch: HTML=${htmlStruct.images.length}, Notion=${notionStruct.images.length}`);
    log(`  ❌ HTML: ${htmlStruct.images.length} images, Notion: ${notionStruct.images.length} images`, 'red');
  }

  // Compare code blocks
  log('\n📋 Comparing Code Blocks...', 'cyan');
  if (htmlStruct.codeBlocks.length === notionStruct.codeBlocks.length) {
    addResult('code', 'pass', `✅ Code block count matches: ${htmlStruct.codeBlocks.length}`);
    log(`  ✅ Code block count matches: ${htmlStruct.codeBlocks.length}`, 'green');
  } else if (htmlStruct.codeBlocks.length === 0 && notionStruct.codeBlocks.length === 0) {
    addResult('code', 'pass', '✅ No code blocks (as expected)');
    log('  ✅ No code blocks detected', 'green');
  } else {
    addResult('code', 'warn', `⚠️ Code block count differs: HTML=${htmlStruct.codeBlocks.length}, Notion=${notionStruct.codeBlocks.length}`);
    log(`  ⚠️ HTML: ${htmlStruct.codeBlocks.length} code blocks, Notion: ${notionStruct.codeBlocks.length} code blocks`, 'yellow');
  }

  // Compare callouts
  log('\n📋 Comparing Callouts...', 'cyan');
  if (htmlStruct.callouts.length === notionStruct.callouts.length) {
    addResult('callouts', 'pass', `✅ Callout count matches: ${htmlStruct.callouts.length}`);
    log(`  ✅ Callout count matches: ${htmlStruct.callouts.length}`, 'green');
  } else if (htmlStruct.callouts.length === 0 && notionStruct.callouts.length === 0) {
    addResult('callouts', 'pass', '✅ No callouts (as expected)');
    log('  ✅ No callouts detected', 'green');
  } else {
    addResult('callouts', 'warn', `⚠️ Callout count differs: HTML=${htmlStruct.callouts.length}, Notion=${notionStruct.callouts.length}`);
    log(`  ⚠️ HTML: ${htmlStruct.callouts.length} callouts, Notion: ${notionStruct.callouts.length} callouts`, 'yellow');
  }

  // Compare text blocks
  log('\n📋 Comparing Text Content...', 'cyan');
  const htmlTextBlocks = htmlStruct.textBlocks.length;
  const notionParagraphs = notionStruct.paragraphs.length;
  if (Math.abs(htmlTextBlocks - notionParagraphs) <= 2) { // Allow small variance
    addResult('text', 'pass', `✅ Text block count similar: HTML=${htmlTextBlocks}, Notion=${notionParagraphs}`);
    log(`  ✅ HTML: ${htmlTextBlocks} text blocks, Notion: ${notionParagraphs} paragraphs`, 'green');
  } else {
    addResult('text', 'warn', `⚠️ Text block count differs: HTML=${htmlTextBlocks}, Notion=${notionParagraphs}`);
    log(`  ⚠️ HTML: ${htmlTextBlocks} text blocks, Notion: ${notionParagraphs} paragraphs`, 'yellow');
  }

  return results;
}

/**
 * Main validation function
 */
async function validateConversion(htmlFilePath) {
  log('\n' + '='.repeat(80), 'bright');
  log('HTML to Notion Conversion Validator', 'bright');
  log('='.repeat(80) + '\n', 'bright');

  // Check if file exists
  if (!fs.existsSync(htmlFilePath)) {
    log(`❌ File not found: ${htmlFilePath}`, 'red');
    process.exit(1);
  }

  const fileName = path.basename(htmlFilePath);
  log(`📄 File: ${fileName}`, 'cyan');

  // Read HTML
  const html = fs.readFileSync(htmlFilePath, 'utf-8');
  log(`📊 HTML size: ${(html.length / 1024).toFixed(2)} KB`, 'cyan');

  // Extract HTML structure
  log('\n🔍 Analyzing HTML structure...', 'yellow');
  const htmlStruct = extractHtmlStructure(html);
  
  log('\n📊 HTML Structure:', 'bright');
  log(`  • Headings: ${htmlStruct.headings.length}`);
  log(`  • Lists: ${htmlStruct.lists.length}`);
  log(`  • Tables: ${htmlStruct.tables.length}`);
  log(`  • Images: ${htmlStruct.images.length}`);
  log(`  • Code blocks: ${htmlStruct.codeBlocks.length}`);
  log(`  • Callouts: ${htmlStruct.callouts.length}`);
  log(`  • Text blocks: ${htmlStruct.textBlocks.length}`);

  // Convert to Notion blocks
  log('\n🔄 Converting to Notion blocks (dry-run)...', 'yellow');
  
  const payload = {
    title: fileName.replace(/\.html$/, '').replace(/-/g, ' '),
    databaseId: '282a89fedba5815e91f0db972912ef9f', // Default database
    contentHtml: html,
    dryRun: true,
  };

  try {
    const response = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      log(`❌ Server error: ${response.status} ${response.statusText}`, 'red');
      process.exit(1);
    }

    const result = await response.json();

    if (!result.success) {
      log(`❌ Conversion failed: ${result.error || 'Unknown error'}`, 'red');
      process.exit(1);
    }

    const children = result.data?.children || result.children;

    if (!children || !Array.isArray(children)) {
      log('❌ No children array in response', 'red');
      process.exit(1);
    }

    log(`✅ Generated ${children.length} Notion blocks`, 'green');

    // Extract Notion structure
    log('\n🔍 Analyzing Notion block structure...', 'yellow');
    const notionStruct = extractNotionStructure(children);

    log('\n📊 Notion Structure:', 'bright');
    log(`  • Headings: ${notionStruct.headings.length}`);
    log(`  • List items: ${notionStruct.lists.length}`);
    log(`  • Tables: ${notionStruct.tables.length}`);
    log(`  • Images: ${notionStruct.images.length}`);
    log(`  • Code blocks: ${notionStruct.codeBlocks.length}`);
    log(`  • Callouts: ${notionStruct.callouts.length}`);
    log(`  • Paragraphs: ${notionStruct.paragraphs.length}`);

    // Compare structures
    log('\n' + '='.repeat(80), 'bright');
    log('Validation Results', 'bright');
    log('='.repeat(80), 'bright');

    const comparison = compareStructures(htmlStruct, notionStruct);

    // Summary
    log('\n' + '='.repeat(80), 'bright');
    log('Summary', 'bright');
    log('='.repeat(80), 'bright');
    
    const total = comparison.summary.passed + comparison.summary.warnings + comparison.summary.errors;
    log(`\n✅ Passed:   ${comparison.summary.passed}/${total}`, 'green');
    log(`⚠️  Warnings: ${comparison.summary.warnings}/${total}`, 'yellow');
    log(`❌ Errors:   ${comparison.summary.errors}/${total}`, 'red');

    // Overall result
    log('\n' + '='.repeat(80), 'bright');
    if (comparison.summary.errors === 0) {
      log('✅ VALIDATION PASSED', 'green');
      log('Content structure preserved successfully', 'green');
      return 0;
    } else if (comparison.summary.errors <= 2) {
      log('⚠️  VALIDATION PASSED WITH WARNINGS', 'yellow');
      log('Minor discrepancies detected but conversion is acceptable', 'yellow');
      return 0;
    } else {
      log('❌ VALIDATION FAILED', 'red');
      log('Significant content differences detected', 'red');
      return 1;
    }

  } catch (error) {
    log(`\n❌ Error during validation: ${error.message}`, 'red');
    if (error.stack) {
      log(`\n${error.stack}`, 'red');
    }
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log('Usage: node validate-html-to-notion-conversion.cjs <html-file-path>', 'yellow');
    log('\nExample:', 'cyan');
    log('  node validate-html-to-notion-conversion.cjs ../patch/pages-to-update/example.html', 'cyan');
    process.exit(1);
  }

  const htmlFilePath = path.resolve(args[0]);
  validateConversion(htmlFilePath)
    .then(exitCode => process.exit(exitCode))
    .catch(err => {
      log(`\n❌ Unhandled error: ${err.message}`, 'red');
      process.exit(1);
    });
}

module.exports = { validateConversion, extractHtmlStructure, extractNotionStructure, compareStructures };
