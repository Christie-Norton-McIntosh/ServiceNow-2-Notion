/**
 * @file Express routes for Text Completeness Comparator
 * @module routes/compare
 * 
 * Provides API endpoints for comparing ServiceNow HTML content with Notion pages
 * using canonicalization + LCS/Jaccard algorithms.
 * 
 * Endpoints:
 * - GET /api/compare/health - Health check
 * - POST /api/compare/section - Compare two text sections
 * - POST /api/compare/notion-page - Compare against Notion page
 * - POST /api/compare/notion-db-row - Compare and update DB properties
 */

const express = require('express');
const crypto = require('crypto');
const { canonicalizeText, tokenizeWords } = require('../utils/canonicalize.cjs');
const { lcsCoverage } = require('../utils/lcs.cjs');
const { flattenBlocks } = require('../utils/flatten-notion.cjs');
const { spanToCanonicalText } = require('../utils/comparator-utils.cjs');

const router = express.Router();

/**
 * Health check endpoint
 * @route GET /api/compare/health
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: {
      canon: 'canon-v1.4',
      algo: 'lcs-v1.0'
    }
  });
});

/**
 * Bearer auth middleware (optional)
 * Only enforces if AUTH_TOKEN is configured
 */
router.use((req, res, next) => {
  const required = process.env.AUTH_TOKEN;
  if (!required) return next();
  
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${required}`) return next();
  
  res.status(401).json({ error: 'Unauthorized' });
});

/**
 * Compare two arbitrary text sections
 * @route POST /api/compare/section
 */
router.post('/section', (req, res) => {
  const { srcText, dstText, options } = req.body || {};
  
  if (typeof srcText !== 'string' || typeof dstText !== 'string') {
    return res.status(400).json({ error: 'srcText and dstText must be strings' });
  }
  
  const lower = options?.lowerCase !== false;
  const canonSrc = canonicalizeText(srcText, { lower });
  const canonDst = canonicalizeText(dstText, { lower });
  const srcTokens = tokenizeWords(canonSrc);
  const dstTokens = tokenizeWords(canonDst);

  const result = lcsCoverage(srcTokens, dstTokens, {
    maxCells: options?.maxCells ?? Number(process.env.MAX_CELLS || 50_000_000),
    minMissingSpanTokens: options?.minMissingSpanTokens ?? Number(process.env.MIN_SPAN || 40)
  });

  const missingSpans = result.spans.map(([s, e]) => ({
    start: s,
    end: e,
    text: spanToCanonicalText(srcTokens, [s, e]) // exact canonical missing text
  }));

  const runId = crypto.createHash('sha256')
    .update(`${canonSrc.length}:${canonDst.length}:${result.method}:${result.lcsLength}`)
    .digest('hex').slice(0, 16);

  res.json({
    runId,
    method: result.method,
    coverage: Number(result.coverage.toFixed(6)),
    lcsLength: result.lcsLength,
    srcTokenCount: srcTokens.length,
    dstTokenCount: dstTokens.length,
    missingSpans,
    params: {
      lowerCase: lower,
      maxCells: options?.maxCells ?? Number(process.env.MAX_CELLS || 50_000_000),
      minMissingSpanTokens: options?.minMissingSpanTokens ?? Number(process.env.MIN_SPAN || 40)
    },
    version: { canon: 'canon-v1.4', algo: 'lcs-v1.0' }
  });
});

/**
 * Compare against a Notion page (by page_id)
 * @route POST /api/compare/notion-page
 */
router.post('/notion-page', async (req, res) => {
  const { pageId, srcText, options } = req.body || {};
  
  if (!pageId || typeof srcText !== 'string') {
    return res.status(400).json({ error: 'pageId and srcText are required' });
  }
  
  try {
    const lower = options?.lowerCase !== false;
    const notion = global.notion;
    
    if (!notion) {
      return res.status(500).json({ error: 'Notion client not initialized' });
    }
    
    // Fetch page blocks recursively
    const blocks = await fetchPageBlocks(notion, pageId);
    const dstText = flattenBlocks(blocks);
    
    const canonSrc = canonicalizeText(srcText, { lower });
    const canonDst = canonicalizeText(dstText, { lower });
    const srcTokens = tokenizeWords(canonSrc);
    const dstTokens = tokenizeWords(canonDst);
    
    const result = lcsCoverage(srcTokens, dstTokens, {
      maxCells: options?.maxCells ?? Number(process.env.MAX_CELLS || 50_000_000),
      minMissingSpanTokens: options?.minMissingSpanTokens ?? Number(process.env.MIN_SPAN || 40)
    });
    
    res.json({
      pageId,
      method: result.method,
      coverage: Number(result.coverage.toFixed(6)),
      lcsLength: result.lcsLength,
      srcTokenCount: srcTokens.length,
      dstTokenCount: dstTokens.length,
      missingSpans: result.spans.map(([s, e]) => ({
        start: s,
        end: e,
        text: spanToCanonicalText(srcTokens, [s, e])
      }))
    });
  } catch (err) {
    console.error('compare/notion-page error:', err);
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

/**
 * Compare + write summary to Notion DB page properties
 * @route POST /api/compare/notion-db-row
 */
router.post('/notion-db-row', async (req, res) => {
  const { pageId, srcText, options } = req.body || {};
  
  if (!pageId || typeof srcText !== 'string') {
    return res.status(400).json({ error: 'pageId and srcText are required' });
  }
  
  try {
    const lower = options?.lowerCase !== false;
    const notion = global.notion;
    
    if (!notion) {
      return res.status(500).json({ error: 'Notion client not initialized' });
    }
    
    // Fetch page blocks recursively
    const blocks = await fetchPageBlocks(notion, pageId);
    const dstText = flattenBlocks(blocks);
    
    const canonSrc = canonicalizeText(srcText, { lower });
    const canonDst = canonicalizeText(dstText, { lower });
    const srcTokens = tokenizeWords(canonSrc);
    const dstTokens = tokenizeWords(canonDst);
    
    const result = lcsCoverage(srcTokens, dstTokens, {
      maxCells: options?.maxCells ?? Number(process.env.MAX_CELLS || 50_000_000),
      minMissingSpanTokens: options?.minMissingSpanTokens ?? Number(process.env.MIN_SPAN || 40)
    });

    const canonicalMissing = result.spans.map(([s, e]) => spanToCanonicalText(srcTokens, [s, e]));
    const topN = canonicalMissing.slice(0, 5);

    // Build properties update
    const props = {
      Coverage: { number: Number(result.coverage.toFixed(6)) },
      MissingCount: { number: result.spans.length },
      Method: { select: { name: result.method } },
      LastChecked: { date: { start: new Date().toISOString() } },
      MissingSpans: { rich_text: topN.map(t => ({ type: 'text', text: { content: t.slice(0, 2000) } })) },
      RunId: { rich_text: [{ type: 'text', text: { content: crypto.createHash('sha256').update(`${canonSrc.length}:${canonDst.length}:${result.method}:${result.lcsLength}`).digest('hex').slice(0, 16) } }] },
      Status: { select: { name: (result.coverage >= 0.97 && result.spans.length === 0) ? 'Complete' : 'Attention' } }
    };
    
    // Update database page properties
    await updateDatabaseResult(notion, pageId, props);
    
    // Optional: append toggle with missing spans
    await appendMissingSpansToggle(notion, pageId, canonicalMissing);

    res.json({
      pageId,
      updated: true,
      coverage: Number(result.coverage.toFixed(6)),
      missingCount: result.spans.length,
      method: result.method,
      missingSpans: canonicalMissing
    });
  } catch (err) {
    console.error('compare/notion-db-row error:', err);
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

/**
 * Recursively fetch block tree (Blocks Children API is paginated; recurse for nested content)
 * @param {Object} notion - Notion client
 * @param {string} blockId - Block/page ID
 * @returns {Promise<Array>} Array of blocks with children
 */
async function fetchBlockTree(notion, blockId) {
  let cursor = undefined;
  const blocks = [];
  
  do {
    const resp = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor
    });
    
    for (const b of resp.results) {
      if (b.has_children) {
        b.children = await fetchBlockTree(notion, b.id);
      }
      blocks.push(b);
    }
    
    cursor = resp.next_cursor;
  } while (cursor);
  
  return blocks;
}

/**
 * Fetch all blocks from a page
 * @param {Object} notion - Notion client
 * @param {string} pageId - Page ID
 * @returns {Promise<Array>} Array of blocks
 */
async function fetchPageBlocks(notion, pageId) {
  return fetchBlockTree(notion, pageId);
}

/**
 * Update Notion database page properties
 * @param {Object} notion - Notion client
 * @param {string} pageId - Page ID
 * @param {Object} properties - Properties to update
 * @returns {Promise<Object>} Updated page object
 */
async function updateDatabaseResult(notion, pageId, properties) {
  return notion.pages.update({ page_id: pageId, properties });
}

/**
 * Optional: append a toggle/callout with missing spans for editors
 * @param {Object} notion - Notion client
 * @param {string} pageId - Page ID
 * @param {Array<string>} spans - Missing span texts
 */
async function appendMissingSpansToggle(notion, pageId, spans) {
  if (String(process.env.APPEND_TOGGLE).toLowerCase() !== 'true') return;
  
  const children = [
    {
      object: 'block',
      callout: {
        rich_text: [{ type: 'text', text: { content: 'Comparator: Missing canonical text' } }],
        icon: { emoji: '🧩' }
      }
    },
    ...spans.slice(0, 20).map(t => ({
      object: 'block',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: t.slice(0, 2000) } }]
      }
    }))
  ];
  
  await notion.blocks.children.append({ block_id: pageId, children });
}

/**
 * Run completeness comparison and return results (for integration with W2N)
 * This function is called internally after POST/PATCH orchestration completes
 * 
 * @param {Object} notion - Notion client instance
 * @param {string} pageId - Notion page ID
 * @param {string} srcText - Source HTML text (plain text, no tags)
 * @param {Object} options - Comparison options
 * @param {function} log - Logging function
 * @returns {Promise<Object>} Comparison result with coverage, missing spans, etc.
 */
async function runCompletenessComparison(notion, pageId, srcText, options = {}, log = console.log) {
  try {
    log(`[COMPARATOR] Starting completeness comparison for page ${pageId}`);
    
    const lower = options.lowerCase !== false;
    
    // Fetch page blocks recursively
    log(`[COMPARATOR] Fetching page blocks...`);
    const blocks = await fetchPageBlocks(notion, pageId);
    const dstText = flattenBlocks(blocks);
    
    log(`[COMPARATOR] Source tokens: ${srcText.length} chars`);
    log(`[COMPARATOR] Notion tokens: ${dstText.length} chars`);
    
    // Canonicalize and tokenize
    const canonSrc = canonicalizeText(srcText, { lower });
    const canonDst = canonicalizeText(dstText, { lower });
    const srcTokens = tokenizeWords(canonSrc);
    const dstTokens = tokenizeWords(canonDst);
    
    log(`[COMPARATOR] Canonicalized source: ${srcTokens.length} tokens`);
    log(`[COMPARATOR] Canonicalized notion: ${dstTokens.length} tokens`);
    
    // Run LCS/Jaccard comparison
    const result = lcsCoverage(srcTokens, dstTokens, {
      maxCells: options.maxCells ?? Number(process.env.MAX_CELLS || 50_000_000),
      minMissingSpanTokens: options.minMissingSpanTokens ?? Number(process.env.MIN_SPAN || 40)
    });
    
    const canonicalMissing = result.spans.map(([s, e]) => spanToCanonicalText(srcTokens, [s, e]));
    
    log(`[COMPARATOR] Method: ${result.method}`);
    log(`[COMPARATOR] Coverage: ${(result.coverage * 100).toFixed(2)}%`);
    log(`[COMPARATOR] Missing spans: ${result.spans.length}`);
    
    return {
      success: true,
      coverage: Number(result.coverage.toFixed(6)),
      method: result.method,
      lcsLength: result.lcsLength,
      srcTokenCount: srcTokens.length,
      dstTokenCount: dstTokens.length,
      missingSpans: result.spans,
      canonicalMissing,
      runId: crypto.createHash('sha256')
        .update(`${canonSrc.length}:${canonDst.length}:${result.method}:${result.lcsLength}`)
        .digest('hex').slice(0, 16)
    };
  } catch (err) {
    log(`[COMPARATOR] Error: ${err.message}`);
    log(`[COMPARATOR] Stack: ${err.stack}`);
    return {
      success: false,
      error: err.message,
      coverage: 0,
      method: 'error',
      missingSpans: [],
      canonicalMissing: []
    };
  }
}

module.exports = router;
module.exports.runCompletenessComparison = runCompletenessComparison;
