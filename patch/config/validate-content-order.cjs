#!/usr/bin/env node
/**
 * Validate Content Order and Completeness
 * 
 * Compares plain text content extracted from HTML source with text in Notion page
 * to verify that all content is present and in the correct order, regardless of
 * formatting, styling, or block structure.
 * 
 * Usage:
 *   node validate-content-order.cjs <html-file> <notion-page-id>
 * 
 * Example:
 *   node validate-content-order.cjs ../pages-to-update/updated-pages/onboard-github-to-devops-change-velocity-workspace-2025-11-11T08-55-59.html 2a8a89fedba5816d9940c30180a3bb16
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// Initialize Notion client
const notion = new Client({
  auth: process.env.NOTION_TOKEN || require('dotenv').config({ path: path.join(__dirname, '../../server/.env') }) && process.env.NOTION_TOKEN
});

/**
 * Extract plain text from HTML, preserving document order
 * Ignores formatting, only extracts visible text content
 */
function extractPlainTextFromHtml(html) {
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);
  
  // Remove script, style, and other non-content elements
  $('script, style, noscript, svg, iframe').remove();
  
  // Remove navigation, TOC, sidebar elements
  $('.contentPlaceholder, .mini-toc, .related-content, .breadcrumb, nav').remove();
  
  // Get text from body or main content area
  const $content = $('body').length ? $('body') : $.root();
  
  // Extract text, preserving structure
  const textSegments = [];
  
  function extractText($elem) {
    $elem.contents().each((_, node) => {
      if (node.type === 'text') {
        const text = $(node).text().trim();
        if (text.length > 0) {
          textSegments.push(text);
        }
      } else if (node.type === 'tag') {
        const $node = $(node);
        
        // Skip hidden elements
        if ($node.css('display') === 'none' || $node.attr('hidden')) {
          return;
        }
        
        // Recurse into children
        extractText($node);
      }
    });
  }
  
  extractText($content);
  
  return textSegments;
}

/**
 * Normalize text for comparison
 * - Convert to lowercase
 * - Remove extra whitespace
 * - Remove punctuation
 * - Normalize unicode
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with space
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/**
 * Extract plain text from Notion blocks recursively
 */
function extractTextFromNotionBlocks(blocks, depth = 0) {
  const textSegments = [];
  
  for (const block of blocks) {
    const type = block.type;
    const data = block[type];
    
    if (!data) continue;
    
    // Extract rich_text content
    if (Array.isArray(data.rich_text)) {
      const text = data.rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('').trim();
      if (text.length > 0) {
        textSegments.push(text);
      }
    }
    
    // Extract title/caption
    if (Array.isArray(data.title)) {
      const text = data.title.map(rt => rt.plain_text || rt.text?.content || '').join('').trim();
      if (text.length > 0) {
        textSegments.push(text);
      }
    }
    
    if (Array.isArray(data.caption)) {
      const text = data.caption.map(rt => rt.plain_text || rt.text?.content || '').join('').trim();
      if (text.length > 0) {
        textSegments.push(text);
      }
    }
    
    // Recurse into children
    if (data.children && Array.isArray(data.children)) {
      textSegments.push(...extractTextFromNotionBlocks(data.children, depth + 1));
    }
    
    // For tables, extract cell content
    if (type === 'table_row' && Array.isArray(data.cells)) {
      for (const cell of data.cells) {
        if (Array.isArray(cell)) {
          const text = cell.map(rt => rt.plain_text || rt.text?.content || '').join('').trim();
          if (text.length > 0) {
            textSegments.push(text);
          }
        }
      }
    }
  }
  
  return textSegments;
}

/**
 * Fetch all blocks from a Notion page recursively
 */
async function fetchAllNotionBlocks(blockId, depth = 0) {
  const blocks = [];
  let cursor = undefined;
  
  do {
    const options = { block_id: blockId, page_size: 100 };
    if (cursor) options.start_cursor = cursor;
    
    const response = await notion.blocks.children.list(options);
    
    for (const block of response.results || []) {
      blocks.push(block);
      
      // Fetch children for supported block types
      if (block.has_children && depth < 10) {
        const children = await fetchAllNotionBlocks(block.id, depth + 1);
        block[block.type].children = children;
      }
    }
    
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  return blocks;
}

/**
 * Calculate similarity between two text sequences using longest common subsequence
 */
function calculateSimilarity(arr1, arr2) {
  // Build LCS matrix
  const m = arr1.length;
  const n = arr2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const lcsLength = dp[m][n];
  const maxLength = Math.max(m, n);
  
  return maxLength > 0 ? (lcsLength / maxLength) * 100 : 100;
}

/**
 * Find missing segments in Notion that exist in HTML
 */
function findMissingSegments(htmlSegments, notionSegments) {
  const notionSet = new Set(notionSegments);
  return htmlSegments.filter(seg => !notionSet.has(seg));
}

/**
 * Find extra segments in Notion that don't exist in HTML
 */
function findExtraSegments(htmlSegments, notionSegments) {
  const htmlSet = new Set(htmlSegments);
  return notionSegments.filter(seg => !htmlSet.has(seg));
}

/**
 * Detect out-of-order segments
 */
function detectOrderIssues(htmlSegments, notionSegments) {
  const issues = [];
  
  // Find common segments and check their relative order
  const htmlIndexMap = new Map();
  htmlSegments.forEach((seg, idx) => {
    if (!htmlIndexMap.has(seg)) {
      htmlIndexMap.set(seg, []);
    }
    htmlIndexMap.get(seg).push(idx);
  });
  
  const notionIndexMap = new Map();
  notionSegments.forEach((seg, idx) => {
    if (!notionIndexMap.has(seg)) {
      notionIndexMap.set(seg, []);
    }
    notionIndexMap.get(seg).push(idx);
  });
  
  // Check for inversions (A before B in HTML but after B in Notion)
  const commonSegments = htmlSegments.filter(seg => notionIndexMap.has(seg));
  
  for (let i = 0; i < commonSegments.length - 1; i++) {
    const segA = commonSegments[i];
    const segB = commonSegments[i + 1];
    
    const htmlIdxA = htmlIndexMap.get(segA)[0];
    const htmlIdxB = htmlIndexMap.get(segB)[0];
    const notionIdxA = notionIndexMap.get(segA)[0];
    const notionIdxB = notionIndexMap.get(segB)[0];
    
    if (htmlIdxA < htmlIdxB && notionIdxA > notionIdxB) {
      issues.push({
        type: 'inversion',
        segmentA: segA.substring(0, 60),
        segmentB: segB.substring(0, 60),
        htmlOrder: [htmlIdxA, htmlIdxB],
        notionOrder: [notionIdxA, notionIdxB]
      });
    }
  }
  
  return issues;
}

/**
 * Main validation function
 */
async function validateContentOrder(htmlFilePath, notionPageId) {
  console.log('🔍 Content Validation Tool\n');
  console.log(`HTML File: ${htmlFilePath}`);
  console.log(`Notion Page: ${notionPageId}\n`);
  
  // Read HTML file
  console.log('📄 Reading HTML file...');
  const html = fs.readFileSync(htmlFilePath, 'utf-8');
  
  // Extract plain text from HTML
  console.log('📝 Extracting text from HTML...');
  const htmlTextRaw = extractPlainTextFromHtml(html);
  const htmlTextNormalized = htmlTextRaw.map(normalizeText).filter(t => t.length > 0);
  
  console.log(`   Found ${htmlTextRaw.length} text segments (${htmlTextNormalized.length} after normalization)`);
  
  // Fetch Notion blocks
  console.log('\n🌐 Fetching Notion page content...');
  const notionBlocks = await fetchAllNotionBlocks(notionPageId);
  
  // Extract plain text from Notion
  console.log('📝 Extracting text from Notion blocks...');
  const notionTextRaw = extractTextFromNotionBlocks(notionBlocks);
  const notionTextNormalized = notionTextRaw.map(normalizeText).filter(t => t.length > 0);
  
  console.log(`   Found ${notionTextRaw.length} text segments (${notionTextNormalized.length} after normalization)`);
  
  // Calculate metrics
  console.log('\n📊 Analysis:\n');
  
  const similarity = calculateSimilarity(htmlTextNormalized, notionTextNormalized);
  console.log(`✓ Similarity Score: ${similarity.toFixed(1)}%`);
  
  const htmlChars = htmlTextNormalized.join(' ').length;
  const notionChars = notionTextNormalized.join(' ').length;
  const charDiff = notionChars - htmlChars;
  const charDiffPercent = htmlChars > 0 ? (charDiff / htmlChars * 100) : 0;
  
  console.log(`✓ HTML text length: ${htmlChars} characters`);
  console.log(`✓ Notion text length: ${notionChars} characters`);
  console.log(`✓ Difference: ${charDiff > 0 ? '+' : ''}${charDiff} (${charDiffPercent > 0 ? '+' : ''}${charDiffPercent.toFixed(1)}%)`);
  
  // Find missing content
  const missing = findMissingSegments(htmlTextNormalized, notionTextNormalized);
  if (missing.length > 0) {
    console.log(`\n⚠️  Missing in Notion (${missing.length} segments):`);
    missing.slice(0, 10).forEach((seg, idx) => {
      const original = htmlTextRaw[htmlTextNormalized.indexOf(seg)];
      console.log(`   ${idx + 1}. "${original.substring(0, 80)}${original.length > 80 ? '...' : ''}"`);
    });
    if (missing.length > 10) {
      console.log(`   ... and ${missing.length - 10} more`);
    }
  } else {
    console.log('\n✓ All HTML content found in Notion');
  }
  
  // Find extra content
  const extra = findExtraSegments(htmlTextNormalized, notionTextNormalized);
  if (extra.length > 0) {
    console.log(`\n⚠️  Extra in Notion (${extra.length} segments):`);
    extra.slice(0, 10).forEach((seg, idx) => {
      const original = notionTextRaw[notionTextNormalized.indexOf(seg)];
      console.log(`   ${idx + 1}. "${original.substring(0, 80)}${original.length > 80 ? '...' : ''}"`);
    });
    if (extra.length > 10) {
      console.log(`   ... and ${extra.length - 10} more`);
    }
  } else {
    console.log('✓ No extra content in Notion');
  }
  
  // Check order
  const orderIssues = detectOrderIssues(htmlTextNormalized, notionTextNormalized);
  if (orderIssues.length > 0) {
    console.log(`\n⚠️  Order Issues (${orderIssues.length} detected):`);
    orderIssues.slice(0, 5).forEach((issue, idx) => {
      console.log(`   ${idx + 1}. Inversion detected:`);
      console.log(`      A: "${issue.segmentA}..."`);
      console.log(`      B: "${issue.segmentB}..."`);
      console.log(`      HTML order: A at ${issue.htmlOrder[0]}, B at ${issue.htmlOrder[1]}`);
      console.log(`      Notion order: A at ${issue.notionOrder[0]}, B at ${issue.notionOrder[1]}`);
    });
    if (orderIssues.length > 5) {
      console.log(`   ... and ${orderIssues.length - 5} more`);
    }
  } else {
    console.log('\n✓ Content order matches');
  }
  
  // Overall assessment
  console.log('\n' + '='.repeat(80));
  console.log('📋 Summary:\n');
  
  const hasMissing = missing.length > 0;
  const hasExtra = extra.length > 0;
  const hasOrderIssues = orderIssues.length > 0;
  const isGoodSimilarity = similarity >= 95;
  
  const result = {
    success: !hasMissing && !hasExtra && !hasOrderIssues && isGoodSimilarity,
    similarity,
    missing: missing.length,
    extra: extra.length,
    orderIssues: orderIssues.length,
    htmlChars,
    notionChars,
    charDiff,
    charDiffPercent
  };
  
  if (result.success) {
    console.log('✅ PASS - Content is complete and in correct order');
  } else {
    console.log('❌ ISSUES DETECTED:');
    if (hasMissing) console.log(`   - ${missing.length} segments missing from Notion`);
    if (hasExtra) console.log(`   - ${extra.length} extra segments in Notion`);
    if (hasOrderIssues) console.log(`   - ${orderIssues.length} order issues detected`);
    if (!isGoodSimilarity) console.log(`   - Similarity score below 95% (${similarity.toFixed(1)}%)`);
  }
  
  return result;
}

/**
 * Update Notion page Validation property with content validation results
 */
async function updateNotionValidationProperty(pageId, validationResult) {
  try {
    // Format validation text for Notion property
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const status = validationResult.success ? '✅ PASS' : '❌ FAIL';
    const similarity = validationResult.similarity.toFixed(1);
    
    let validationText = `[${timestamp}] Content Validation: ${status}\n`;
    validationText += `Similarity: ${similarity}% | HTML: ${validationResult.htmlChars} chars | Notion: ${validationResult.notionChars} chars (${validationResult.charDiffPercent > 0 ? '+' : ''}${validationResult.charDiffPercent.toFixed(1)}%)\n`;
    
    if (validationResult.missing > 0) {
      validationText += `⚠️ Missing: ${validationResult.missing} segments\n`;
    }
    if (validationResult.extra > 0) {
      validationText += `⚠️ Extra: ${validationResult.extra} segments\n`;
    }
    if (validationResult.orderIssues > 0) {
      validationText += `⚠️ Order issues: ${validationResult.orderIssues} detected\n`;
    }
    
    if (validationResult.success) {
      validationText += 'All content present and in correct order.';
    }
    
    // Update page properties
    await notion.pages.update({
      page_id: pageId,
      properties: {
        'Validation': {
          rich_text: [
            {
              type: 'text',
              text: { content: validationText }
            }
          ]
        },
        'Error': {
          checkbox: !validationResult.success
        }
      }
    });
    
    console.log('\n✓ Updated Notion page Validation property');
    return true;
  } catch (error) {
    console.error(`\n⚠️  Failed to update Notion validation property: ${error.message}`);
    return false;
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Check for --update-notion flag
  const updateNotion = args.includes('--update-notion');
  const filteredArgs = args.filter(arg => arg !== '--update-notion');
  
  if (filteredArgs.length < 2) {
    console.error('Usage: node validate-content-order.cjs <html-file> <notion-page-id> [--update-notion]');
    console.error('\nExample:');
    console.error('  node validate-content-order.cjs page.html 2a8a89fedba5816d9940c30180a3bb16');
    console.error('  node validate-content-order.cjs page.html 2a8a89fedba5816d9940c30180a3bb16 --update-notion');
    console.error('\nOptions:');
    console.error('  --update-notion  Update the Notion page\'s Validation property with results');
    process.exit(1);
  }
  
  const [htmlFile, pageId] = filteredArgs;
  
  // Resolve HTML file path
  const htmlPath = path.resolve(htmlFile);
  
  if (!fs.existsSync(htmlPath)) {
    console.error(`Error: HTML file not found: ${htmlPath}`);
    process.exit(1);
  }
  
  validateContentOrder(htmlPath, pageId)
    .then(async result => {
      // Update Notion if requested
      if (updateNotion) {
        console.log('\n📝 Updating Notion page properties...');
        await updateNotionValidationProperty(pageId, result);
      }
      
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n❌ Error:', error.message);
      if (process.env.SN2N_EXTRA_DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

module.exports = { validateContentOrder, updateNotionValidationProperty };
