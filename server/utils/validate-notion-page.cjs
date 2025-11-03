/**
 * @file Validation utility for created Notion pages
 * @module utils/validate-notion-page
 * 
 * Validates that a created Notion page matches expectations:
 * - No marker leaks (sn2n:marker tokens visible in rich_text)
 * - Reasonable block count
 * - Expected content structure
 * - Key headings/sections present
 */

/**
 * Recursively fetch all blocks from a Notion page or block
 * @param {Object} notion - Notion client instance
 * @param {string} blockId - Block ID to fetch children from
 * @param {number} depth - Current recursion depth (for safety)
 * @returns {Promise<Array>} Array of all blocks (flattened)
 */
async function fetchAllBlocks(notion, blockId, depth = 0) {
  if (depth > 10) {
    console.warn(`⚠️ [VALIDATION] Max recursion depth reached at block ${blockId}`);
    return [];
  }

  const blocks = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    try {
      const response = await notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100
      });

      for (const block of response.results) {
        blocks.push(block);

        // Recursively fetch children if block has them
        if (block.has_children) {
          const children = await fetchAllBlocks(notion, block.id, depth + 1);
          blocks.push(...children);
        }
      }

      hasMore = response.has_more;
      cursor = response.next_cursor;
    } catch (error) {
      console.error(`⚠️ [VALIDATION] Error fetching blocks for ${blockId}:`, error.message);
      break;
    }
  }

  return blocks;
}

/**
 * Extract text content from a rich_text array
 * @param {Array} richTextArray - Notion rich_text array
 * @returns {string} Plain text content
 */
function extractText(richTextArray) {
  if (!Array.isArray(richTextArray)) return '';
  return richTextArray
    .map(rt => rt.text?.content || rt.plain_text || '')
    .join('');
}

/**
 * Check for marker leaks in a block's rich_text
 * @param {Object} block - Notion block object
 * @returns {Array<string>} Array of found marker tokens
 */
function checkBlockForMarkers(block) {
  const markers = [];
  const markerPattern = /\(sn2n:[a-z0-9\-]+\)/gi;

  // Check different block types for rich_text
  const richTextSources = [];
  
  if (block.type === 'paragraph' && block.paragraph?.rich_text) {
    richTextSources.push({ type: 'paragraph', richText: block.paragraph.rich_text });
  }
  if (block.type === 'heading_1' && block.heading_1?.rich_text) {
    richTextSources.push({ type: 'heading_1', richText: block.heading_1.rich_text });
  }
  if (block.type === 'heading_2' && block.heading_2?.rich_text) {
    richTextSources.push({ type: 'heading_2', richText: block.heading_2.rich_text });
  }
  if (block.type === 'heading_3' && block.heading_3?.rich_text) {
    richTextSources.push({ type: 'heading_3', richText: block.heading_3.rich_text });
  }
  if (block.type === 'callout' && block.callout?.rich_text) {
    richTextSources.push({ type: 'callout', richText: block.callout.rich_text });
  }
  if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
    richTextSources.push({ type: 'bulleted_list_item', richText: block.bulleted_list_item.rich_text });
  }
  if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
    richTextSources.push({ type: 'numbered_list_item', richText: block.numbered_list_item.rich_text });
  }
  if (block.type === 'to_do' && block.to_do?.rich_text) {
    richTextSources.push({ type: 'to_do', richText: block.to_do.rich_text });
  }
  if (block.type === 'toggle' && block.toggle?.rich_text) {
    richTextSources.push({ type: 'toggle', richText: block.toggle.rich_text });
  }
  if (block.type === 'quote' && block.quote?.rich_text) {
    richTextSources.push({ type: 'quote', richText: block.quote.rich_text });
  }

  // Check each rich_text source for markers
  for (const source of richTextSources) {
    const text = extractText(source.richText);
    const matches = text.match(markerPattern);
    if (matches) {
      markers.push(...matches.map(m => ({
        marker: m,
        blockId: block.id,
        blockType: block.type,
        text: text.substring(0, 100)
      })));
    }
  }

  return markers;
}

/**
 * Validate a created Notion page
 * @param {Object} notion - Notion client instance
 * @param {string} pageId - Page ID to validate
 * @param {Object} options - Validation options
 * @param {number} options.expectedMinBlocks - Minimum expected block count
 * @param {number} options.expectedMaxBlocks - Maximum expected block count
 * @param {Array<string>} options.expectedHeadings - Array of expected heading text (case-insensitive)
 * @param {Object} log - Logger function (optional)
 * @returns {Promise<Object>} Validation result
 */
async function validateNotionPage(notion, pageId, options = {}, log = console.log) {
  const result = {
    success: true,
    hasErrors: false,
    issues: [],
    warnings: [],
    stats: {},
    summary: ''
  };

  try {
    log(`🔍 [VALIDATION] Starting validation for page ${pageId}`);

    // Fetch all blocks from the page
    const startTime = Date.now();
    const allBlocks = await fetchAllBlocks(notion, pageId);
    const fetchTime = Date.now() - startTime;

    log(`🔍 [VALIDATION] Fetched ${allBlocks.length} blocks in ${fetchTime}ms`);

    // Collect statistics
    const blockTypes = {};
    let markerLeaks = [];
    const headings = [];

    for (const block of allBlocks) {
      // Count block types
      blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;

      // Check for marker leaks
      const markers = checkBlockForMarkers(block);
      if (markers.length > 0) {
        markerLeaks.push(...markers);
      }

      // Collect headings
      if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3') {
        const headingText = extractText(block[block.type]?.rich_text || []);
        if (headingText.trim()) {
          headings.push({
            type: block.type,
            text: headingText,
            blockId: block.id
          });
        }
      }
    }

    result.stats = {
      totalBlocks: allBlocks.length,
      blockTypes,
      headingCount: headings.length,
      fetchTimeMs: fetchTime
    };

    // VALIDATION 1: Check for marker leaks (CRITICAL)
    if (markerLeaks.length > 0) {
      result.hasErrors = true;
      result.issues.push(`Marker leak: ${markerLeaks.length} visible sn2n:marker token(s) found`);
      
      log(`❌ [VALIDATION] MARKER LEAK DETECTED: ${markerLeaks.length} markers found`);
      markerLeaks.slice(0, 5).forEach((leak, idx) => {
        log(`   [${idx + 1}] ${leak.marker} in ${leak.blockType} block ${leak.blockId}`);
        log(`       Text: "${leak.text}..."`);
      });
      
      if (markerLeaks.length > 5) {
        log(`   ... and ${markerLeaks.length - 5} more`);
      }

      result.markerLeaks = markerLeaks;
    } else {
      log(`✅ [VALIDATION] No marker leaks found`);
    }

    // VALIDATION 2: Block count sanity check
    if (options.expectedMinBlocks && allBlocks.length < options.expectedMinBlocks) {
      result.hasErrors = true;
      result.issues.push(`Block count too low: expected at least ${options.expectedMinBlocks}, got ${allBlocks.length}`);
      log(`❌ [VALIDATION] Block count too low: ${allBlocks.length} < ${options.expectedMinBlocks}`);
    } else if (options.expectedMaxBlocks && allBlocks.length > options.expectedMaxBlocks) {
      result.warnings.push(`Block count high: expected at most ${options.expectedMaxBlocks}, got ${allBlocks.length}`);
      log(`⚠️ [VALIDATION] Block count high: ${allBlocks.length} > ${options.expectedMaxBlocks}`);
    } else if (options.expectedMinBlocks || options.expectedMaxBlocks) {
      log(`✅ [VALIDATION] Block count within expected range: ${allBlocks.length}`);
    }

    // VALIDATION 3: Check for expected headings
    if (options.expectedHeadings && options.expectedHeadings.length > 0) {
      const headingTextsLower = headings.map(h => h.text.toLowerCase().trim());
      const missingHeadings = [];

      for (const expectedHeading of options.expectedHeadings) {
        const expectedLower = expectedHeading.toLowerCase().trim();
        const found = headingTextsLower.some(h => h.includes(expectedLower) || expectedLower.includes(h));
        
        if (!found) {
          missingHeadings.push(expectedHeading);
        }
      }

      if (missingHeadings.length > 0) {
        result.warnings.push(`Missing expected headings: ${missingHeadings.join(', ')}`);
        log(`⚠️ [VALIDATION] Missing ${missingHeadings.length} expected heading(s): ${missingHeadings.join(', ')}`);
      } else {
        log(`✅ [VALIDATION] All expected headings found`);
      }
    }

    // VALIDATION 4: Structural integrity checks
    const hasParagraphs = blockTypes.paragraph > 0;
    const hasListItems = (blockTypes.bulleted_list_item || 0) + (blockTypes.numbered_list_item || 0) > 0;
    
    if (!hasParagraphs && !hasListItems && allBlocks.length > 0) {
      result.warnings.push('Page has blocks but no paragraphs or list items - possible content extraction issue');
      log(`⚠️ [VALIDATION] No paragraphs or list items found in ${allBlocks.length} blocks`);
    }

    // Generate summary
    if (result.hasErrors) {
      result.success = false;
      result.summary = `❌ Validation failed: ${result.issues.length} error(s)`;
      if (result.warnings.length > 0) {
        result.summary += `, ${result.warnings.length} warning(s)`;
      }
      result.summary += `\n\nErrors:\n${result.issues.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
    } else if (result.warnings.length > 0) {
      result.summary = `⚠️ Validation passed with warnings: ${result.warnings.length} warning(s)\n\nWarnings:\n${result.warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;
    } else {
      result.summary = `✅ Validation passed: ${allBlocks.length} blocks, ${headings.length} headings, no issues`;
    }

    result.summary += `\n\nStats: ${JSON.stringify(result.stats, null, 2)}`;

    log(`🔍 [VALIDATION] Complete: ${result.success ? 'PASSED' : 'FAILED'}`);
    
  } catch (error) {
    result.success = false;
    result.hasErrors = true;
    result.issues.push(`Validation error: ${error.message}`);
    result.summary = `❌ Validation failed with error: ${error.message}`;
    log(`❌ [VALIDATION] Error during validation: ${error.message}`);
  }

  return result;
}

module.exports = {
  validateNotionPage,
  fetchAllBlocks,
  checkBlockForMarkers,
  extractText
};
