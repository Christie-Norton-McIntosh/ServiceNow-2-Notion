#!/usr/bin/env node

/**
 * Quick validation test for pages-to-update files
 * Tests extraction and reports validation-like issues
 */

const fs = require('fs');
const path = require('path');

// Setup minimal global mocks needed by servicenow.cjs
if (!global.isValidImageUrl) {
  global.isValidImageUrl = function (url) {
    if (!url || typeof url !== 'string') return false;
    return /^(https?:\/\/|data:image\/)/i.test(url.trim());
  };
}

if (!global.isValidNotionUrl) {
  global.isValidNotionUrl = function (url) {
    if (!url || typeof url !== 'string') return false;
    return /^https?:\/\/.+/i.test(url.trim());
  };
}

if (!global.createImageBlock) {
  global.createImageBlock = async function (src, alt = "") {
    if (!src || !global.isValidImageUrl(src)) return null;
    return {
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: src },
        caption: alt ? [{ type: "text", text: { content: alt } }] : [],
      },
    };
  };
}

if (!global.downloadAndUploadImage) {
  global.downloadAndUploadImage = async function (imageUrl, alt = "image") {
    if (!imageUrl || !global.isValidImageUrl(imageUrl)) return null;
    return "mock-upload-id-" + Math.random().toString(36).substring(7);
  };
}

async function testFile(htmlPath) {
  const filename = path.basename(htmlPath);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${filename}`);
  
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    
    // Extract Page ID from metadata
    const pageIdMatch = html.match(/Page ID:\s*([a-f0-9-]+)/i);
    const pageId = pageIdMatch ? pageIdMatch[1] : 'NO_PAGE_ID';
    console.log(`Page ID: ${pageId}`);
    
    const { extractContentFromHtml } = require('./services/servicenow.cjs');
    
    const t0 = Date.now();
    const result = await extractContentFromHtml(html);
    const dt = Date.now() - t0;
    
    const blocks = result && result.blocks ? result.blocks : [];
    console.log(`Extraction time: ${dt}ms`);
    console.log(`Blocks generated: ${blocks.length}`);
    console.log(`Has videos: ${!!result.hasVideos}`);
    
    // Basic validation checks
    const errors = [];
    
    // Check for marker leakage
    let markerCount = 0;
    JSON.stringify(blocks, (key, value) => {
      if (typeof value === 'string' && value.includes('sn2n:marker')) {
        markerCount++;
      }
      return value;
    });
    if (markerCount > 0) {
      errors.push(`Marker leakage: found ${markerCount} instances of 'sn2n:marker' in blocks`);
    }
    
    // Check for invalid block types
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || !block.type) {
        errors.push(`Block ${i}: missing or invalid type`);
      } else {
        // Check if type key exists in block
        if (!block[block.type]) {
          errors.push(`Block ${i}: type '${block.type}' does not have corresponding data key`);
        }
      }
    }
    
    // Check for empty rich_text arrays in blocks that require text
    const textRequiredTypes = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'callout'];
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block && block.type && textRequiredTypes.includes(block.type)) {
        const data = block[block.type];
        if (data && (!data.rich_text || data.rich_text.length === 0)) {
          errors.push(`Block ${i} (${block.type}): empty rich_text array`);
        }
      }
    }
    
    if (errors.length === 0) {
      console.log(`✅ VALIDATION PASSED`);
      return { status: 'passed', filename, pageId, blockCount: blocks.length };
    } else {
      console.log(`❌ VALIDATION FAILED (${errors.length} errors)`);
      errors.forEach((err, idx) => {
        console.log(`  ${idx + 1}. ${err}`);
      });
      return { status: 'failed', filename, pageId, blockCount: blocks.length, errors };
    }
    
  } catch (error) {
    console.log(`❌ EXTRACTION ERROR`);
    console.log(`  ${error.message}`);
    if (error.stack) {
      console.log(`  Stack: ${error.stack.split('\n')[1]?.trim() || ''}`);
    }
    return { status: 'error', filename, error: error.message };
  }
}

async function main() {
  const pagesDir = path.join(__dirname, '../patch/pages-to-update');
  const files = fs.readdirSync(pagesDir)
    .filter(f => f.endsWith('.html'))
    .map(f => path.join(pagesDir, f));
  
  console.log(`Found ${files.length} HTML files to test`);
  
  const results = {
    passed: [],
    failed: [],
    error: []
  };
  
  for (const file of files) {  // Test ALL files
    const result = await testFile(file);
    results[result.status].push(result);
  }
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`VALIDATION SUMMARY (${files.length} files)`);
  console.log(`${'='.repeat(70)}`);
  console.log(`✅ Passed:  ${results.passed.length}`);
  console.log(`❌ Failed:  ${results.failed.length}`);
  console.log(`⚠️  Errors:  ${results.error.length}`);
  
  if (results.failed.length > 0) {
    console.log(`\nFailed files:`);
    results.failed.forEach((r, idx) => {
      console.log(`  ${idx + 1}. ${r.filename}`);
      r.errors.forEach(err => console.log(`      - ${err}`));
    });
  }
  
  if (results.error.length > 0) {
    console.log(`\nError files:`);
    results.error.forEach((r, idx) => {
      console.log(`  ${idx + 1}. ${r.filename}: ${r.error}`);
    });
  }
  
  process.exit(results.failed.length > 0 || results.error.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
