#!/usr/bin/env node
/**
 * Validate Notion pages for marker leaks and update Validation property
 * This script:
 * 1. Scans pages for visible (sn2n:marker) tokens
 * 2. Optionally cleans markers if --fix flag is used
 * 3. Re-validates after cleanup to ensure markers are gone
 * 4. Updates the Validation property in Notion with results
 * 
 * Usage:
 *   node scripts/validate-and-update-pages.cjs              # Validate only
 *   node scripts/validate-and-update-pages.cjs --fix        # Validate + clean + update
 *   node scripts/validate-and-update-pages.cjs --dry-run    # Don't update properties
 *   node scripts/validate-and-update-pages.cjs --pageIds=id1,id2  # Specific pages
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  fix: args.includes('--fix'),
  dryRun: args.includes('--dry-run'),
  pageIds: null
};

// Extract page IDs if provided
const pageIdsArg = args.find(arg => arg.startsWith('--pageIds='));
if (pageIdsArg) {
  options.pageIds = pageIdsArg.split('=')[1].split(',').map(id => id.trim());
}

// Default list of pages with previous marker leak issues
const defaultPageIds = [
  '2aaa89fedba58115936cc71b949d5d5c',
  '2aaa89fedba581c48906ed3b45a97945',
  '2aaa89fedba5818baf46d77cf296f891',
  '2aaa89fedba5818da82cc7630b2c160b',
  '2aaa89fedba581a4a980cc876a07ba7f',
  '2aaa89fedba5817b98a7fe0cf7b95eb6',
  '2aaa89fedba581d0bb2ddd58f9841200',
  '2aaa89fedba58179808dfc462304d921',
  '2aaa89fedba58198beeaf653046eae41',
  '2aaa89fedba5812b808acfb90f948a67',
  '2a9a89fedba581bf82e7dabe4bf38080',
  '2a9a89fedba58104bfc5e66199b9f88d',
  '2a9a89fedba58106850ddca8a5f31728',
  '2a9a89fedba58142a8facd661480fdfd',
  '2a9a89fedba581d88d33c93e714ee15d',
  '2a9a89fedba58171b6f0e9d103aa4677',
  '2a9a89fedba58154a5eae1c4ea95d366',
  '2a9a89fedba581578066e75d31378a97',
  '2a9a89fedba581f3887edae4b8352334',
  '2a9a89fedba5810ea8c3e24f30c511ff',
  '2a9a89fedba581d89ec2fef36e56c18a',
  '2a9a89fedba581758f76dd9da46a3219',
  '2a9a89fedba58184bf4cc8cf9b02a485',
  '2a9a89fedba581619a71c2c79c193d44',
  '2a9a89fedba58138ad34fcd0f606b308',
  '2a9a89fedba581a391bae7ce7f71fe2c',
  '2a9a89fedba5815a80a4fccebedf500f',
  '2a9a89fedba5815aa083e48081b66c27',
  '2a9a89fedba581ac8b57f07a430de7fb',
  '2a9a89fedba5819c9f23d6fbd52d7540',
  '2a9a89fedba581279dfce67e6659ad29',
  '2a9a89fedba58192aa5be507b5e4ae03',
  '2a9a89fedba581ccacccc97f9c622d39',
  '2a9a89fedba581babcd0d878b535790d',
  '2a9a89fedba5815f8350dca1b45e2d79',
  '2a9a89fedba581be8213fc756a2868c4',
  '2a9a89fedba581b8a4bcf25f29e1d785',
  '2a9a89fedba581b28abde0bdecc6e453',
  '2a9a89fedba581568164c8e81375b778',
  '2a8a89fedba58132b34bc945cf540ca4',
  '2a8a89fedba581c7b8f0e53d173cc371',
  '2a8a89fedba581b787fcd3b445784238',
  '2a8a89fedba58108a7e6f277b2efb33f',
  '2a8a89fedba581ca9d87ec66f8d644a9',
  '2a8a89fedba581d8afa0c8bd63a5065f',
  '2a8a89fedba5818abe0fd1e89bb55bc0',
  '2a8a89fedba581218d89cc93a9ad4109',
  '2a8a89fedba581be89d7f56daf840215',
  '2a8a89fedba581f2a30de64fae587d35',
  '2a8a89fedba581afa071e008f00d5118',
];

const markerPattern = /\(sn2n:[a-z0-9\-_]+\)/gi;

/**
 * Scan a page and all its blocks for marker leaks
 */
async function scanForMarkers(pageId) {
  const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  
  try {
    const page = await notion.pages.retrieve({ page_id: formattedId });
    const title = page.properties?.Name?.title?.[0]?.plain_text || 
                  page.properties?.title?.title?.[0]?.plain_text || 'Unknown';
    
    const queue = [formattedId];
    const visited = new Set();
    const leaks = [];
    
    async function listChildren(blockId, cursor, retries = 3) {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          return await notion.blocks.children.list({
            block_id: blockId,
            page_size: 100,
            start_cursor: cursor,
          });
        } catch (error) {
          const retryable = error.status === 429 || 
                           /ECONNRESET|ETIMEDOUT|timeout|socket hang up/i.test(error.message || '');
          if (retryable && attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw error;
        }
      }
    }
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      let cursor = undefined;
      do {
        const res = await listChildren(current, cursor);
        cursor = res.has_more ? res.next_cursor : undefined;
        const children = res.results || [];
        
        for (const child of children) {
          try {
            const blockType = child.type;
            const payload = child[blockType] || {};
            
            // Check rich_text for markers
            if (Array.isArray(payload.rich_text)) {
              const plainText = payload.rich_text.map(rt => rt?.text?.content || '').join('');
              const matches = plainText.match(markerPattern);
              if (matches) {
                leaks.push({
                  blockId: child.id,
                  blockType,
                  markers: matches,
                  richText: payload.rich_text
                });
              }
            }
            
            // Check table cells for markers
            if (blockType === 'table_row' && child.table_row && Array.isArray(child.table_row.cells)) {
              for (const [cellIdx, cell] of child.table_row.cells.entries()) {
                if (Array.isArray(cell)) {
                  const cellText = cell.map(rt => rt?.text?.content || '').join('');
                  const matches = cellText.match(markerPattern);
                  if (matches) {
                    leaks.push({
                      blockId: child.id,
                      blockType: 'table_row',
                      cellIndex: cellIdx,
                      markers: matches,
                      cells: child.table_row.cells
                    });
                  }
                }
              }
            }
            
            if (child.has_children) {
              queue.push(child.id);
            }
          } catch (error) {
            // Continue on individual block errors
          }
        }
      } while (cursor);
    }
    
    return {
      pageId: formattedId,
      title,
      valid: leaks.length === 0,
      leakCount: leaks.length,
      uniqueMarkers: [...new Set(leaks.flatMap(l => l.markers))].length,
      leaks
    };
  } catch (error) {
    return {
      pageId: formattedId,
      title: 'Error',
      valid: false,
      error: error.message,
      leaks: []
    };
  }
}

/**
 * Clean all markers from a page's blocks
 */
async function cleanMarkers(leaks) {
  let cleaned = 0;
  
  for (const leak of leaks) {
    try {
      if (leak.blockType === 'table_row' && leak.cells) {
        // Clean table cells
        const newCells = leak.cells.map(cell => {
          if (!Array.isArray(cell)) return cell;
          return cell.map(rt => {
            if (!rt || !rt.text || typeof rt.text.content !== 'string') return rt;
            const cleanedContent = rt.text.content.replace(markerPattern, '').trim();
            return { ...rt, text: { ...rt.text, content: cleanedContent } };
          }).filter(rt => rt && rt.text && rt.text.content && rt.text.content.length > 0);
        });
        
        await retryOperation(async () => {
          await notion.blocks.update({
            block_id: leak.blockId,
            table_row: { cells: newCells }
          });
        });
        cleaned++;
      } else if (leak.richText) {
        // Clean rich_text blocks
        const newRichText = leak.richText.map(rt => {
          if (!rt || !rt.text || typeof rt.text.content !== 'string') return rt;
          const cleanedContent = rt.text.content.replace(markerPattern, '').trim();
          return { ...rt, text: { ...rt.text, content: cleanedContent } };
        }).filter(rt => rt && rt.text && rt.text.content && rt.text.content.length > 0);
        
        if (newRichText.length > 0) {
          await retryOperation(async () => {
            await notion.blocks.update({
              block_id: leak.blockId,
              [leak.blockType]: { rich_text: newRichText }
            });
          });
          cleaned++;
        }
      }
    } catch (error) {
      console.error(`   ⚠️ Failed to clean block ${leak.blockId}: ${error.message}`);
    }
  }
  
  return cleaned;
}

/**
 * Retry an operation with exponential backoff for conflicts and rate limits
 */
async function retryOperation(operation, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if ((error.code === 'conflict_error' || error.status === 429) && attempt < maxRetries - 1) {
        const delay = 500 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Update the Validation property in Notion
 */
async function updateValidation(pageId, isValid, markerCount = 0) {
  const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  
  const validationText = isValid 
    ? '✅ Validation passed: No marker leaks detected'
    : `❌ Validation failed: 1 critical error(s)\n\n❌ Critical Errors:\n1. Marker leak: ${markerCount} visible sn2n:marker token(s) found`;
  
  try {
    await retryOperation(async () => {
      await notion.pages.update({
        page_id: formattedId,
        properties: {
          Validation: {
            rich_text: [
              {
                type: 'text',
                text: { content: validationText }
              }
            ]
          }
        }
      });
    });
    return true;
  } catch (error) {
    console.error(`   ⚠️ Failed to update Validation property: ${error.message}`);
    return false;
  }
}

/**
 * Process a single page through the full validation workflow
 */
async function processPage(pageId) {
  console.log(`\n🔍 Processing: ${pageId}`);
  
  // Step 1: Initial scan
  const scan1 = await scanForMarkers(pageId);
  
  if (scan1.error) {
    console.log(`   ❌ Error: ${scan1.error}`);
    return { success: false, error: scan1.error };
  }
  
  console.log(`   📄 ${scan1.title}`);
  
  if (scan1.valid) {
    console.log(`   ✅ No markers found`);
    
    if (!options.dryRun) {
      const updated = await updateValidation(pageId, true);
      if (updated) {
        console.log(`   ✅ Updated Validation property`);
      }
    } else {
      console.log(`   ℹ️ Dry run: skipping Validation property update`);
    }
    
    return { success: true, wasClean: true };
  }
  
  // Has markers
  console.log(`   ⚠️ Found ${scan1.leakCount} marker leak(s) (${scan1.uniqueMarkers} unique)`);
  
  if (!options.fix) {
    console.log(`   ℹ️ Use --fix to clean markers automatically`);
    return { success: false, needsFix: true, leakCount: scan1.leakCount };
  }
  
  // Step 2: Clean
  console.log(`   🧹 Cleaning...`);
  const cleaned = await cleanMarkers(scan1.leaks);
  console.log(`   ✅ Cleaned ${cleaned} block(s)`);
  
  // Step 3: Re-scan to verify
  console.log(`   🔍 Re-scanning...`);
  const scan2 = await scanForMarkers(pageId);
  
  if (scan2.valid) {
    console.log(`   ✅ Validation passed`);
    
    if (!options.dryRun) {
      const updated = await updateValidation(pageId, true);
      if (updated) {
        console.log(`   ✅ Updated Validation property`);
      }
    } else {
      console.log(`   ℹ️ Dry run: skipping Validation property update`);
    }
    
    return { success: true, cleaned, wasClean: false };
  } else {
    console.log(`   ⚠️ Still has ${scan2.leakCount} leak(s) after cleanup!`);
    
    if (!options.dryRun) {
      const updated = await updateValidation(pageId, false, scan2.leakCount);
      if (updated) {
        console.log(`   ⚠️ Updated Validation property with remaining leaks`);
      }
    } else {
      console.log(`   ℹ️ Dry run: skipping Validation property update`);
    }
    
    return { success: false, cleaned, remainingLeaks: scan2.leakCount };
  }
}

async function main() {
  const pageIds = options.pageIds || defaultPageIds;
  
  console.log('🚀 Notion Page Validation & Cleanup Tool\n');
  console.log(`Mode: ${options.fix ? 'VALIDATE & CLEAN' : 'VALIDATE ONLY'}`);
  if (options.dryRun) {
    console.log(`Dry run: Will not update Validation properties`);
  }
  console.log(`Pages to process: ${pageIds.length}\n`);
  
  if (!options.fix) {
    console.log('💡 Tip: Use --fix to automatically clean markers\n');
  }
  
  const results = {
    total: pageIds.length,
    alreadyClean: 0,
    cleaned: 0,
    failed: 0,
    totalBlocks: 0,
    errors: []
  };
  
  for (const pageId of pageIds) {
    const result = await processPage(pageId);
    
    if (result.success) {
      if (result.wasClean) {
        results.alreadyClean++;
      } else {
        results.cleaned++;
        results.totalBlocks += result.cleaned || 0;
      }
    } else {
      results.failed++;
      if (result.error) {
        results.errors.push({ pageId, error: result.error });
      }
    }
    
    // Rate limit protection
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Processing complete!\n`);
  console.log(`   Total pages: ${results.total}`);
  console.log(`   Already clean: ${results.alreadyClean}`);
  console.log(`   Cleaned: ${results.cleaned}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Total blocks cleaned: ${results.totalBlocks}`);
  
  if (results.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    results.errors.forEach(({ pageId, error }) => {
      console.log(`   - ${pageId}: ${error}`);
    });
  }
  
  if (!options.fix && results.failed > 0) {
    console.log(`\n💡 Run with --fix to clean ${results.failed} page(s)`);
  }
  
  console.log(`${'='.repeat(80)}\n`);
  
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
