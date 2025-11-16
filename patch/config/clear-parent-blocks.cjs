#!/usr/bin/env node
/**
 * Delete all blocks from the parent page to prepare for clean rebuild.
 */
const API_BASE = process.env.SN2N_API_BASE || 'http://localhost:3004/api';
const PARENT_PAGE_ID = process.env.SN2N_PARENT_PAGE_ID || '2a8a89fe-dba5-8149-bb6b-f5cec836bdfa';

async function httpRequest(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`${options.method} ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  if (typeof fetch !== 'function') {
    global.fetch = (await import('node-fetch')).default;
  }

  console.log(`[clear] Retrieving blocks from page ${PARENT_PAGE_ID}...`);
  
  // Get all blocks (paginated)
  const allBlocks = [];
  let cursor = undefined;
  let pageNum = 0;
  
  do {
    pageNum++;
    const url = `https://api.notion.com/v1/blocks/${PARENT_PAGE_ID}/children${cursor ? `?start_cursor=${cursor}` : ''}`;
    const resp = await httpRequest(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Notion-Version': process.env.NOTION_VERSION || '2022-06-28',
        'Content-Type': 'application/json'
      }
    });
    
    const blocks = resp.results || [];
    allBlocks.push(...blocks);
    console.log(`  Page ${pageNum}: ${blocks.length} blocks (total so far: ${allBlocks.length})`);
    
    cursor = resp.next_cursor;
  } while (cursor);

  console.log(`[clear] Total blocks to delete: ${allBlocks.length}`);

  if (allBlocks.length === 0) {
    console.log('[clear] No blocks to delete');
    return;
  }

  // Delete blocks in chunks to avoid rate limits
  const chunkSize = 10;
  let deleted = 0;

  for (let i = 0; i < allBlocks.length; i += chunkSize) {
    const chunk = allBlocks.slice(i, i + chunkSize);
    
    await Promise.all(chunk.map(async (block) => {
      try {
        await httpRequest(`https://api.notion.com/v1/blocks/${block.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
            'Notion-Version': process.env.NOTION_VERSION || '2022-06-28'
          }
        });
        deleted++;
      } catch (err) {
        console.error(`  ⚠️ Failed to delete block ${block.id}:`, err.message);
      }
    }));

    console.log(`[clear] Deleted ${deleted}/${allBlocks.length} blocks`);
    
    // Small delay between chunks
    if (i + chunkSize < allBlocks.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`[clear] ✅ Deleted ${deleted} blocks from parent page`);
}

main().catch(err => {
  console.error('[clear] Failed:', err && err.stack || err);
  process.exit(1);
});
