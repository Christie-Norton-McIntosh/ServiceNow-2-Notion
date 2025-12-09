#!/usr/bin/env node

/**
 * Test DRY-RUN on sample pages to validate fixes
 * Tests all v11.0.184 fixes:
 * - Inline code parentheses normalization
 * - Images in tables excluded from ContentComparison
 * - Inline code excluded from Notion AUDIT
 * - span.title treated as headings
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const SAMPLE_PAGES = [
  'create-a-purchase-order-2025-12-07T09-35-26.html',
  'predictive-intelligence-for-incident-management-2025-12-07T09-00-44.html',
  'add-a-user-or-asset-to-a-contract-2025-12-07T09-29-52.html',
];

const PAGES_DIR = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update';
const SERVER_URL = 'http://localhost:3004';

async function dryRunPage(htmlFile) {
  return new Promise((resolve, reject) => {
    try {
      const filePath = path.join(PAGES_DIR, htmlFile);
      const contentHtml = fs.readFileSync(filePath, 'utf8');

      // Extract page ID from HTML comments
      const idMatch = contentHtml.match(/Page ID:\s*([a-f0-9-]+)/);
      const pageId = idMatch ? idMatch[1] : null;

      // Extract expected counts from HTML comments
      const blockCountMatch = contentHtml.match(/Block Count \(expected\):\s*(\d+)/);
      const expectedBlocks = blockCountMatch ? parseInt(blockCountMatch[1]) : null;

      console.log(`\n${'='.repeat(80)}`);
      console.log(`📋 Testing: ${htmlFile}`);
      console.log(`   Page ID: ${pageId}`);
      console.log(`   Expected blocks: ${expectedBlocks}`);
      console.log(`   HTML size: ${contentHtml.length} bytes`);

      // Make dry-run request
      const postData = JSON.stringify({
        title: htmlFile.split('-2025')[0].replace(/-/g, ' '),
        content: contentHtml,
        dryRun: true,
      });

      const req = http.request(
        {
          hostname: 'localhost',
          port: 3004,
          path: '/api/W2N',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const response = JSON.parse(data);
              const result = response.data || response;

              console.log(`   ✅ DRY-RUN RESPONSE:`);
              console.log(`      • Blocks created: ${result.children?.length || 0}`);
              console.log(`      • Has videos: ${result.hasVideos || false}`);

              if (result.audit) {
                console.log(`   📊 AUDIT STATS:`);
                console.log(
                  `      • Expected text: ${result.audit.expectedLength || 'N/A'} chars`
                );
                console.log(`      • Actual text: ${result.audit.actualLength || 'N/A'} chars`);
                console.log(`      • Coverage: ${result.audit.coveragePercent || 'N/A'}%`);
              }

              if (result.contentComparison) {
                console.log(`   📋 CONTENT COMPARISON:`);
                console.log(`      • Paragraphs: ${result.contentComparison.sourceParagraphs || 0} → ${result.contentComparison.notionParagraphs || 0}`);
                console.log(
                  `      • Headings: ${result.contentComparison.sourceHeadings || 0} → ${result.contentComparison.notionHeadings || 0}`
                );
                console.log(
                  `      • Tables: ${result.contentComparison.sourceTables || 0} → ${result.contentComparison.notionTables || 0}`
                );
                console.log(
                  `      • Images: ${result.contentComparison.sourceImages || 0} → ${result.contentComparison.notionImages || 0}`
                );
                console.log(
                  `      • Callouts: ${result.contentComparison.sourceCallouts || 0} → ${result.contentComparison.notionCallouts || 0}`
                );
              }

              resolve({
                file: htmlFile,
                success: true,
                blocks: result.children?.length || 0,
                audit: result.audit,
                contentComparison: result.contentComparison,
              });
            } catch (e) {
              console.log(`   ❌ ERROR parsing response:`, e.message);
              resolve({ file: htmlFile, success: false, error: e.message });
            }
          });
        }
      );

      req.on('error', (error) => {
        console.log(`   ❌ ERROR making request:`, error.message);
        resolve({ file: htmlFile, success: false, error: error.message });
      });

      req.write(postData);
      req.end();
    } catch (error) {
      console.log(`   ❌ ERROR:`, error.message);
      resolve({ file: htmlFile, success: false, error: error.message });
    }
  });
}

async function main() {
  console.log(`\n🧪 DRY-RUN TEST SUITE - v11.0.184 Validation Fixes`);
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Sample pages: ${SAMPLE_PAGES.length}`);

  const results = [];
  for (const page of SAMPLE_PAGES) {
    const result = await dryRunPage(page);
    results.push(result);
    // Add delay between requests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 SUMMARY:`);
  console.log(`   Total pages tested: ${results.length}`);
  console.log(
    `   Successful: ${results.filter((r) => r.success).length}/${results.length}`
  );

  // Check for improvements
  let improvementCount = 0;
  results.forEach((r) => {
    if (r.success && r.audit) {
      const coverage = parseFloat(r.audit.coveragePercent);
      if (coverage >= 90 && coverage <= 110) {
        improvementCount++;
        console.log(
          `   ✅ ${r.file}: AUDIT coverage ${coverage}% (PASS - 90-110% range)`
        );
      } else {
        console.log(
          `   ⚠️  ${r.file}: AUDIT coverage ${coverage}% (outside 90-110% range)`
        );
      }
    }
  });

  console.log(`\n📈 Improvements: ${improvementCount}/${results.filter((r) => r.audit).length} pages with good AUDIT coverage`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(console.error);
