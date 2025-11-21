#!/usr/bin/env node

/**
 * Find Notion pages with blank Validation properties and auto-save them for re-extraction
 * 
 * This script addresses the issue where pages were created successfully but have empty
 * Validation properties (typically pages created before SN2N_VALIDATE_OUTPUT=1 was enabled).
 * 
 * Usage:
 *   node server/find-blank-validation-pages.cjs [--dry-run]
 * 
 * Options:
 *   --dry-run    List pages that would be saved without actually saving them
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
// Default database ID - format with hyphens for Notion API
const DATABASE_ID = process.env.NOTION_DATABASE_ID || '133fdab3-6ce8-80d1-b0c2-fd8b97c9ef99';
const isDryRun = process.argv.includes('--dry-run');

async function findBlankValidationPages() {
  console.log(`\n========================================`);
  console.log(`🔍 FINDING PAGES WITH BLANK VALIDATION`);
  console.log(`   Database: ${DATABASE_ID}`);
  console.log(`   Mode: ${isDryRun ? 'DRY-RUN (no files will be saved)' : 'LIVE (will auto-save pages)'}`);
  console.log(`========================================\n`);

  let allPages = [];
  let hasMore = true;
  let startCursor = undefined;
  let pageCount = 0;

  // Fetch all pages from the database
  while (hasMore) {
    try {
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        start_cursor: startCursor,
        page_size: 100
      });

      allPages.push(...response.results);
      pageCount += response.results.length;
      hasMore = response.has_more;
      startCursor = response.next_cursor;

      console.log(`📥 Fetched ${pageCount} pages so far...`);
    } catch (error) {
      console.error(`❌ Error fetching pages: ${error.message}`);
      break;
    }
  }

  console.log(`\n✅ Fetched ${allPages.length} total pages from database\n`);

  // Filter pages with blank Validation property
  const blankValidationPages = allPages.filter(page => {
    const validationProp = page.properties.Validation;
    
    // Check if Validation property is missing, null, or empty
    const isBlank = !validationProp || 
                    !validationProp.rich_text || 
                    validationProp.rich_text.length === 0 ||
                    (validationProp.rich_text.length === 1 && 
                     (!validationProp.rich_text[0].text || 
                      !validationProp.rich_text[0].text.content ||
                      validationProp.rich_text[0].text.content.trim() === ''));
    
    return isBlank;
  });

  console.log(`========================================`);
  console.log(`📊 RESULTS:`);
  console.log(`   Total pages: ${allPages.length}`);
  console.log(`   Blank validation: ${blankValidationPages.length}`);
  console.log(`   Percentage: ${((blankValidationPages.length / allPages.length) * 100).toFixed(1)}%`);
  console.log(`========================================\n`);

  if (blankValidationPages.length === 0) {
    console.log(`✅ No pages with blank validation found!`);
    return;
  }

  // Create output directory
  const outputDir = path.join(__dirname, '../patch/pages/pages-to-update');
  if (!isDryRun && !fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`📁 Created output directory: ${outputDir}\n`);
  }

  let savedCount = 0;
  let skippedCount = 0;

  // Process each page
  for (const page of blankValidationPages) {
    const pageId = page.id;
    const title = page.properties.Name?.title?.[0]?.text?.content || 'untitled';
    const url = page.url;
    const sourceUrl = page.properties['Source URL']?.url || 'N/A';

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📄 Page: "${title}"`);
    console.log(`   ID: ${pageId}`);
    console.log(`   URL: ${url}`);
    console.log(`   Source: ${sourceUrl}`);

    // Fetch page blocks to get content
    let blocks = [];
    let blockCursor = undefined;
    let blockHasMore = true;

    try {
      while (blockHasMore) {
        const blockResponse = await notion.blocks.children.list({
          block_id: pageId,
          start_cursor: blockCursor,
          page_size: 100
        });

        blocks.push(...blockResponse.results);
        blockHasMore = blockResponse.has_more;
        blockCursor = blockResponse.next_cursor;
      }

      console.log(`   Blocks: ${blocks.length}`);

      if (blocks.length === 0) {
        console.log(`   ⚠️  SKIPPED: Page has no content blocks`);
        skippedCount++;
        continue;
      }

      if (isDryRun) {
        console.log(`   ✓  Would save this page (dry-run mode)`);
        savedCount++;
        continue;
      }

      // Generate filename
      const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
      const sanitizedTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60);
      const filename = `${sanitizedTitle}-blank-validation-${timestamp}.html`;
      const filepath = path.join(outputDir, filename);

      // Create HTML placeholder (we don't have original HTML, so create a marker file)
      const htmlContent = `<!--
Auto-saved: Blank Validation property detected during retroactive scan
Page ID: ${pageId}
Page URL: ${url}
Page Title: ${title}
Created: ${new Date().toISOString()}
Source URL: ${sourceUrl}
Blocks in page: ${blocks.length}

NOTE: Original HTML not available - this page was created before validation was enabled.
To re-extract this page:
1. Navigate to source URL in ServiceNow
2. Use ServiceNow-2-Notion userscript to extract content
3. The userscript will automatically send HTML with proper validation

Validation Status: Property is blank/empty in Notion
Issue: Page was likely created without SN2N_VALIDATE_OUTPUT=1 enabled
Action Required: Manual re-extraction using userscript
-->

<html>
<head>
  <meta charset="utf-8">
  <title>${title}</title>
</head>
<body>
  <h1>Page Requires Re-Extraction</h1>
  <p>This page has ${blocks.length} blocks in Notion but no validation property.</p>
  <p><strong>Source URL:</strong> <a href="${sourceUrl}">${sourceUrl}</a></p>
  <p><strong>Action:</strong> Navigate to the source URL and use the ServiceNow-2-Notion userscript to re-extract this page.</p>
  
  <h2>Page Metadata</h2>
  <ul>
    <li><strong>Notion Page ID:</strong> ${pageId}</li>
    <li><strong>Notion URL:</strong> <a href="${url}">${url}</a></li>
    <li><strong>Blocks:</strong> ${blocks.length}</li>
    <li><strong>Detected:</strong> ${new Date().toISOString()}</li>
  </ul>
</body>
</html>
`;

      fs.writeFileSync(filepath, htmlContent, 'utf-8');
      console.log(`   ✅ SAVED: ${filename}`);
      savedCount++;

    } catch (error) {
      console.error(`   ❌ ERROR: ${error.message}`);
      skippedCount++;
    }

    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // Final summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 FINAL SUMMARY`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Total pages scanned: ${allPages.length}`);
  console.log(`   Blank validation found: ${blankValidationPages.length}`);
  console.log(`   ${isDryRun ? 'Would save' : 'Saved'}: ${savedCount}`);
  console.log(`   Skipped: ${skippedCount}`);
  if (!isDryRun && savedCount > 0) {
    console.log(`\n   📁 Saved to: ${outputDir}`);
    console.log(`\n   ⚡ Next steps:`);
    console.log(`      1. Review pages in pages-to-update/`);
    console.log(`      2. Navigate to Source URLs in ServiceNow`);
    console.log(`      3. Use userscript to re-extract content`);
    console.log(`      4. Userscript will PATCH with proper validation`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

// Run the script
findBlankValidationPages().catch(error => {
  console.error(`\n❌ FATAL ERROR: ${error.message}`);
  console.error(`   Stack: ${error.stack}`);
  process.exit(1);
});
