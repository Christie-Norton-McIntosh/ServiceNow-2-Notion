#!/usr/bin/env node
/**
 * Clean up marker leaks from pages
 * Usage: node scripts/cleanup-marker-leaks.cjs
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// List of page IDs from validation report
const pageIds = [
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

async function cleanPage(pageId) {
  const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  
  try {
    const page = await notion.pages.retrieve({ page_id: formattedId });
    const title = page.properties?.Name?.title?.[0]?.plain_text || page.properties?.title?.title?.[0]?.plain_text || 'Unknown';
    
    console.log(`\n🔧 Cleaning: ${title}`);
    
    const queue = [formattedId];
    const visited = new Set();
    let cleaned = 0;
    
    async function listChildren(blockId, cursor) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await notion.blocks.children.list({
            block_id: blockId,
            page_size: 100,
            start_cursor: cursor,
          });
        } catch (error) {
          const retryable = error.status === 429 || /ECONNRESET|ETIMEDOUT|timeout|socket hang up/i.test(error.message || '');
          if (retryable && attempt < 3) {
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
            
            // Handle table rows specially
            if (blockType === 'table_row' && child.table_row && Array.isArray(child.table_row.cells)) {
              const cells = child.table_row.cells;
              let changed = false;
              const newCells = cells.map(cell => {
                if (!Array.isArray(cell)) return cell;
                const cellText = cell.map(rt => rt?.text?.content || '').join('');
                if (!markerPattern.test(cellText)) return cell;
                
                changed = true;
                return cell.map(rt => {
                  if (!rt || !rt.text || typeof rt.text.content !== 'string') return rt;
                  const cleaned = rt.text.content.replace(markerPattern, '').trim();
                  return { ...rt, text: { ...rt.text, content: cleaned } };
                }).filter(rt => rt && rt.text && rt.text.content && rt.text.content.length > 0);
              });
              
              if (changed) {
                let ok = false;
                let retries = 0;
                while (!ok && retries < 5) {
                  try {
                    await notion.blocks.update({
                      block_id: child.id,
                      table_row: { cells: newCells }
                    });
                    cleaned++;
                    ok = true;
                  } catch (e) {
                    if ((e.code === 'conflict_error' || e.status === 429) && retries < 4) {
                      retries++;
                      const delay = 500 * retries;
                      await new Promise(r => setTimeout(r, delay));
                    } else {
                      console.error(`   ⚠️ Failed to clean table_row ${child.id}: ${e.message}`);
                      break;
                    }
                  }
                }
              }
            }
            
            // Handle rich_text blocks
            if (Array.isArray(payload.rich_text)) {
              const plainText = payload.rich_text.map(rt => rt?.text?.content || '').join('');
              if (markerPattern.test(plainText)) {
                const newRichText = payload.rich_text.map(rt => {
                  if (!rt || !rt.text || typeof rt.text.content !== 'string') return rt;
                  const cleaned = rt.text.content.replace(markerPattern, '').trim();
                  return { ...rt, text: { ...rt.text, content: cleaned } };
                }).filter(rt => rt && rt.text && rt.text.content && rt.text.content.length > 0);
                
                if (newRichText.length > 0) {
                  let ok = false;
                  let retries = 0;
                  while (!ok && retries < 5) {
                    try {
                      await notion.blocks.update({
                        block_id: child.id,
                        [blockType]: { rich_text: newRichText }
                      });
                      cleaned++;
                      ok = true;
                    } catch (e) {
                      if ((e.code === 'conflict_error' || e.status === 429) && retries < 4) {
                        retries++;
                        const delay = 500 * retries;
                        await new Promise(r => setTimeout(r, delay));
                      } else {
                        console.error(`   ⚠️ Failed to clean ${blockType} ${child.id}: ${e.message}`);
                        break;
                      }
                    }
                  }
                }
              }
            }
            
            if (child.has_children) {
              queue.push(child.id);
            }
          } catch (error) {
            console.error(`   ⚠️ Error processing block: ${error.message}`);
          }
        }
      } while (cursor);
    }
    
    if (cleaned > 0) {
      console.log(`   ✅ Cleaned ${cleaned} block(s)`);
    } else {
      console.log(`   ✓ No markers found`);
    }
    
    return { success: true, cleaned };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log(`🚀 Starting cleanup of ${pageIds.length} pages with marker leaks...\n`);
  
  const results = {
    total: pageIds.length,
    cleaned: 0,
    failed: 0,
    totalBlocks: 0
  };
  
  for (const pageId of pageIds) {
    const result = await cleanPage(pageId);
    if (result.success) {
      results.cleaned++;
      results.totalBlocks += result.cleaned || 0;
    } else {
      results.failed++;
    }
    
    // Rate limit protection: small delay between pages
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Cleanup complete!`);
  console.log(`   Pages processed: ${results.total}`);
  console.log(`   Successfully cleaned: ${results.cleaned}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Total blocks cleaned: ${results.totalBlocks}`);
  console.log(`${'='.repeat(80)}\n`);
}

main().catch(console.error);
