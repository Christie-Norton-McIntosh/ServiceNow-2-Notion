#!/usr/bin/env node

/**
 * Scan Notion database for pages with blank Validation properties
 * This uses the same credentials and setup as the main server
 * 
 * Usage:
 *   cd server && node scan-blank-validation.cjs [--fix]
 * 
 * Options:
 *   --fix    Auto-save blank validation pages to pages-to-update/
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// Use same env loading as server
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const shouldFix = process.argv.includes('--fix');

async function scanForBlankValidation() {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 SCANNING FOR PAGES WITH BLANK VALIDATION`);
  console.log(`   Mode: ${shouldFix ? 'FIX (will auto-save pages)' : 'SCAN ONLY (no files saved)'}`);
  console.log(`${'='.repeat(80)}\n`);

  // Get database ID from environment or use test against a known page
  // Strategy: Query recent pages and check their parent database
  console.log(`📋 Fetching sample page to find database ID...`);
  
  let databaseId = null;
  
  // Try to search for any page to get database ID
  try {
    const searchResponse = await notion.search({
      filter: { property: 'object', value: 'page' },
      page_size: 1
    });
    
    if (searchResponse.results.length > 0) {
      const samplePage = searchResponse.results[0];
      if (samplePage.parent && samplePage.parent.type === 'database_id') {
        databaseId = samplePage.parent.database_id;
        console.log(`✅ Found database ID: ${databaseId}\n`);
      }
    }
  } catch (searchError) {
    console.error(`❌ Failed to search pages: ${searchError.message}`);
  }

  if (!databaseId) {
    console.error(`❌ Could not determine database ID`);
    console.error(`   Please set NOTION_DATABASE_ID in .env file`);
    console.error(`   Or provide it as argument: node scan-blank-validation.cjs <database-id>`);
    process.exit(1);
  }

  // Fetch all pages from database
  console.log(`📥 Fetching pages from database...`);
  let allPages = [];
  let hasMore = true;
  let startCursor = undefined;
  let fetchCount = 0;

  try {
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: startCursor,
        page_size: 100
      });

      allPages.push(...response.results);
      fetchCount += response.results.length;
      hasMore = response.has_more;
      startCursor = response.next_cursor;

      process.stdout.write(`\r📥 Fetched ${fetchCount} pages...`);
      
      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    console.log(`\n✅ Fetched ${allPages.length} total pages\n`);
  } catch (queryError) {
    console.error(`\n❌ Error querying database: ${queryError.message}`);
    if (queryError.code === 'object_not_found') {
      console.error(`   Database not found - check integration permissions`);
    }
    process.exit(1);
  }

  // Filter pages with blank Validation property
  console.log(`🔍 Analyzing Validation properties...\n`);
  
  const blankPages = [];
  const validPages = [];
  const stats = {
    total: allPages.length,
    blank: 0,
    valid: 0,
    errors: 0
  };

  for (const page of allPages) {
    try {
      const title = page.properties.Name?.title?.[0]?.text?.content || 'Untitled';
      const validationProp = page.properties.Validation;
      
      // Check if blank
      const isBlank = !validationProp || 
                      !validationProp.rich_text || 
                      validationProp.rich_text.length === 0 ||
                      (validationProp.rich_text.length === 1 && 
                       (!validationProp.rich_text[0].text || 
                        !validationProp.rich_text[0].text.content ||
                        validationProp.rich_text[0].text.content.trim() === ''));
      
      if (isBlank) {
        stats.blank++;
        blankPages.push({
          id: page.id,
          title,
          url: page.url,
          sourceUrl: page.properties['Source URL']?.url || 'N/A',
          created: page.created_time,
          lastEdited: page.last_edited_time
        });
      } else {
        stats.valid++;
        validPages.push({ id: page.id, title });
      }
    } catch (pageError) {
      stats.errors++;
      console.error(`⚠️  Error processing page: ${pageError.message}`);
    }
  }

  // Display results
  console.log(`${'='.repeat(80)}`);
  console.log(`📊 SCAN RESULTS`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Total pages:       ${stats.total}`);
  console.log(`   ✅ Valid:          ${stats.valid} (${((stats.valid / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   ❌ Blank:          ${stats.blank} (${((stats.blank / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   ⚠️  Errors:         ${stats.errors}`);
  console.log(`${'='.repeat(80)}\n`);

  if (stats.blank === 0) {
    console.log(`✅ No pages with blank validation found!`);
    return;
  }

  // Display blank pages
  console.log(`📋 PAGES WITH BLANK VALIDATION:\n`);
  
  blankPages.slice(0, 20).forEach((page, idx) => {
    console.log(`${idx + 1}. "${page.title}"`);
    console.log(`   ID: ${page.id}`);
    console.log(`   Source: ${page.sourceUrl}`);
    console.log(`   Created: ${page.created}`);
  });
  
  if (blankPages.length > 20) {
    console.log(`\n   ... and ${blankPages.length - 20} more pages\n`);
  }

  // Save list to file
  const listFile = path.join(__dirname, '../patch/pages/blank-validation-list.json');
  fs.writeFileSync(listFile, JSON.stringify(blankPages, null, 2), 'utf-8');
  console.log(`\n💾 Saved full list to: patch/pages/blank-validation-list.json`);

  if (!shouldFix) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`⚡ NEXT STEPS:`);
    console.log(`   1. Review the blank-validation-list.json file`);
    console.log(`   2. Re-run with --fix flag to auto-save pages:`);
    console.log(`      node scan-blank-validation.cjs --fix`);
    console.log(`   3. Or manually re-extract pages using ServiceNow userscript`);
    console.log(`${'='.repeat(80)}\n`);
    return;
  }

  // Auto-save pages with --fix flag
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔧 FIXING: Auto-saving ${blankPages.length} pages...`);
  console.log(`${'='.repeat(80)}\n`);

  const outputDir = path.join(__dirname, '../patch/pages/pages-to-update');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let savedCount = 0;
  let skipCount = 0;

  for (const pageInfo of blankPages) {
    try {
      console.log(`\n📄 Processing: "${pageInfo.title}"`);
      
      // Fetch page blocks to check if it has content
      const blocksResponse = await notion.blocks.children.list({
        block_id: pageInfo.id,
        page_size: 10 // Just check if ANY content exists
      });

      if (!blocksResponse.results || blocksResponse.results.length === 0) {
        console.log(`   ⚠️  SKIPPED: Page has no content blocks`);
        skipCount++;
        continue;
      }

      console.log(`   ✓  Has ${blocksResponse.results.length}+ blocks`);

      // Create placeholder file
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const sanitizedTitle = pageInfo.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
      const filename = `${sanitizedTitle}-retroactive-scan-${timestamp}.html`;
      const filepath = path.join(outputDir, filename);

      const htmlContent = `<!--
Retroactive Scan: Page with blank Validation property detected
Page ID: ${pageInfo.id}
Page URL: ${pageInfo.url}
Page Title: ${pageInfo.title}
Source URL: ${pageInfo.sourceUrl}
Created: ${pageInfo.created}
Last Edited: ${pageInfo.lastEdited}
Scanned: ${new Date().toISOString()}

Status: Page exists in Notion with ${blocksResponse.results.length}+ blocks but has blank Validation property
Issue: Page was likely created before validation was enabled (SN2N_VALIDATE_OUTPUT=1)

REQUIRED ACTION:
1. Navigate to Source URL in ServiceNow
2. Use ServiceNow-2-Notion userscript to re-extract
3. Userscript will PATCH this page with proper validation
-->

<html>
<head>
  <meta charset="utf-8">
  <title>${pageInfo.title}</title>
</head>
<body>
  <h1>⚠️ Page Requires Re-Extraction</h1>
  
  <div style="background: #fff3cd; border: 2px solid #ffc107; padding: 20px; margin: 20px 0;">
    <h2>Validation Status: BLANK</h2>
    <p>This page was created in Notion but never validated. It may have incomplete or incorrect content.</p>
  </div>

  <h2>Page Information</h2>
  <ul>
    <li><strong>Notion Page ID:</strong> ${pageInfo.id}</li>
    <li><strong>Notion URL:</strong> <a href="${pageInfo.url}">${pageInfo.url}</a></li>
    <li><strong>Source URL:</strong> <a href="${pageInfo.sourceUrl}">${pageInfo.sourceUrl}</a></li>
    <li><strong>Created:</strong> ${pageInfo.created}</li>
    <li><strong>Last Edited:</strong> ${pageInfo.lastEdited}</li>
    <li><strong>Content:</strong> ${blocksResponse.results.length}+ blocks exist in Notion</li>
  </ul>

  <h2>How to Fix</h2>
  <ol>
    <li>Open ServiceNow: <a href="${pageInfo.sourceUrl}">Click here</a></li>
    <li>Click the ServiceNow-2-Notion userscript button</li>
    <li>Select "Update Existing Page" (PATCH)</li>
    <li>The page will be re-validated and updated</li>
  </ol>

  <h2>Why This Happened</h2>
  <p>Possible causes:</p>
  <ul>
    <li>Page created before validation was enabled (SN2N_VALIDATE_OUTPUT=1)</li>
    <li>Validation failed silently during original creation</li>
    <li>Property update failed without throwing error</li>
    <li>Server was not running with validation enabled</li>
  </ul>
</body>
</html>
`;

      fs.writeFileSync(filepath, htmlContent, 'utf-8');
      console.log(`   ✅ SAVED: ${filename}`);
      savedCount++;

      // Rate limit protection
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (saveError) {
      console.error(`   ❌ ERROR: ${saveError.message}`);
      skipCount++;
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ FIXING COMPLETE`);
  console.log(`${'='.repeat(80)}`);
  console.log(`   Pages processed:   ${blankPages.length}`);
  console.log(`   ✅ Saved:          ${savedCount}`);
  console.log(`   ⚠️  Skipped:        ${skipCount}`);
  console.log(`\n   📁 Location: patch/pages/pages-to-update/`);
  console.log(`\n   ⚡ Next: Use ServiceNow userscript to re-extract these pages`);
  console.log(`${'='.repeat(80)}\n`);
}

// Run the scan
scanForBlankValidation().catch(error => {
  console.error(`\n❌ FATAL ERROR: ${error.message}`);
  console.error(`   Stack: ${error.stack}`);
  process.exit(1);
});
