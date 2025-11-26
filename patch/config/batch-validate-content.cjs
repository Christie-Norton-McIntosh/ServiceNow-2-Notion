#!/usr/bin/env node
/**
 * Batch Content Validation
 * 
 * Validates content order and completeness for multiple pages.
 * Reads page metadata from JSON files to get page IDs.
 * Optionally updates Notion page Validation properties with results.
 * 
 * Usage:
 *   node batch-validate-content.cjs [directory] [--update-notion]
 * 
 * Example:
 *   node batch-validate-content.cjs ../pages/updated-pages
 *   node batch-validate-content.cjs ../pages/updated-pages --update-notion
 */

const fs = require('fs');
const path = require('path');
const { validateContentOrder, updateNotionValidationProperty } = require('./validate-content-order.cjs');

/**
 * Extract page ID from metadata JSON file or filename
 */
function getPageId(htmlFilePath) {
  // Try to read companion .meta.json file
  const metaPath = htmlFilePath.replace('.html', '.meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.pageId) return meta.pageId;
    } catch (e) {
      // Ignore JSON parse errors
    }
  }
  
  // Try to extract from HTML file content (Notion page ID in comments or metadata)
  try {
    const html = fs.readFileSync(htmlFilePath, 'utf-8');
    
    // Look for page ID in HTML comments
    const commentMatch = html.match(/<!--\s*Notion Page ID:\s*([a-f0-9-]{32,36})\s*-->/i);
    if (commentMatch) return commentMatch[1];
    
    // Look for page ID in meta tags
    const metaMatch = html.match(/<meta\s+name="notion-page-id"\s+content="([a-f0-9-]{32,36})"/i);
    if (metaMatch) return metaMatch[1];
  } catch (e) {
    // Ignore read errors
  }
  
  return null;
}

/**
 * Batch validate all HTML files in a directory
 */
async function batchValidate(directory, updateNotion = false) {
  console.log(`🔍 Batch Content Validation\n`);
  console.log(`Directory: ${directory}\n`);
  if (updateNotion) {
    console.log(`📝 Update Notion: ENABLED (will update Validation properties)\n`);
  }
  
  // Find all HTML files
  const files = fs.readdirSync(directory)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(directory, f));
  
  console.log(`Found ${files.length} HTML files\n`);
  
  if (files.length === 0) {
    console.log('No HTML files found. Exiting.');
    return;
  }
  
  const results = [];
  let validated = 0;
  let skipped = 0;
  let updated = 0;
  
  for (const file of files) {
    const basename = path.basename(file);
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 ${basename}`);
    console.log('='.repeat(80) + '\n');
    
    // Get page ID
    const pageId = getPageId(file);
    
    if (!pageId) {
      console.log('⚠️  SKIPPED: No page ID found in metadata or HTML\n');
      skipped++;
      continue;
    }
    
    console.log(`Page ID: ${pageId}\n`);
    
    try {
      const result = await validateContentOrder(file, pageId);
      results.push({
        file: basename,
        pageId,
        ...result
      });
      validated++;
      
      // Update Notion if requested
      if (updateNotion && result.similarity !== undefined) {
        console.log('\n📝 Updating Notion page properties...');
        const success = await updateNotionValidationProperty(pageId, result);
        if (success) updated++;
      }
      
      // Brief pause to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, updateNotion ? 1000 : 500));
      
    } catch (error) {
      console.error(`\n❌ ERROR: ${error.message}\n`);
      results.push({
        file: basename,
        pageId,
        success: false,
        error: error.message
      });
    }
  }
  
  // Summary report
  console.log('\n\n' + '='.repeat(80));
  console.log('📊 BATCH VALIDATION SUMMARY');
  console.log('='.repeat(80) + '\n');
  
  console.log(`Total files: ${files.length}`);
  console.log(`Validated: ${validated}`);
  console.log(`Skipped: ${skipped}`);
  if (updateNotion) {
    console.log(`Updated in Notion: ${updated}`);
  }
  console.log('');
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');
  
  if (failed > 0) {
    console.log('Failed validations:\n');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  ${r.file}`);
      if (r.error) {
        console.log(`    Error: ${r.error}`);
      } else {
        if (r.missing > 0) console.log(`    - ${r.missing} segments missing`);
        if (r.extra > 0) console.log(`    - ${r.extra} extra segments`);
        if (r.orderIssues > 0) console.log(`    - ${r.orderIssues} order issues`);
        if (r.similarity < 95) console.log(`    - Similarity: ${r.similarity.toFixed(1)}%`);
      }
      console.log('');
    });
  }
  
  // Calculate average similarity for passed validations
  const passedResults = results.filter(r => r.success && r.similarity);
  if (passedResults.length > 0) {
    const avgSimilarity = passedResults.reduce((sum, r) => sum + r.similarity, 0) / passedResults.length;
    console.log(`Average similarity (passed): ${avgSimilarity.toFixed(1)}%`);
  }
  
  console.log('');
  
  return {
    total: files.length,
    validated,
    skipped,
    passed,
    failed,
    results
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  // Check for --update-notion flag
  const updateNotion = args.includes('--update-notion');
  const filteredArgs = args.filter(arg => arg !== '--update-notion');
  
  const directory = filteredArgs[0] || '../pages/updated-pages';
  const dirPath = path.resolve(directory);
  
  if (!fs.existsSync(dirPath)) {
    console.error(`Error: Directory not found: ${dirPath}`);
    console.error('\nUsage: node batch-validate-content.cjs [directory] [--update-notion]');
    console.error('Options:');
    console.error('  --update-notion  Update Notion page Validation properties with results');
    process.exit(1);
  }
  
  if (!fs.statSync(dirPath).isDirectory()) {
    console.error(`Error: Not a directory: ${dirPath}`);
    process.exit(1);
  }
  
  batchValidate(dirPath, updateNotion)
    .then(result => {
      process.exit(result.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error.message);
      if (process.env.SN2N_EXTRA_DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

module.exports = { batchValidate };
