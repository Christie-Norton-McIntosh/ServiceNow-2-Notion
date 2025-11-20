/**
 * @file Validation utility for created Notion pages
 * @module utils/validate-notion-page
 * 
 * Validates that a created Notion page matches expectations:
 * - No marker leaks (sn2n:marker tokens visible in rich_text)
 * - Reasonable block count
 * - Expected content structure
 * - Key headings/sections present
 * 
 * HEADING COUNT VALIDATION:
 * Heading counts use ±20% tolerance to account for:
 * 1. Synthetic section headings: ServiceNow uses <p><span class="ph uicontrol">Title</span></p>
 *    which get converted to heading_2 blocks (now counted in HTML parsing)
 * 2. Heading splitting: Long headings exceeding 100 rich_text elements split into multiple blocks
 * 3. H4/H5/H6 downgrading: All downgrade to heading_3 (Notion only supports h1-h3)
 * 
 * PARAGRAPH COUNT VALIDATION:
 * Paragraph counts use ±50% tolerance (informational only, not errors):
 * 1. Promoted to list items: First <p> child of <li> becomes list item text, not paragraph block
 * 2. Filtered empty paragraphs: Empty/whitespace-only paragraphs are filtered during conversion
 * 3. Paragraph splitting: Long paragraphs exceeding 100 rich_text elements split into multiple blocks
 * 4. Synthetic headings: <section><p><span class="ph uicontrol">...</span></p> become heading_2
 * 5. Wrapped orphan content: Text not in containers gets wrapped in paragraph blocks
 * 6. In tables: Paragraphs inside tables are excluded (table cells don't contain paragraph blocks)
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
 * Parse source HTML to count expected elements
 * @param {string} html - Source HTML content
 * @returns {Object} Counts of expected elements
 */
function parseSourceHtmlCounts(html) {
  if (!html) return null;
  
  try {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    // Count ALL ordered list items (including nested) - this matches Notion's flattened structure
    // Exclude list items inside <nav> elements - those get flattened to paragraphs during extraction
    const allOrderedListItems = $('ol li').length;
    const orderedListItemsInNav = $('nav ol li').length;
    const orderedListItems = allOrderedListItems - orderedListItemsInNav;
    
    // Count ALL unordered list items (including nested) - this matches Notion's flattened structure
    // Exclude list items inside <nav> elements - those get flattened to paragraphs during extraction
    const allUnorderedListItems = $('ul li').length;
    const unorderedListItemsInNav = $('nav ul li').length;
    const unorderedListItems = allUnorderedListItems - unorderedListItemsInNav;
    
    // Count total list items
    const totalListItems = orderedListItems + unorderedListItems;
    
    // Count paragraphs (excluding those inside tables and those promoted to list item text)
    // Paragraphs get promoted when they're the first child of a list item: <li><p>text</p>...</li>
    const allParagraphs = $('p, div.p').length;
    const paragraphsInTables = $('table p, table div.p').length;
    
    // Count paragraphs that are first children of list items (these get promoted to list item text)
    let paragraphsPromotedToListText = 0;
    $('li').each((i, li) => {
      const $li = $(li);
      const firstChild = $li.children().first();
      if (firstChild.length && (firstChild.is('p') || (firstChild.is('div') && firstChild.hasClass('p')))) {
        paragraphsPromotedToListText++;
      }
    });
    
    // Count synthetic UIControl paragraphs that become headings (exclude from paragraph count)
    // Same pattern as synthetic headings: <section><p class="p"><span class="ph uicontrol">...</span></p>
    let paragraphsBecomeHeadings = 0;
    $('section > p.p').each((i, p) => {
      const $p = $(p);
      const html = $p.html() || '';
      const isSyntheticHeading = /^\s*<span[^>]*class=["'][^"']*\bph\b[^"']*\buicontrol\b[^"']*["'][^>]*>[^<]+<\/span>\s*$/.test(html);
      if (isSyntheticHeading) {
        paragraphsBecomeHeadings++;
      }
    });
    
    const paragraphs = allParagraphs - paragraphsInTables - paragraphsPromotedToListText - paragraphsBecomeHeadings;
    
    // Count headings (excluding h1 which is used as the page title)
    let headings = $('h2, h3, h4, h5, h6').length;
    
    // Count synthetic section headings: ServiceNow sections without h2 tags use
    // <p class="p"><span class="ph uicontrol">Title</span></p> which get converted to heading_2
    // These paragraphs contain ONLY a single UIControl span (no other content)
    let syntheticHeadings = 0;
    $('section > p.p').each((i, p) => {
      const $p = $(p);
      const html = $p.html() || '';
      // Match paragraphs with ONLY a single UIControl span (with optional whitespace)
      const isSyntheticHeading = /^\s*<span[^>]*class=["'][^"']*\bph\b[^"']*\buicontrol\b[^"']*["'][^>]*>[^<]+<\/span>\s*$/.test(html);
      if (isSyntheticHeading) {
        syntheticHeadings++;
      }
    });
    
    if (syntheticHeadings > 0) {
      console.log(`📊 [VALIDATION] Found ${syntheticHeadings} synthetic UIControl headings (will be converted to heading_2)`);
      headings += syntheticHeadings;
    }
    
    // FIX v11.0.30: Count only top-level tables (exclude nested tables inside cells)
    // Notion doesn't support nested tables, so they get flattened or converted to other blocks
    const allTables = $('table').length;
    const nestedTables = $('table table').length; // Tables inside other tables
    const tables = allTables - nestedTables;
    
    if (nestedTables > 0) {
      console.log(`📊 [VALIDATION] Found ${nestedTables} nested table(s) inside other tables (excluded from count, total ${allTables})`);
    }
    
    // Count images (excluding images inside tables - those get removed in processing)
    const allImages = $('img').length;
    const imagesInTables = $('table img').length;
    const images = allImages - imagesInTables;
    
    // Count callouts/notes (excluding those inside tables - Notion table cells can't contain callouts)
    // Includes: div.note/info/warning/important/tip/caution, aside, and section.prereq ("Before you begin")
    // Excludes: div.itemgroup (ServiceNow containers, not actual callouts even if they have info/note classes)
    // Excludes: callouts nested inside other callouts (Notion can't nest callouts, so these get moved to markers)
    const allCallouts = $('div.note, div.info, div.warning, div.important, div.tip, div.caution, aside, section.prereq').length;
    const itemgroupCallouts = $('div.itemgroup.note, div.itemgroup.info, div.itemgroup.warning, div.itemgroup.important, div.itemgroup.tip, div.itemgroup.caution').length;
    const calloutsInTables = $('table div.note, table div.info, table div.warning, table div.important, table div.tip, table div.caution, table aside, table section.prereq').length;
    
    // Count callouts that are nested inside other callouts (direct or via list items)
    // These can't be rendered in Notion since callouts can't contain callouts, so they get moved to marker-based orchestration
    // NOTE: Must check for nesting BEFORE excluding tables/itemgroups, otherwise we might count nested callouts inside tables
    let nestedCallouts = 0;
    $('div.note, div.info, div.warning, div.important, div.tip, div.caution, aside, section.prereq').each((i, callout) => {
      const $callout = $(callout);
      
      // Skip if this is an itemgroup container (not a real callout)
      if ($callout.hasClass('itemgroup')) {
        return; // continue to next callout
      }
      
      // Skip if this callout is inside a table (already excluded)
      if ($callout.closest('table').length > 0) {
        return; // continue to next callout
      }
      
      // Check if this callout is inside another callout (directly or via list item)
      // Use .parent().closest() instead of just .closest() to exclude the callout itself
      // IMPORTANT: Exclude div.itemgroup from parent search - itemgroups are containers, not callouts
      const parentCallout = $callout.parent().closest('div.note:not(.itemgroup), div.info:not(.itemgroup), div.warning:not(.itemgroup), div.important:not(.itemgroup), div.tip:not(.itemgroup), div.caution:not(.itemgroup), aside, section.prereq');
      if (parentCallout.length > 0) {
        // Double-check that parent is not an itemgroup (belt and suspenders)
        if (!parentCallout.hasClass('itemgroup')) {
          nestedCallouts++;
        }
      }
    });
    
    const callouts = allCallouts - itemgroupCallouts - calloutsInTables - nestedCallouts;
    
    // Count code blocks (excluding those inside tables - Notion table cells can't contain code blocks)
    const allCodeBlocks = $('pre').length;
    const codeBlocksInTables = $('table pre').length;
    const codeBlocks = allCodeBlocks - codeBlocksInTables;
    
    // Log paragraph count details if paragraphs were excluded
    if (paragraphsInTables > 0 || paragraphsPromotedToListText > 0 || paragraphsBecomeHeadings > 0) {
      const exclusions = [];
      if (paragraphsInTables > 0) exclusions.push(`${paragraphsInTables} in tables`);
      if (paragraphsPromotedToListText > 0) exclusions.push(`${paragraphsPromotedToListText} promoted to list item text`);
      if (paragraphsBecomeHeadings > 0) exclusions.push(`${paragraphsBecomeHeadings} converted to headings`);
      console.log(`📊 [VALIDATION] Paragraph count: ${allParagraphs} total, ${exclusions.join(', ')} (excluded), ${paragraphs} counted for validation`);
    }
    
    // Log image count details if images were excluded from tables
    if (imagesInTables > 0) {
      console.log(`📊 [VALIDATION] Image count: ${allImages} total, ${imagesInTables} in tables (excluded), ${images} counted for validation`);
    }
    
    // Log callout count details if callouts were excluded from tables, itemgroups, or nested callouts
    if (calloutsInTables > 0 || itemgroupCallouts > 0 || nestedCallouts > 0) {
      const exclusions = [];
      if (itemgroupCallouts > 0) exclusions.push(`${itemgroupCallouts} itemgroup containers`);
      if (calloutsInTables > 0) exclusions.push(`${calloutsInTables} in tables`);
      if (nestedCallouts > 0) exclusions.push(`${nestedCallouts} nested in other callouts`);
      console.log(`📊 [VALIDATION] Callout count: ${allCallouts} total, ${exclusions.join(', ')} (excluded), ${callouts} counted for validation`);
    }
    
    // Log list item count details if list items were excluded from nav
    if (orderedListItemsInNav > 0) {
      console.log(`📊 [VALIDATION] Ordered list item count: ${allOrderedListItems} total, ${orderedListItemsInNav} in nav (excluded, become paragraphs), ${orderedListItems} counted for validation`);
    }
    if (unorderedListItemsInNav > 0) {
      console.log(`📊 [VALIDATION] Unordered list item count: ${allUnorderedListItems} total, ${unorderedListItemsInNav} in nav (excluded, become paragraphs), ${unorderedListItems} counted for validation`);
    }
    
    // Log code block count details if code blocks were excluded from tables
    if (codeBlocksInTables > 0) {
      console.log(`📊 [VALIDATION] Code block count: ${allCodeBlocks} total, ${codeBlocksInTables} in tables (excluded, become plain text), ${codeBlocks} counted for validation`);
    }
    
    return {
      orderedListItems,
      unorderedListItems,
      totalListItems,
      paragraphs,
      headings,
      tables,
      images,
      callouts,
      codeBlocks
    };
  } catch (error) {
    console.error('Error parsing source HTML:', error.message);
    return null;
  }
}

/**
 * Validate a created Notion page
 * @param {Object} notion - Notion client instance
 * @param {string} pageId - Page ID to validate
 * @param {Object} options - Validation options
 * @param {number} options.expectedMinBlocks - Minimum expected block count
 * @param {number} options.expectedMaxBlocks - Maximum expected block count
 * @param {Array<string>} options.expectedHeadings - Array of expected heading text (case-insensitive)
 * @param {string} options.sourceHtml - Original HTML content for comparison
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

    // VALIDATION 5: Source HTML content comparison
    if (options.sourceHtml) {
      log(`🔍 [VALIDATION] Comparing with source HTML...`);
      const sourceCounts = parseSourceHtmlCounts(options.sourceHtml);
      
      if (sourceCounts) {
        log(`📊 [VALIDATION] Source HTML counts:`, JSON.stringify(sourceCounts, null, 2));
        result.sourceCounts = sourceCounts;
        const notionCounts = {
          orderedListItems: blockTypes.numbered_list_item || 0,
          unorderedListItems: blockTypes.bulleted_list_item || 0,
          totalListItems: (blockTypes.numbered_list_item || 0) + (blockTypes.bulleted_list_item || 0),
          paragraphs: blockTypes.paragraph || 0,
          headings: (blockTypes.heading_1 || 0) + (blockTypes.heading_2 || 0) + (blockTypes.heading_3 || 0),
          tables: blockTypes.table || 0,
          images: blockTypes.image || 0,
          callouts: blockTypes.callout || 0,
          codeBlocks: blockTypes.code || 0
        };
        log(`📊 [VALIDATION] Notion block counts:`, JSON.stringify(notionCounts, null, 2));
        result.notionCounts = notionCounts;

        // CRITICAL ELEMENT VALIDATION (determines pass/fail/warning)
        // FIX v11.0.30: Tables - allow ±1 tolerance for minor counting differences
        // Nested tables, wrapper divs, or HTML parsing inconsistencies can cause ±1 variance
        let tablesMismatch = false;
        if (sourceCounts.tables > 0) {
          const tableDiff = Math.abs(notionCounts.tables - sourceCounts.tables);
          const tableTolerance = 1; // Allow ±1 table difference
          
          if (tableDiff === 0) {
            // Exact match - perfect!
            log(`✅ [VALIDATION] Table count matches exactly: ${notionCounts.tables}/${sourceCounts.tables}`);
          } else if (tableDiff <= tableTolerance) {
            // Within tolerance - acceptable (not an error, just informational)
            log(`ℹ️ [VALIDATION] Table count within tolerance: ${notionCounts.tables}/${sourceCounts.tables} (±${tableDiff}, tolerance ±${tableTolerance})`);
            result.warnings.push(`Table count differs slightly: expected ${sourceCounts.tables}, got ${notionCounts.tables} (within ±${tableTolerance} tolerance - may be nested tables or HTML parsing differences)`);
          } else {
            // Beyond tolerance - check for legitimate 100-row splitting
            const hasSplitTableCallout = allBlocks.some(block => 
              block.type === 'callout' && 
              block.callout?.rich_text?.some(rt => 
                rt.text?.content?.includes('split into') && 
                rt.text?.content?.includes('tables') &&
                rt.text?.content?.includes('100-row')
              )
            );
            
            if (hasSplitTableCallout && notionCounts.tables > sourceCounts.tables) {
              // Extra tables are due to legitimate 100-row splitting, not an error
              log(`ℹ️ [VALIDATION] Table count higher due to 100-row splitting: ${notionCounts.tables}/${sourceCounts.tables}`);
              result.warnings.push(`Table count higher: ${sourceCounts.tables} source table(s) split into ${notionCounts.tables} Notion tables due to 100-row limit`);
            } else {
              // Beyond tolerance and not splitting - this is an error
              tablesMismatch = true;
              result.hasErrors = true;
              result.issues.push(`Table count mismatch: expected ${sourceCounts.tables}, got ${notionCounts.tables} (difference of ${tableDiff}, beyond ±${tableTolerance} tolerance)`);
              log(`❌ [VALIDATION] Table count mismatch: ${notionCounts.tables}/${sourceCounts.tables} (diff: ${tableDiff})`);
            }
          }
        }

        // Images must match (with small tolerance for upload failures)
        let imagesMismatch = false;
        if (sourceCounts.images > 0 && notionCounts.images < sourceCounts.images) {
          imagesMismatch = true;
          result.hasErrors = true;
          result.issues.push(`Image count mismatch: expected ${sourceCounts.images}, got ${notionCounts.images}`);
          log(`❌ [VALIDATION] Image count mismatch: ${notionCounts.images}/${sourceCounts.images}`);
        } else if (sourceCounts.images > 0) {
          log(`✅ [VALIDATION] Image count acceptable: ${notionCounts.images}/${sourceCounts.images}`);
        }

        // Callouts - STRICT validation (must match exactly)
        // Callouts are structural elements that should convert 1:1 from source
        // Duplicates indicate a processing bug, missing callouts indicate dropped content
        let calloutsMismatch = false;
        if (sourceCounts.callouts > 0) {
          if (notionCounts.callouts < sourceCounts.callouts) {
            // Fewer callouts - dropped content (critical error)
            calloutsMismatch = true;
            result.hasErrors = true;
            const missing = sourceCounts.callouts - notionCounts.callouts;
            result.issues.push(`Missing callouts: expected ${sourceCounts.callouts}, got ${notionCounts.callouts} (${missing} missing)`);
            log(`❌ [VALIDATION] Callout count too low: ${notionCounts.callouts}/${sourceCounts.callouts} (${missing} missing)`);
          } else if (notionCounts.callouts > sourceCounts.callouts) {
            // More callouts - likely duplicates (critical error)
            calloutsMismatch = true;
            result.hasErrors = true;
            const extra = notionCounts.callouts - sourceCounts.callouts;
            result.issues.push(`Duplicate callouts: expected ${sourceCounts.callouts}, got ${notionCounts.callouts} (${extra} duplicate)`);
            log(`❌ [VALIDATION] Callout count too high: ${notionCounts.callouts}/${sourceCounts.callouts} (${extra} duplicate)`);
          } else {
            log(`✅ [VALIDATION] Callout count matches: ${notionCounts.callouts}/${sourceCounts.callouts}`);
          }
        }

        // Headings - use tolerance for splitting behavior
        // Note: Headings can be split into multiple blocks if they exceed 100 rich_text elements
        // Also: h4/h5/h6 get downgraded to h3 (Notion only supports heading_1/2/3)
        // Allow up to 20% more headings to account for splitting and downgrading
        let headingsFewer = false;
        let headingsMore = false;
        if (sourceCounts.headings > 0) {
          const minExpected = Math.floor(sourceCounts.headings * 0.8); // Allow 20% fewer (merged/lost)
          const maxExpected = Math.ceil(sourceCounts.headings * 1.2); // Allow 20% more (split/downgraded)
          
          if (notionCounts.headings < minExpected) {
            headingsFewer = true;
            result.hasErrors = true;
            result.issues.push(`Heading count too low: expected ~${sourceCounts.headings} (±20%), got ${notionCounts.headings}`);
            log(`❌ [VALIDATION] Heading count too low: ${notionCounts.headings} < ${minExpected} (source: ${sourceCounts.headings})`);
          } else if (notionCounts.headings > maxExpected) {
            headingsMore = true;
            result.warnings.push(`Extra headings: expected ~${sourceCounts.headings} (±20%), got ${notionCounts.headings} (may be split headings)`);
            log(`⚠️ [VALIDATION] Heading count higher than expected: ${notionCounts.headings} > ${maxExpected} (source: ${sourceCounts.headings})`);
          } else {
            log(`✅ [VALIDATION] Heading count within range: ${notionCounts.headings} (source: ${sourceCounts.headings}, range: ${minExpected}-${maxExpected})`);
          }
        }

        // List items - informational only (counting methodology differs)
        if (sourceCounts.orderedListItems > 0) {
          if (notionCounts.orderedListItems < sourceCounts.orderedListItems) {
            const missing = sourceCounts.orderedListItems - notionCounts.orderedListItems;
            result.warnings.push(`Ordered list item count differs: expected ${sourceCounts.orderedListItems}, got ${notionCounts.orderedListItems} (${missing} fewer - may be counting methodology difference)`);
            log(`ℹ️ [VALIDATION] Ordered list item count differs: ${notionCounts.orderedListItems}/${sourceCounts.orderedListItems} (informational)`);
          } else if (notionCounts.orderedListItems > sourceCounts.orderedListItems) {
            const extra = notionCounts.orderedListItems - sourceCounts.orderedListItems;
            result.warnings.push(`Extra ordered list items: expected ${sourceCounts.orderedListItems}, got ${notionCounts.orderedListItems} (${extra} extra - may be counting methodology difference)`);
            log(`ℹ️ [VALIDATION] ${extra} extra ordered list item(s) (informational)`);
          } else {
            log(`✅ [VALIDATION] Ordered list items match: ${notionCounts.orderedListItems}/${sourceCounts.orderedListItems}`);
          }
        }

        if (sourceCounts.unorderedListItems > 0) {
          if (notionCounts.unorderedListItems < sourceCounts.unorderedListItems) {
            const missing = sourceCounts.unorderedListItems - notionCounts.unorderedListItems;
            result.warnings.push(`Unordered list item count differs: expected ${sourceCounts.unorderedListItems}, got ${notionCounts.unorderedListItems} (${missing} fewer - may be counting methodology difference)`);
            log(`ℹ️ [VALIDATION] Unordered list item count differs: ${notionCounts.unorderedListItems}/${sourceCounts.unorderedListItems} (informational)`);
          } else if (notionCounts.unorderedListItems > sourceCounts.unorderedListItems) {
            const extra = notionCounts.unorderedListItems - sourceCounts.unorderedListItems;
            result.warnings.push(`Extra unordered list items: expected ${sourceCounts.unorderedListItems}, got ${notionCounts.unorderedListItems} (${extra} extra - may be counting methodology difference)`);
            log(`ℹ️ [VALIDATION] ${extra} extra unordered list item(s) (informational)`);
          } else {
            log(`✅ [VALIDATION] Unordered list items match: ${notionCounts.unorderedListItems}/${sourceCounts.unorderedListItems}`);
          }
        }

        // Paragraphs - informational only (counting methodology is imprecise)
        // Paragraphs can be split (>100 rich_text), filtered (empty), or wrapped (orphan content)
        // Use 50% tolerance and only log extreme differences as informational notes
        if (sourceCounts.paragraphs > 0) {
          const tolerance = Math.ceil(sourceCounts.paragraphs * 0.5); // 50% tolerance (very loose)
          const minExpected = Math.max(1, sourceCounts.paragraphs - tolerance);
          const maxExpected = sourceCounts.paragraphs + tolerance;
          
          if (notionCounts.paragraphs < minExpected) {
            // Only add as informational note, not a warning
            result.warnings.push(`ℹ️ Paragraph count lower than expected: ~${sourceCounts.paragraphs} (±${tolerance}), got ${notionCounts.paragraphs} (may be filtered empty paragraphs or promoted to list items)`);
            log(`ℹ️ [VALIDATION] Paragraph count low: ${notionCounts.paragraphs} < ${minExpected} (source: ${sourceCounts.paragraphs}) - informational only`);
          } else if (notionCounts.paragraphs > maxExpected) {
            // Only add as informational note, not a warning
            result.warnings.push(`ℹ️ Paragraph count higher than expected: ~${sourceCounts.paragraphs} (±${tolerance}), got ${notionCounts.paragraphs} (may be split paragraphs or wrapped orphan content)`);
            log(`ℹ️ [VALIDATION] Paragraph count high: ${notionCounts.paragraphs} > ${maxExpected} (source: ${sourceCounts.paragraphs}) - informational only`);
          } else {
            log(`✅ [VALIDATION] Paragraph count within range: ${notionCounts.paragraphs} (source: ${sourceCounts.paragraphs}, range: ${minExpected}-${maxExpected})`);
          }
        }

        log(`🔍 [VALIDATION] Source comparison complete`);
      } else {
        log(`⚠️ [VALIDATION] Could not parse source HTML for comparison`);
      }
    }

    // Generate summary based on critical element validation
    if (result.hasErrors) {
      result.success = false;
      result.summary = `❌ Validation failed: ${result.issues.length} critical error(s)`;
      if (result.warnings.length > 0) {
        result.summary += `, ${result.warnings.length} informational warning(s)`;
      }
      result.summary += `\n\n❌ Critical Errors:\n${result.issues.map((e, i) => `${i + 1}. ${e}`).join('\n')}`;
      if (result.warnings.length > 0) {
        result.summary += `\n\nℹ️ Informational Warnings:\n${result.warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;
      }
    } else if (result.warnings.length > 0) {
      result.success = true; // Warnings don't cause failure
      result.summary = `✅ Validation passed (critical elements match)\n\nℹ️ ${result.warnings.length} informational note(s):\n${result.warnings.map((w, i) => `${i + 1}. ${w}`).join('\n')}`;
    } else {
      result.success = true;
      result.summary = `✅ Validation passed: ${allBlocks.length} blocks, ${headings.length} headings, all critical elements match`;
    }

    // Add source comparison to summary if available
    if (result.sourceCounts && result.notionCounts) {
      result.summary += `\n\n📊 Content Comparison (Source → Notion):`;
      result.summary += `\n• Ordered list items: ${result.sourceCounts.orderedListItems} → ${result.notionCounts.orderedListItems}`;
      result.summary += `\n• Unordered list items: ${result.sourceCounts.unorderedListItems} → ${result.notionCounts.unorderedListItems}`;
      result.summary += `\n• Paragraphs: ${result.sourceCounts.paragraphs} → ${result.notionCounts.paragraphs}`;
      result.summary += `\n• Headings: ${result.sourceCounts.headings} → ${result.notionCounts.headings}`;
      result.summary += `\n• Tables: ${result.sourceCounts.tables} → ${result.notionCounts.tables}`;
      result.summary += `\n• Images: ${result.sourceCounts.images} → ${result.notionCounts.images}`;
      result.summary += `\n• Callouts: ${result.sourceCounts.callouts} → ${result.notionCounts.callouts}`;
    }

    // Note: Stats are now stored in a separate "Stats" property, not in the summary
    // This keeps the Validation property focused on issues/warnings
    // and makes Stats separately queryable in Notion

    log(`🔍 [VALIDATION] Complete: ${result.success ? 'PASSED' : 'FAILED'}`);
    
  } catch (error) {
    result.success = false;
    result.hasErrors = true;
    result.issues.push(`Validation error: ${error.message}`);
    result.summary = `❌ Validation failed with error: ${error.message}`;
    log(`❌ [VALIDATION] Error during validation: ${error.message}`);
  }

  // FIX v11.0.29: SAFEGUARD - Ensure summary is NEVER empty
  // This prevents empty strings from being sent to Notion, which would store as empty arrays
  if (!result.summary || result.summary.trim() === '') {
    log(`⚠️ [VALIDATION] Summary is empty - using fallback message`);
    result.summary = '⚠️ Validation ran but no summary was generated';
    result.hasErrors = true;
    if (!result.issues) result.issues = [];
    result.issues.push('Internal error: validation summary was empty');
  }
  
  log(`🔍 [VALIDATION] Final summary (${result.summary.length} chars): ${result.summary.substring(0, 100)}...`);

  return result;
}

module.exports = {
  validateNotionPage,
  fetchAllBlocks,
  checkBlockForMarkers,
  extractText,
  parseSourceHtmlCounts
};
