#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

async function testImagePositioning() {
  const fixture = fs.readFileSync(
    '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/view-ibm-pvu-mappings-for-the-legacy-ibm-pvu-process-pack-failure-2025-12-09T07-43-16.html',
    'utf-8'
  );

  // Extract just the HTML body (strip the comment header)
  const htmlMatch = fixture.match(/-->[\s\S]*?(<div class="zDocsTopicPageBody"[\s\S]*?)$/);
  const html = htmlMatch ? htmlMatch[1] : fixture;

  console.log('🧪 Testing image positioning fix...\n');
  console.log(`📄 Fixture size: ${html.length} bytes`);

  // Count expected images in source
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  console.log(`🖼️  Expected images in source: ${imgTags.length}`);
  imgTags.forEach((tag, idx) => {
    const srcMatch = tag.match(/src=["']([^"']+)["']/);
    const altMatch = tag.match(/alt=["']([^"']*?)["']/);
    console.log(`   ${idx + 1}. src: ${srcMatch ? srcMatch[1].substring(0, 60) : 'none'}`);
    console.log(`      alt: ${altMatch ? altMatch[1] : 'none'}`);
  });

  try {
    console.log('\n📤 Posting to local proxy for dry-run...');
    const response = await fetch('http://localhost:3004/api/W2N/2c4a89fedba581339d04ddd550d55bdc', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test: Image Positioning',
        contentHtml: html,
        dryRun: true
      })
    });

    if (!response.ok) {
      console.error(`❌ Request failed: ${response.status} ${response.statusText}`);
      return;
    }

    const result = await response.json();
    console.log('\n✅ Dry-run completed successfully\n');

    // Analyze returned children
    const blocks = result.data ? result.data.children : (result.children || result.blocks || []);
    console.log(`📊 Returned top-level blocks: ${blocks.length}`);
    console.log(`📊 Full result keys: ${Object.keys(result).join(', ')}`);
    if (result.data) {
      console.log(`📊 Data keys: ${Object.keys(result.data).join(', ')}`);
    }

    // Find and count images in returned children
    function countImages(blocks, depth = 0) {
      let count = 0;
      let positions = [];
      blocks.forEach((block, idx) => {
        const indent = '  '.repeat(depth);
        if (block.type === 'image') {
          count++;
          const url = block.image?.external?.url || block.image?.file?.url || 'unknown';
          positions.push({ depth, position: idx, url: url.substring(0, 80) });
          console.log(`${indent}[${idx}] 🖼️  Image: ${url.substring(0, 80)}`);
        } else {
          console.log(`${indent}[${idx}] ${block.type}`);
        }
        // Recurse into children
        if (block[block.type]?.children) {
          const childCount = countImages(block[block.type].children, depth + 1);
          count += childCount;
        }
      });
      return count;
    }

    const totalImages = countImages(blocks);
    console.log(`\n✅ Total images found: ${totalImages}`);

    if (totalImages === 2) {
      console.log('✅ SUCCESS: Both images preserved!');
    } else if (totalImages === 1) {
      console.log('⚠️  WARNING: Only 1 image found (expected 2)');
    } else {
      console.log(`❌ FAIL: Unexpected image count: ${totalImages}`);
    }

    // Check audit results
    if (result.audit) {
      console.log(`\n📊 Audit results:`);
      console.log(`   Coverage: ${result.audit.coverageStr}`);
      console.log(`   Status: ${result.audit.passed ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`   Images: ${result.audit.contentAnalysis.imageCount}`);
    }

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
  }
}

testImagePositioning();
