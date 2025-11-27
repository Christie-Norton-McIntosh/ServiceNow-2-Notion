/**
 * @fileoverview Block Chunking and Append Orchestration
 * 
 * This module handles the complex orchestration of appending blocks to Notion pages,
 * managing Notion's 100-block limit per request through intelligent chunking and
 * providing robust retry logic for handling API failures.
 * 
 * Key Features:
 * - Automatic block chunking to respect Notion's 100-block limit
 * - Retry logic with exponential backoff for failed requests
 * - Private key stripping to clean internal helper properties
 * - Nested block processing for complex hierarchies
 * - Comprehensive error handling and logging
 * 
 * Dependencies:
 * - Global Notion client via getGlobals() pattern
 * - Global logging function
 * 
 * @module orchestration/block-chunking
 * @since 8.2.5
 */

/**
 * Retrieves global utility functions from the main server context.
 * 
 * @private
 * @returns {object} Object containing global utility functions
 * @returns {object} returns.notion - Notion API client instance
 * @returns {function} returns.log - Logging function (global.log or console.log fallback)
 */
function getGlobals() {
  return {
    notion: global.notion,
    log: global.log || console.log,
  };
}

/**
 * Appends blocks to a Notion block ID with automatic chunking and retry logic.
 * 
 * This function handles the complexity of Notion's 100-block limit per request
 * by automatically chunking large block arrays and implementing robust retry
 * logic with exponential backoff for handling API failures.
 * 
 * @async
 * @param {string} blockId - UUID of the Notion block/page to append blocks to
 * @param {Array<object>} blocks - Array of Notion block objects to append
 * @param {object} [opts={}] - Configuration options for chunking and retries
 * @param {number} [opts.maxPerRequest=100] - Maximum blocks per API request (respects Notion's limit)
 * @param {number} [opts.maxAttempts=3] - Maximum retry attempts for failed requests
 * 
 * @returns {Promise<object>} Result object with append statistics
 * @returns {number} returns.appended - Total number of blocks successfully appended
 * 
 * @throws {Error} If Notion client is not initialized
 * @throws {Error} If blockId is missing or invalid
 * @throws {Error} If all retry attempts fail for any chunk
 * 
 * @example
 * // Append a large array of blocks with default settings
 * const result = await appendBlocksToBlockId('page-uuid-here', blocks);
 * console.log(`Successfully appended ${result.appended} blocks`);
 * 
 * @example
 * // Append with custom chunking and retry settings
 * const result = await appendBlocksToBlockId('page-uuid-here', blocks, {
 *   maxPerRequest: 50,  // Smaller chunks for stability
 *   maxAttempts: 5      // More retry attempts
 * });
 * 
 * @see {@link deepStripPrivateKeys} for private key cleaning process
 */
async function appendBlocksToBlockId(blockId, blocks, opts = {}) {
  const { notion, log } = getGlobals();
  
  if (!notion) throw new Error("Notion client not initialized");
  if (!blockId) throw new Error("Missing blockId");
  if (!Array.isArray(blocks) || blocks.length === 0) return { appended: 0 };

  const MAX = opts.maxPerRequest || 100;
  const chunks = [];
  for (let i = 0; i < blocks.length; i += MAX) {
    chunks.push(blocks.slice(i, i + MAX));
  }

  let appended = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let attempts = 0;
    const maxAttempts = opts.maxAttempts || 3;
    
    // FIX v11.0.6: Inter-chunk delay to prevent rate limit exhaustion
    // Add delay between chunks (not on first chunk, only on first attempt)
    if (i > 0 && attempts === 0) {
      const interChunkDelay = chunks.length > 10 ? 1000 : 500; // 1s if many chunks, else 500ms
      await new Promise((r) => setTimeout(r, interChunkDelay));
    }
    
    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Ensure private helper keys are removed from the chunk before sending
        deepStripPrivateKeys(chunk);
        await notion.blocks.children.append({
          block_id: blockId,
          children: chunk,
        });
        appended += chunk.length;
        break;
      } catch (err) {
        // FIX v11.0.6: Check if rate limited and apply longer backoff
        const isRateLimited = err.status === 429 || 
                             err.code === 'rate_limited' || 
                             err.message?.toLowerCase().includes('rate limit');
        
        if (isRateLimited) {
          log(
            `⚠️ 🚦 RATE LIMIT during chunk append (chunk ${i + 1}/${
              chunks.length
            }, attempt ${attempts})`
          );
          // Longer exponential backoff for rate limit errors: 5s, 10s, 20s (cap 30s)
          const backoffDelay = Math.min(5000 * Math.pow(2, attempts - 1), 30000);
          log(`   Waiting ${backoffDelay / 1000}s before retry...`);
          await new Promise((r) => setTimeout(r, backoffDelay));
          if (attempts >= maxAttempts) throw err;
        } else {
          log(
            `⚠️ appendBlocksToBlockId chunk ${i + 1}/${
              chunks.length
            } failed (attempt ${attempts}): ${err.message}`
          );
          if (attempts >= maxAttempts) throw err;
          // Standard backoff for other errors
          await new Promise((r) => setTimeout(r, 250 * attempts));
        }
      }
    }
  }

  return { appended };
}

/**
 * Recursively removes internal helper properties from block objects.
 * 
 * This function performs a deep traversal of block objects and their nested
 * children, removing any properties that start with '_sn2n_' which are used
 * internally for processing but should not be sent to the Notion API.
 * 
 * @param {Array<object>} blocks - Array of block objects to clean
 * 
 * @example
 * const blocks = [
 *   {
 *     type: "paragraph",
 *     _sn2n_marker: "temp-marker", // Will be removed
 *     paragraph: { rich_text: [...] },
 *     children: [
 *       { type: "callout", _sn2n_processed: true, callout: {...} } // _sn2n_processed removed
 *     ]
 *   }
 * ];
 * deepStripPrivateKeys(blocks);
 * // blocks now clean for Notion API
 * 
 * @see {@link appendBlocksToBlockId} for usage in block appending process
 */
function deepStripPrivateKeys(blocks) {
  if (!Array.isArray(blocks)) return;
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    for (const k of Object.keys(b)) {
      if (k.startsWith("_sn2n_")) delete b[k];
    }
    const type = b.type;
    if (type && b[type] && Array.isArray(b[type].children)) {
      deepStripPrivateKeys(b[type].children);
    }
    if (Array.isArray(b.children)) deepStripPrivateKeys(b.children);
  }
}

/**
 * @typedef {object} AppendOptions
 * @property {number} [maxPerRequest=100] - Maximum blocks per API request
 * @property {number} [maxAttempts=3] - Maximum retry attempts for failed requests
 */

/**
 * @typedef {object} AppendResult
 * @property {number} appended - Total number of blocks successfully appended
 */

// Export block chunking and append utilities
module.exports = {
  /** @type {function(string, Array<object>, AppendOptions=): Promise<AppendResult>} */
  appendBlocksToBlockId,
  /** @type {function(Array<object>): void} */
  deepStripPrivateKeys,
};