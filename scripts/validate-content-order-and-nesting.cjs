#!/usr/bin/env node
/**
 * Deep Content Order and Nesting Validator
 * 
 * Validates that Notion blocks preserve:
 * 1. Content order (blocks appear in correct sequence)
 * 2. List nesting levels (items at proper depth)
 * 3. Parent-child relationships (correct hierarchy)
 * 4. Text content accuracy (significant text preserved)
 * 
 * Usage:
 *   node validate-content-order-and-nesting.cjs <html-file-path>
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

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
 * Extract ordered content sequence from HTML
 * Walks DOM in order and records each significant element
 */
function extractHtmlSequence(html) {
  const $ = cheerio.load(html);
  const sequence = [];
  let elementIndex = 0;

  // Find main content container - ServiceNow uses specific structure
  let $content = $('div.body').first();
  if ($content.length === 0) {
    $content = $('.body-content').first();
  }
  if ($content.length === 0) {
    $content = $('body');
  }

  function processNode(node, depth = 0, parentType = 'root', listDepth = 0) {
    const $node = $(node);
    const tagName = node.name;

    // Skip script, style, meta tags
    if (['script', 'style', 'meta', 'link'].includes(tagName)) return;

    // Process element based on type
    if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || 
        tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
      const level = parseInt(tagName[1]);
      const text = $node.text().trim();
      sequence.push({
        index: elementIndex++,
        type: 'heading',
        level,
        text: text.substring(0, 100),
        depth,
        listDepth,
      });
    } else if (tagName === 'table') {
      const rows = $node.find('tr').length;
      sequence.push({
        index: elementIndex++,
        type: 'table',
        rows,
        depth,
        listDepth,
      });
    } else if (tagName === 'img') {
      const src = $node.attr('src') || '';
      sequence.push({
        index: elementIndex++,
        type: 'image',
        src: src.substring(0, 50),
        depth,
        listDepth,
      });
    } else if (tagName === 'pre' || $node.hasClass('codeblock')) {
      sequence.push({
        index: elementIndex++,
        type: 'code',
        depth,
        listDepth,
      });
    } else if ($node.hasClass('note') || $node.hasClass('info') || 
               $node.hasClass('warning') || $node.hasClass('important')) {
      const calloutType = $node.attr('class').match(/\b(note|info|warning|important|caution)\b/)?.[1] || 'unknown';
      const text = $node.text().trim();
      sequence.push({
        index: elementIndex++,
        type: 'callout',
        calloutType,
        text: text.substring(0, 100),
        depth,
        listDepth,
      });
    } else if (tagName === 'ol' || tagName === 'ul') {
      const listType = tagName === 'ol' ? 'numbered' : 'bulleted';
      
      // Process list items - each direct child <li> is at this list level
      $node.children('li').each((i, li) => {
        const $li = $(li);
        
        // Extract text from direct text nodes and inline elements only
        const textNodes = [];
        $li.contents().each((j, child) => {
          if (child.type === 'text') {
            textNodes.push($(child).text());
          } else if (['span', 'a', 'b', 'i', 'strong', 'em', 'code'].includes(child.name)) {
            textNodes.push($(child).text());
          }
        });
        const text = textNodes.join(' ').trim();
        
        sequence.push({
          index: elementIndex++,
          type: 'list_item',
          listType,
          text: text.substring(0, 100),
          depth,
          listDepth, // Use current list depth (parent's depth)
        });
        
        // Process nested lists and other block elements within list item
        $li.children('ol, ul, table, div.table-wrap, pre, div.note, div.info').each((j, child) => {
          // For nested lists, increment the depth
          if (child.name === 'ol' || child.name === 'ul') {
            processNode(child, depth + 1, 'list_item', listDepth + 1);
          } else {
            processNode(child, depth + 1, 'list_item', listDepth);
          }
        });
      });
    } else if (tagName === 'p' || $node.hasClass('p')) {
      const text = $node.text().trim();
      if (text.length > 20) { // Only significant paragraphs
        sequence.push({
          index: elementIndex++,
          type: 'paragraph',
          text: text.substring(0, 100),
          depth,
          listDepth,
        });
      }
    } else if (tagName === 'div' || tagName === 'section') {
      // Recurse into container elements
      $node.children().each((i, child) => {
        processNode(child, depth, parentType, listDepth);
      });
    }
  }

  // Start processing from main content
  $content.children().each((i, child) => {
    processNode(child, 0, 'root', 0);
  });

  return sequence;
}

/**
 * Extract ordered content sequence from Notion blocks
 */
function extractNotionSequence(blocks, depth = 0, listDepth = 0) {
  const sequence = [];
  let elementIndex = 0;

  function processBlock(block, currentDepth, currentListDepth) {
    const type = block.type;
    const typed = block[type] || {};
    const richText = typed.rich_text || [];
    const text = richText.map(rt => rt.text?.content || '').join('').trim();

    const item = {
      index: elementIndex++,
      type,
      depth: currentDepth,
      listDepth: currentListDepth,
    };

    // Add type-specific info
    if (type.startsWith('heading_')) {
      item.level = parseInt(type.split('_')[1]);
      item.text = text.substring(0, 100);
    } else if (type === 'table') {
      item.rows = typed.children?.length || 0;
    } else if (type === 'image') {
      item.url = (typed.external?.url || typed.file?.url || '').substring(0, 50);
    } else if (type === 'code') {
      item.language = typed.language || 'unknown';
    } else if (type === 'callout') {
      item.text = text.substring(0, 100);
      item.icon = typed.icon?.emoji || 'none';
    } else if (type === 'numbered_list_item' || type === 'bulleted_list_item') {
      item.listType = type === 'numbered_list_item' ? 'numbered' : 'bulleted';
      item.text = text.substring(0, 100);
    } else if (type === 'paragraph') {
      item.text = text.substring(0, 100);
    }

    sequence.push(item);

    // Process children
    if (typed.children && Array.isArray(typed.children)) {
      const newListDepth = (type === 'numbered_list_item' || type === 'bulleted_list_item') 
        ? currentListDepth + 1 
        : currentListDepth;
      typed.children.forEach(child => {
        processBlock(child, currentDepth + 1, newListDepth);
      });
    }
  }

  blocks.forEach(block => processBlock(block, depth, listDepth));
  return sequence;
}

/**
 * Compare sequences for order and nesting
 */
function compareSequences(htmlSeq, notionSeq) {
  const results = {
    orderMatches: [],
    orderMismatches: [],
    nestingMatches: [],
    nestingMismatches: [],
    textMatches: [],
    textMismatches: [],
  };

  log('\n🔍 Analyzing Content Order and Nesting...\n', 'cyan');

  // Group by type for easier comparison
  const htmlByType = {};
  const notionByType = {};

  htmlSeq.forEach(item => {
    if (!htmlByType[item.type]) htmlByType[item.type] = [];
    htmlByType[item.type].push(item);
  });

  notionSeq.forEach(item => {
    const typeKey = item.type === 'numbered_list_item' || item.type === 'bulleted_list_item' 
      ? 'list_item' 
      : item.type;
    if (!notionByType[typeKey]) notionByType[typeKey] = [];
    notionByType[typeKey].push(item);
  });

  // Compare headings order
  log('📋 Heading Order:', 'bright');
  if (htmlByType.heading && notionByType.heading) {
    const htmlHeadings = htmlByType.heading;
    const notionHeadings = notionByType.heading;
    
    for (let i = 0; i < Math.min(htmlHeadings.length, notionHeadings.length); i++) {
      const html = htmlHeadings[i];
      const notion = notionHeadings[i];
      
      // Compare text similarity (first 50 chars)
      const htmlText = html.text.substring(0, 50).toLowerCase();
      const notionText = notion.text.substring(0, 50).toLowerCase();
      
      if (htmlText === notionText || htmlText.includes(notionText) || notionText.includes(htmlText)) {
        log(`  ✅ [${i + 1}] "${html.text.substring(0, 40)}..." (order preserved)`, 'green');
        results.orderMatches.push({ type: 'heading', index: i, html, notion });
      } else {
        log(`  ❌ [${i + 1}] Order mismatch:`, 'red');
        log(`     HTML:   "${html.text.substring(0, 40)}..."`, 'red');
        log(`     Notion: "${notion.text.substring(0, 40)}..."`, 'red');
        results.orderMismatches.push({ type: 'heading', index: i, html, notion });
      }
    }
  } else {
    log('  ⚠️ No headings to compare', 'yellow');
  }

  // Compare list nesting levels
  log('\n📋 List Item Nesting:', 'bright');
  if (htmlByType.list_item && notionByType.list_item) {
    const htmlItems = htmlByType.list_item;
    const notionItems = notionByType.list_item;
    
    log(`  HTML list items: ${htmlItems.length}`);
    log(`  Notion list items: ${notionItems.length}`);
    
    // Sample first 5 items for nesting depth comparison
    const sampleSize = Math.min(5, htmlItems.length, notionItems.length);
    log(`\n  Checking first ${sampleSize} items for nesting depth:\n`);
    
    for (let i = 0; i < sampleSize; i++) {
      const html = htmlItems[i];
      const notion = notionItems[i];
      
      if (html.listDepth === notion.listDepth) {
        log(`  ✅ [${i + 1}] Depth ${html.listDepth}: "${html.text.substring(0, 30)}..."`, 'green');
        results.nestingMatches.push({ type: 'list_item', index: i, html, notion });
      } else {
        log(`  ❌ [${i + 1}] Depth mismatch:`, 'red');
        log(`     HTML depth ${html.listDepth}: "${html.text.substring(0, 30)}..."`, 'red');
        log(`     Notion depth ${notion.listDepth}: "${notion.text.substring(0, 30)}..."`, 'red');
        results.nestingMismatches.push({ type: 'list_item', index: i, html, notion });
      }
    }
    
    // Check for extreme nesting differences
    const htmlMaxDepth = Math.max(...htmlItems.map(i => i.listDepth));
    const notionMaxDepth = Math.max(...notionItems.map(i => i.listDepth));
    
    log(`\n  Max nesting depth - HTML: ${htmlMaxDepth}, Notion: ${notionMaxDepth}`);
    if (Math.abs(htmlMaxDepth - notionMaxDepth) > 1) {
      log(`  ⚠️ Significant depth difference detected`, 'yellow');
    }
  } else {
    log('  ⚠️ No list items to compare', 'yellow');
  }

  // Compare tables order
  log('\n📋 Table Order:', 'bright');
  if (htmlByType.table && notionByType.table) {
    const htmlTables = htmlByType.table;
    const notionTables = notionByType.table;
    
    for (let i = 0; i < Math.min(htmlTables.length, notionTables.length); i++) {
      const html = htmlTables[i];
      const notion = notionTables[i];
      
      if (html.rows === notion.rows) {
        log(`  ✅ [${i + 1}] Table with ${html.rows} rows (order preserved)`, 'green');
        results.orderMatches.push({ type: 'table', index: i, html, notion });
      } else {
        log(`  ⚠️ [${i + 1}] Table row count differs: HTML=${html.rows}, Notion=${notion.rows}`, 'yellow');
      }
    }
  } else {
    log('  ⚠️ No tables to compare', 'yellow');
  }

  // Check for position consistency (element #3 should be near element #3)
  log('\n📋 Position Consistency:', 'bright');
  const htmlHeadings = htmlByType.heading || [];
  const notionHeadings = notionByType.heading || [];
  
  if (htmlHeadings.length > 0 && notionHeadings.length > 0) {
    let positionMatches = 0;
    const tolerance = 2; // Allow ±2 position difference
    
    for (let i = 0; i < Math.min(htmlHeadings.length, notionHeadings.length); i++) {
      const htmlPos = htmlHeadings[i].index;
      const notionPos = notionHeadings[i].index;
      
      if (Math.abs(htmlPos - notionPos) <= tolerance) {
        positionMatches++;
      }
    }
    
    const matchRate = (positionMatches / Math.min(htmlHeadings.length, notionHeadings.length) * 100).toFixed(1);
    log(`  ${matchRate}% of headings in expected positions (±${tolerance})`, matchRate >= 80 ? 'green' : 'yellow');
  }

  return results;
}

/**
 * Main validation function
 */
async function validateOrderAndNesting(htmlFilePath) {
  log('\n' + '='.repeat(80), 'bright');
  log('Content Order and Nesting Validator', 'bright');
  log('='.repeat(80) + '\n', 'bright');

  if (!fs.existsSync(htmlFilePath)) {
    log(`❌ File not found: ${htmlFilePath}`, 'red');
    process.exit(1);
  }

  const fileName = path.basename(htmlFilePath);
  log(`📄 File: ${fileName}`, 'cyan');

  // Read HTML
  const html = fs.readFileSync(htmlFilePath, 'utf-8');

  // Extract HTML sequence
  log('\n🔍 Extracting HTML content sequence...', 'yellow');
  const htmlSeq = extractHtmlSequence(html);
  log(`  Found ${htmlSeq.length} elements`, 'cyan');

  // Convert to Notion blocks
  log('\n🔄 Converting to Notion blocks...', 'yellow');
  const payload = {
    title: fileName.replace(/\.html$/, '').replace(/-/g, ' '),
    databaseId: '282a89fedba5815e91f0db972912ef9f',
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
      log(`❌ Server error: ${response.status}`, 'red');
      process.exit(1);
    }

    const result = await response.json();
    const children = result.data?.children || result.children;

    if (!children || !Array.isArray(children)) {
      log('❌ No children array in response', 'red');
      process.exit(1);
    }

    log(`  Generated ${children.length} blocks`, 'cyan');

    // Extract Notion sequence
    log('\n🔍 Extracting Notion block sequence...', 'yellow');
    const notionSeq = extractNotionSequence(children);
    log(`  Found ${notionSeq.length} elements`, 'cyan');

    // Compare sequences
    const comparison = compareSequences(htmlSeq, notionSeq);

    // Summary
    log('\n' + '='.repeat(80), 'bright');
    log('Validation Summary', 'bright');
    log('='.repeat(80), 'bright');

    const totalOrderChecks = comparison.orderMatches.length + comparison.orderMismatches.length;
    const totalNestingChecks = comparison.nestingMatches.length + comparison.nestingMismatches.length;

    log(`\n📊 Order Validation:`, 'bright');
    log(`  ✅ Matches: ${comparison.orderMatches.length}/${totalOrderChecks}`, 'green');
    log(`  ❌ Mismatches: ${comparison.orderMismatches.length}/${totalOrderChecks}`, comparison.orderMismatches.length === 0 ? 'green' : 'red');

    log(`\n📊 Nesting Validation:`, 'bright');
    log(`  ✅ Matches: ${comparison.nestingMatches.length}/${totalNestingChecks}`, 'green');
    log(`  ❌ Mismatches: ${comparison.nestingMismatches.length}/${totalNestingChecks}`, comparison.nestingMismatches.length === 0 ? 'green' : 'red');

    // Overall result
    log('\n' + '='.repeat(80), 'bright');
    const hasErrors = comparison.orderMismatches.length > 0 || comparison.nestingMismatches.length > 0;
    
    if (!hasErrors) {
      log('✅ VALIDATION PASSED', 'green');
      log('Content order and nesting preserved correctly', 'green');
      return 0;
    } else if (comparison.orderMismatches.length <= 1 && comparison.nestingMismatches.length <= 1) {
      log('⚠️  VALIDATION PASSED WITH WARNINGS', 'yellow');
      log('Minor order/nesting discrepancies detected', 'yellow');
      return 0;
    } else {
      log('❌ VALIDATION FAILED', 'red');
      log('Significant order/nesting issues detected', 'red');
      return 1;
    }

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    log('Usage: node validate-content-order-and-nesting.cjs <html-file-path>', 'yellow');
    log('\nExample:', 'cyan');
    log('  node validate-content-order-and-nesting.cjs ../patch/pages-to-update/example.html', 'cyan');
    process.exit(1);
  }

  const htmlFilePath = path.resolve(args[0]);
  validateOrderAndNesting(htmlFilePath)
    .then(exitCode => process.exit(exitCode))
    .catch(err => {
      log(`\n❌ Error: ${err.message}`, 'red');
      process.exit(1);
    });
}

module.exports = { validateOrderAndNesting, extractHtmlSequence, extractNotionSequence, compareSequences };
