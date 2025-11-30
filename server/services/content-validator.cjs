/**
 * Content Validator Service
 * 
 * Validates that content was correctly converted from HTML to Notion
 * by comparing plain text content, order, and completeness.
 * 
 * Automatically runs after page creation and updates Notion properties.
 */

const cheerio = require('cheerio');
const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// File logger for order detection (too verbose for terminal)
let logFilePath = null;
let logStream = null;

function initOrderLog(pageId) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  logFilePath = path.join(logsDir, `order-detection-${pageId.substring(0, 8)}-${timestamp}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  console.log(`[ORDER-DEBUG] 📝 Detailed logs: ${logFilePath}`);
}

function logToFile(message) {
  if (logStream) {
    logStream.write(message + '\n');
  }
  // Don't duplicate to console - file only
}

function closeOrderLog() {
  if (logStream) {
    const savedPath = logFilePath;
    logStream.end();
    logStream = null;
    logFilePath = null;
    if (savedPath) {
      console.log(`[ORDER-DEBUG] 📝 Full log saved to: ${savedPath}`);
    }
  }
}

/**
 * Extract plain text from HTML
 * @param {string} html - HTML content
 * @returns {string[]} Array of text segments
 */
 function extractPlainTextFromHtml(html, options = {}) {
   const { includeBoilerplate = false } = options;
  const $ = cheerio.load(html);
   const segments = [];
  
  // Scope to main article task body when present to avoid side boxes/mini TOC noise
  const $scope = $('article .body.taskbody').length ? $('article .body.taskbody') : $('body');
  
  // Skip figcaptions FIRST - they're merged into image captions in Notion, not separate blocks
  // This prevents them from being picked up as paragraphs/headings and causing segment count mismatches
  $scope.find('figcaption').each((_, el) => {
    $(el).remove();
  });
   
  // Helper: get consolidated text from an element, merging inline children
  function consolidatedText($el) {
    const nodes = $el.contents().get();
    const parts = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      if (node.type === 'text') {
        let t = $(node).text() || '';
        parts.push(t);
      } else if (node.type === 'tag') {
        const tag = node.name.toLowerCase();
        if (tag === 'br') {
          parts.push('\n');
          continue;
        }
        if (tag === 'code' || tag === 'kbd') {
          parts.push($(node).text() || '');
          continue;
        }
        // For other inline tags, recursively extract text
        // DON'T use $(node).text() - Cheerio adds spaces between inline elements!
        // Instead, recursively process child nodes to preserve original spacing
        const childText = consolidatedText($(node));
        if (!childText) continue;
        
        parts.push(childText);
      }
    }
    const raw = parts.join('');
    // Normalize whitespace: collapse ALL whitespace to single spaces
    return raw.replace(/\s+/g, ' ').trim();
  }
  
  // Helper: group segments from the same section
  function groupSectionSegments(segments) {
    // For section headings followed by content, merge them
    const grouped = [];
    let i = 0;
    while (i < segments.length) {
      const current = segments[i];
      const currentNorm = normalizePhrase(current);
      
      // Check if this looks like a section heading (short, <60 chars, no punctuation at end)
      const isHeading = current.length < 60 && !/[.!?]$/.test(current.trim());
      
      // If heading and next segment exists, combine them
      if (isHeading && i + 1 < segments.length) {
        const next = segments[i + 1];
        grouped.push(current + '\n' + next);
        i += 2;
      } else {
        grouped.push(current);
        i++;
      }
    }
    return grouped;
  }   // Boilerplate filters – patterns to skip entirely
   const boilerplatePatterns = [
     /^(on\s+this\s+page|table\s+of\s+contents)\b/i,
     /^(related\s+articles?|see\s+also|related\s+content)\b/i,
     /^(was\s+this\s+article\s+helpful|feedback|rate\s+this)\b/i,
     /^(last\s+updated|version\s+history)\b/i,
     /^all\s*>\s*[a-z0-9][^>]*>\s*/i,
     /^(home|docs|documentation)\s*>\s*[\w\s-]+\s*>/i,
   ];
 
   function isBoilerplate(text) {
     const t = normalizeText(text);
     return boilerplatePatterns.some((re) => re.test(t));
   }
 
   // CRITICAL FIX: Extract in document order, not by element type
  // Previously extracted all headings first, then all paragraphs, etc.
  // This caused "Learn" heading (at end) to appear before intro paragraphs
  
  // Track elements we've already processed to avoid duplicates
  const processed = new Set();
  
  // Walk through all potential content elements in document order
  $scope.find('h1, h2, h3, h4, h5, h6, p, li, div, aside, table').each((_, el) => {
    if (processed.has(el)) return;
    processed.add(el);
    
    const $el = $(el);
    const tagName = el.tagName.toLowerCase();
    
    // Handle headings
    if (/^h[1-6]$/.test(tagName)) {
      // Skip headings that are inside tables - they'll be extracted as part of table content
      if ($el.closest('table').length > 0) return;
      
      const txt = $el.text();
      if (!txt) return;
      if (!includeBoilerplate && isBoilerplate(txt)) return;
      segments.push(txt);
      return;
    }
    
    // Handle paragraphs
    if (tagName === 'p') {
      const txt = consolidatedText($el);
      if (!txt) return;
      // Skip "What to do next" content if within a postreq section
      const parentSection = $el.closest('section');
      const sectionClass = (parentSection.attr('class') || '').toLowerCase();
      const sectionTitle = normalizeText(parentSection.find('.sectiontitle, .tasklabel .sectiontitle').first().text() || '');
      if (/postreq/.test(sectionClass) || /^what to do next$/.test(sectionTitle)) return;
      if (!includeBoilerplate && isBoilerplate(txt)) return;
      segments.push(txt);
      return;
    }
    
    // Handle list items
    if (tagName === 'li') {
      const txt = consolidatedText($el);
      if (!txt) return;
      if (!includeBoilerplate && isBoilerplate(txt)) return;
      segments.push(txt);
      return;
    }
    
    // Handle callouts
    if (tagName === 'div' || tagName === 'aside') {
      const cls = ($el.attr('class') || '').toLowerCase();
      if (/note|warning|info|tip|important|caution|note_note|warning_type/.test(cls)) {
        const txt = consolidatedText($el);
        if (txt && (includeBoilerplate || !isBoilerplate(txt))) segments.push(txt);
      }
      return;
    }
    
    // Handle tables
    if (tagName === 'table') {
      const caption = $el.find('caption').text();
      if (caption && (includeBoilerplate || !isBoilerplate(caption))) segments.push(caption);
      const headers = $el.find('thead th');
      if (headers.length) {
        const headerText = headers
          .map((i, th) => $(th).text().trim())
          .get()
          .filter(Boolean)
          .join(' | ');
        if (headerText) segments.push(headerText);
      }
      $el.find('tbody tr').each((__, tr) => {
        const rowText = $(tr)
          .find('td, th')
          .map((i, cell) => consolidatedText($(cell)))
          .get()
          .filter(Boolean)
          .join(' | ');
        const cleaned = rowText.replace(/\s{2,}/g, ' ').trim();
        if (cleaned) segments.push(cleaned);
      });
      return;
    }
  });
 
   // Fallback leaves
  $scope.find('pre, code').each((_, el) => {
     const txt = $(el).text();
     if (txt) segments.push(txt);
   });
 
   // Normalize, dedupe, and filter blanks (don't group - use fuzzy matching instead)
  const normalized = segments.map((s) => normalizeText(s)).filter((s) => s.length > 0);
  const dedupeSet = new Set();
  const finalSegments = [];
  for (const s of normalized) {
    if (dedupeSet.has(s)) continue;
    dedupeSet.add(s);
    finalSegments.push(s);
  }
  // Targeted tidy: catch a small class of accidental run-on tokens
  // (e.g., "toincident" -> "to incident") that can appear when
  // inline tags are removed without spacing. This is a conservative,
  // low-risk normalization applied only to the validator extractor.
  const tidy = finalSegments.map(f => f.replace(/\bto(?=[a-z])/gi, 'to '));
  return tidy;
  
  // Include list items as grouped segments: parent text + inline text within direct children
  $('li').each((_, li) => {
    const $li = $(li);
    const inlineTexts = [];
    $li.contents().each((_, node) => {
      if (node.type === 'text') {
        const t = ($(node).text() || '').trim();
        if (t) inlineTexts.push(t);
      } else if (node.type === 'tag') {
        const name = node.name?.toLowerCase();
        if (['span','abbr','em','strong','code','kbd','i','b'].includes(name)) {
          const t = $(node).text().trim();
          if (t) inlineTexts.push(t);
        }
      }
    });
    const grouped = inlineTexts.join(' ').replace(/\s+/g, ' ').trim();
    pushText(grouped);
  });
  
  // Include callout titles/notes if present
  $('.note, .callout, .warning, .info').each((_, el) => {
    pushText($(el).text());
  });
  
  // Include table captions and group header/body rows
  $('table').each((_, table) => {
    const $table = $(table);
    const caption = $table.find('caption').text();
    if (caption) pushText(caption);
    const headerCells = [];
    $table.find('thead th').each((_, th) => {
      const t = $(th).text().trim();
      if (t) headerCells.push(t);
    });
    if (headerCells.length) pushText(headerCells.join(' | '));
    $table.find('tbody tr').each((_, tr) => {
      const rowCells = [];
      $(tr).find('td').each((_, td) => {
        const t = $(td).text().trim();
        if (t) rowCells.push(t);
      });
      if (rowCells.length) pushText(rowCells.join(' | '));
    });
  });
  
  // Fallback: include remaining leaf text nodes not covered above (avoid duplicates)
  const seen = new Set();
  $('body *').each((_, elem) => {
    const $elem = $(elem);
    if ($elem.children().length > 0) return; // leaf only
    const text = ($elem.text() || '').trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      textSegments.push(text);
    }
  });
  
  return textSegments;
}

/**
 * Extract text from Notion blocks recursively
 * @param {Object} notion - Notion client
 * @param {string} blockId - Block ID to start from
 * @returns {Promise<string[]>} Array of text segments
 */
async function extractTextFromNotionBlocks(notion, blockId) {
  const textSegments = [];
  const blockMetadata = []; // Track block IDs, types, and positions
  let blockPosition = 0; // Global position counter
  
  async function processBlock(block, depth = 0) {
    const type = block.type;
    const data = block[type];
    
    if (!data) {
      // Process children even if no data
      if (block.has_children) {
        try {
          const children = await notion.blocks.children.list({ block_id: block.id });
          // Process in Notion API order (visual order)
          for (const child of children.results) {
            await processBlock(child, depth + 1);
          }
        } catch (error) {
          console.warn(`Failed to fetch children for block ${block.id}:`, error.message);
        }
      }
      return;
    }
    
    // Helper: strip orchestration marker tokens embedded in text
    function stripSn2nMarker(text) {
      if (!text || typeof text !== 'string') return text;
      // Remove marker tokens but preserve newlines and internal spacing so the
      // validator's newline-splitting logic can still separate multi-line callouts.
      return text
        .replace(/\(sn2n:[^)]+\)/gi, '')
        .replace(/\bsn2n[: ]?[-\w]+\b/gi, '')
        .trim();
    }

    // If a block was preserved with an orchestration marker (deferred append),
    // skip its top-level text for validation comparison so we don't count the
    // same content twice (once as a child after orchestration and once as a
    // top-level placeholder). Still recurse into children if present.
    const isMarkerPreserved = Boolean(block._sn2n_marker);

    // Extract rich_text from all block types that have it
    if (Array.isArray(data.rich_text) && data.rich_text.length > 0) {
      const rawText = data.rich_text
        .map(rt => rt.plain_text || rt.text?.content || '')
        .join('')
        .trim();
      const cleaned = stripSn2nMarker(rawText);
      if (cleaned && !isMarkerPreserved) {
        // If the block contains explicit newlines (multi-line callouts), push
        // the individual lines as separate segments for validation. This is
        // validation-only behavior to reduce false negatives when converters
        // emit multi-line callouts.
        if (/\n/.test(rawText)) {
          const parts = rawText.split(/\n+/).map(p => stripSn2nMarker(p).trim()).filter(Boolean);
          for (const p of parts) {
            const metaIndex = blockMetadata.length;
            textSegments.push(p);
            // Store metadata index with segment so we can look it up later
            if (!textSegments._metaIndices) textSegments._metaIndices = [];
            textSegments._metaIndices.push(metaIndex);
            // Track metadata for each segment
            blockMetadata.push({
              blockId: block.id,
              blockType: type,
              position: blockPosition++,
              depth: depth,
              text: p.substring(0, 80)
            });
          }
        } else {
          const metaIndex = blockMetadata.length;
          textSegments.push(cleaned);
          // Store metadata index with segment so we can look it up later
          if (!textSegments._metaIndices) textSegments._metaIndices = [];
          textSegments._metaIndices.push(metaIndex);
          // Track metadata
          blockMetadata.push({
            blockId: block.id,
            blockType: type,
            position: blockPosition++,
            depth: depth,
            text: cleaned.substring(0, 80)
          });
        }
      }
    }
    
    // Extract title (for toggle, table_of_contents, etc.)
    if (Array.isArray(data.title) && data.title.length > 0) {
      const rawTitle = data.title
        .map(rt => rt.plain_text || rt.text?.content || '')
        .join('')
        .trim();
      const cleanedTitle = (typeof stripSn2nMarker === 'function') ? stripSn2nMarker(rawTitle) : rawTitle;
      if (cleanedTitle && !isMarkerPreserved) {
        const metaIndex = blockMetadata.length;
        textSegments.push(cleanedTitle);
        if (!textSegments._metaIndices) textSegments._metaIndices = [];
        textSegments._metaIndices.push(metaIndex);
        blockMetadata.push({
          blockId: block.id,
          blockType: type,
          position: blockPosition++,
          depth: depth,
          text: cleanedTitle.substring(0, 80)
        });
      }
    }
    
    // Extract caption (for images, videos, files, etc.)
    if (Array.isArray(data.caption) && data.caption.length > 0) {
      const rawCaption = data.caption
        .map(rt => rt.plain_text || rt.text?.content || '')
        .join('')
        .trim();
      const cleanedCaption = (typeof stripSn2nMarker === 'function') ? stripSn2nMarker(rawCaption) : rawCaption;
      if (cleanedCaption && !isMarkerPreserved) {
        const metaIndex = blockMetadata.length;
        textSegments.push(cleanedCaption);
        if (!textSegments._metaIndices) textSegments._metaIndices = [];
        textSegments._metaIndices.push(metaIndex);
        blockMetadata.push({
          blockId: block.id,
          blockType: type,
          position: blockPosition++,
          depth: depth,
          text: cleanedCaption.substring(0, 80)
        });
      }
    }
    
    // Handle table rows specially
    // CRITICAL FIX: All cells in the same row should share the same position
    // since they're part of one visual unit. This prevents false inversions
    // when comparing table structure to surrounding content.
    if (type === 'table_row' && Array.isArray(data.cells)) {
      const rowPosition = blockPosition; // Capture position before processing cells
      let hasCells = false;
      
      for (const cell of data.cells) {
        if (Array.isArray(cell) && cell.length > 0) {
          const cellText = cell
            .map(rt => rt.plain_text || rt.text?.content || '')
            .join('')
            .trim();
          if (cellText) {
            hasCells = true;
            const metaIndex = blockMetadata.length;
            textSegments.push(cellText);
            if (!textSegments._metaIndices) textSegments._metaIndices = [];
            textSegments._metaIndices.push(metaIndex);
            blockMetadata.push({
              blockId: block.id,
              blockType: type,
              position: rowPosition, // Use same position for all cells in this row
              depth: depth,
              text: cellText.substring(0, 80)
            });
          }
        }
      }
      
      // Only increment position once per row, not per cell
      if (hasCells) {
        blockPosition++;
      }
    }
    
    // Process children recursively
    if (block.has_children) {
      try {
        const children = await notion.blocks.children.list({ block_id: block.id });
        // Process in Notion API order (visual order)
        for (const child of children.results) {
          await processBlock(child, depth + 1);
        }
      } catch (error) {
        console.warn(`Failed to fetch children for block ${block.id}:`, error.message);
      }
    }
  }
  
  // Fetch page blocks
  try {
    const response = await notion.blocks.children.list({ block_id: blockId });
    console.log(`\n[BLOCK-ID-DEBUG] ========================================`);
    console.log(`[BLOCK-ID-DEBUG] Fetching blocks from page: ${blockId}`);
    console.log(`[BLOCK-ID-DEBUG] Total top-level blocks: ${response.results.length}`);
    console.log(`[BLOCK-ID-DEBUG] Using Notion API order (visual order on page)`);
    console.log(`[BLOCK-ID-DEBUG] ========================================`);
    
    // Process blocks in the order Notion API returns them (which is visual order)
    for (const block of response.results) {
      await processBlock(block, 0);
    }
    
    // Re-assign positions sequentially based on final order in metadata array
    // This ensures positions always match the order blocks were processed (0, 1, 2, 3...)
    console.log(`\n[BLOCK-ID-DEBUG] BEFORE re-assignment, first 5 positions: ${blockMetadata.slice(0, 5).map(m => m.position).join(', ')}`);
    blockMetadata.forEach((meta, index) => {
      meta.position = index;
    });
    console.log(`[BLOCK-ID-DEBUG] AFTER re-assignment, first 5 positions: ${blockMetadata.slice(0, 5).map(m => m.position).join(', ')}`);
    
    // Log block metadata for debugging
    console.log(`\n[BLOCK-ID-DEBUG] Extracted ${textSegments.length} text segments from ${blockMetadata.length} blocks`);
    console.log(`[BLOCK-ID-DEBUG] Re-assigned sequential positions (0-${blockMetadata.length - 1})`);
    console.log(`[BLOCK-ID-DEBUG] First 10 blocks with positions:\n`);
    blockMetadata.slice(0, 10).forEach((meta, idx) => {
      console.log(`[BLOCK-ID-DEBUG] [${idx}] Pos:${meta.position} Type:${meta.blockType.padEnd(20)} Depth:${meta.depth} ID:${meta.blockId}`);
      console.log(`[BLOCK-ID-DEBUG]     Text: "${meta.text}${meta.text.length >= 80 ? '...' : ''}"`);
    });
    
    if (blockMetadata.length > 10) {
      console.log(`[BLOCK-ID-DEBUG] ... and ${blockMetadata.length - 10} more blocks`);
    }
    
    // Store metadata for later use in order detection
    textSegments._blockMetadata = blockMetadata;
    
  } catch (error) {
    throw new Error(`Failed to fetch blocks from Notion: ${error.message}`);
  }
  
  return textSegments;
}

/**
 * Normalize text for comparison
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    // Normalize common non-breaking-space tokens that can appear as literal text in fixtures
    .replace(/&nbsp;|&#xa0;|&#160;|\\u00A0|\\u00a0|xa0/gi, ' ')
    // Remove internal orchestration marker tokens (used only for deferred append orchestration)
    .replace(/\(sn2n:[^)]+\)|\bsn2n[: ]?[-\w]+\b/gi, ' ')
    .replace(/\s+/g, ' ') // Collapse ALL whitespace (spaces, tabs, newlines) to single space FIRST
    .replace(/[''`]/g, '') // Drop apostrophes to align possessives (e.g., query's -> querys)
    .replace(/[""«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\w\s-]/g, ' ') // Replace punctuation (except hyphen) with space
    .replace(/\s*[-]\s*/g, ' ') // Treat hyphenated words as spaced (step-by-step -> step by step)
    .replace(/\s+/g, ' ') // Collapse any remaining whitespace
    .trim();
}

// Further phrase-level normalization for comparison granularity
function normalizePhrase(text) {
  let t = text;
  // Collapse ALL whitespace/newlines/tabs to single spaces FIRST (ignore spacing completely)
  t = t.replace(/\s+/g, ' ').trim();
  // Standard text normalization (already handles whitespace but we do it again for safety)
  t = normalizeText(t);
  // Remove trivial lead-ins and boilerplate-ish markers
  t = t.replace(/^(note|tip|warning|important)\s*:\s*/i, '');
  t = t.replace(/^related\s+content\b/i, '');
  // Final whitespace collapse
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

// Split a block of text into sentence-like phrases for comparison
function splitIntoPhrases(text) {
  if (!text || typeof text !== 'string') return [];
  // Normalize newlines to spaces first
  const s = text.replace(/\s*\n+\s*/g, ' ').trim();
  // Split on sentence boundaries . ! ? ; : or bullet-like dashes, while keeping content
  const raw = s
    .split(/(?<=[\.!?;:])\s+|\s*[•\-]\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  return raw;
}

/**
 * Check if tokens from str1 are substantially contained in str2
 * @param {string} str1 - String to check for containment
 * @param {string} str2 - String to check within
 * @returns {number} Percentage of str1 tokens found in str2 (0-100)
 */
function calculateContainment(str1, str2) {
  const tokens1 = str1.split(/\s+/).filter(t => t.length > 2);
  const tokens2 = new Set(str2.split(/\s+/).filter(t => t.length > 2));
  
  if (tokens1.length === 0) return 100;
  if (tokens2.size === 0) return 0;
  
  const foundCount = tokens1.filter(t => tokens2.has(t)).length;
  return (foundCount / tokens1.length) * 100;
}

/**
 * Calculate similarity using containment matching (ignores splits/merges)
 * @param {string[]} arr1 - First array (HTML segments)
 * @param {string[]} arr2 - Second array (Notion segments)
 * @returns {number} Similarity percentage (0-100)
 */
function calculateSimilarity(arr1, arr2) {
  if (arr1.length === 0 && arr2.length === 0) return 100;
  if (arr1.length === 0 || arr2.length === 0) return 0;
  
  const threshold = 70; // Consider matched if >=70% of tokens contained
  const matched = new Set();
  
  // For each HTML segment, check if it's substantially contained in ANY Notion segment
  for (let i = 0; i < arr1.length; i++) {
    for (let j = 0; j < arr2.length; j++) {
      // Check both directions: HTML contained in Notion, or Notion contained in HTML
      const htmlInNotion = calculateContainment(arr1[i], arr2[j]);
      const notionInHtml = calculateContainment(arr2[j], arr1[i]);
      
      // If either direction shows substantial containment, consider it a match
      if (htmlInNotion >= threshold || notionInHtml >= threshold) {
        matched.add(i);
        break; // Found a match, move to next HTML segment
      }
    }
  }
  
  // Similarity is percentage of HTML segments that found matches in Notion
  return (matched.size / arr1.length) * 100;
}

/**
 * Validate content order and completeness
 * @param {string} htmlContent - Original HTML content
 * @param {string} pageId - Notion page ID
 * @param {Object} notion - Notion client
 * @returns {Promise<Object>} Validation result
 */
async function validateContentOrder(htmlContent, pageId, notion) {
  console.log(`\n📋 [VALIDATION] Starting content validation for page ${pageId}`);
  
  // Extract text from HTML
  console.log(`   📝 Extracting text from HTML...`);
  const htmlSegments = extractPlainTextFromHtml(htmlContent);
  console.log(`   ✓ Found ${htmlSegments.length} HTML segments`);

  // Normalize segments directly (don't split into phrases - Notion blocks are already segmented)
  const htmlNormalized = htmlSegments
    .map(normalizePhrase)
    .filter(p => p && p !== 'related content' && p.length > 0);
  console.log(`   ✓ HTML segments for comparison: ${htmlNormalized.length}`);
  
  // [ORDER-DEBUG] Show first 5 HTML segments for debugging
  console.log(`\n[ORDER-DEBUG] First 5 HTML segments (normalized):`);
  htmlNormalized.slice(0, 5).forEach((seg, idx) => {
    logToFile(`[ORDER-DEBUG]   [${idx}] "${seg.substring(0, 100)}${seg.length > 100 ? '...' : ''}"`);
  });
  
  // Extract text from Notion
  console.log(`   🌐 Fetching text from Notion page...`);
  const notionSegments = await extractTextFromNotionBlocks(notion, pageId);
  const blockMetadata = notionSegments._blockMetadata || [];
  console.log(`   ✓ Found ${notionSegments.length} Notion segments`);
  
  // Normalize Notion segments and filter metadata in parallel to keep indices aligned
  // FIX: Don't split Notion segments on newlines for order comparison
  // HTML extraction normalizes newlines to spaces, so Notion should too
  // Otherwise we get phantom order inversions from segment count mismatch
  // (e.g., HTML has 1 segment "A\nB" normalized to "A B", Notion splits to ["A", "B"])
  // 
  // For similarity calculation, we still want granular matching, so we'll expand
  // Notion segments ONLY for similarity, not for order detection
  
  // First pass: normalize segments and track which ones to keep
  const normalizedWithIndices = notionSegments.map((seg, idx) => {
    if (!seg || typeof seg !== 'string') return null;
    // Normalize newlines to spaces to match HTML extraction behavior
    const normalized = normalizePhrase(seg.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
    if (!normalized || normalized === 'related content' || normalized.length === 0) return null;
    return { normalized, originalIndex: idx };
  }).filter(item => item !== null);
  
  // Extract just the normalized text
  const notionNormalized = normalizedWithIndices.map(item => item.normalized);
  
  // Create filtered metadata array that aligns with notionNormalized
  // CRITICAL FIX: Use the metadata index that was stored with each segment during extraction.
  // This ensures perfect 1:1 alignment between segments and metadata, even when blocks
  // are split on newlines (creating multiple segments per block).
  const allBlockMetadata = notionSegments._blockMetadata || [];
  const metaIndices = notionSegments._metaIndices || [];
  
  const filteredMetadata = normalizedWithIndices.map((item, idx) => {
    const originalIndex = item.originalIndex;
    
    // Look up the metadata index that was stored with this segment
    const metaIndex = metaIndices[originalIndex];
    const segmentMetadata = allBlockMetadata[metaIndex];
    
    return segmentMetadata || {};
  });
  
  // CRITICAL FIX: Re-assign positions sequentially AFTER filtering
  // The positions from blockMetadata represent pre-filter order, which is wrong after filtering
  // We need positions that represent the FILTERED array order (0, 1, 2, 3...)
  filteredMetadata.forEach((meta, index) => {
    if (meta && typeof meta === 'object') {
      meta.position = index;
    }
  });
  
  console.log(`   ✓ Notion segments for comparison: ${notionNormalized.length} (filtered from ${notionSegments.length})`);
  console.log(`   ✓ Re-assigned visual positions to filtered metadata (0-${filteredMetadata.length - 1})`);
  
  // [ORDER-DEBUG] Show first 5 Notion segments for debugging
  console.log(`\n[ORDER-DEBUG] First 5 Notion segments (normalized):`);
  notionNormalized.slice(0, 5).forEach((seg, idx) => {
    const meta = filteredMetadata[idx];
    logToFile(`[ORDER-DEBUG]   [${idx}] "${seg.substring(0, 100)}${seg.length > 100 ? '...' : ''}"`);
    if (meta) {
      logToFile(`[ORDER-DEBUG]       Block: ${meta.blockType} (ID: ${meta.blockId}, Pos: ${meta.position}, Depth: ${meta.depth})`);
    }
  });
  
  // Calculate similarity on segment level
  const similarity = calculateSimilarity(htmlNormalized, notionNormalized);
  console.log(`   📊 Similarity: ${similarity.toFixed(1)}%`);
  
  // Calculate character counts
  const htmlChars = htmlSegments.join('').length;
  const notionChars = notionSegments.join('').length;
  const charDiff = notionChars - htmlChars;
  const charDiffPercent = htmlChars > 0 ? (charDiff / htmlChars) * 100 : 0;
  
  console.log(`   📏 HTML: ${htmlChars} chars | Notion: ${notionChars} chars | Diff: ${charDiff >= 0 ? '+' : ''}${charDiff} (${charDiffPercent >= 0 ? '+' : ''}${charDiffPercent.toFixed(1)}%)`);
  
  // Find missing/extra segments using containment matching
  const missing = findMissingSegments(htmlNormalized, notionNormalized, htmlSegments);
  const extra = findExtraSegments(htmlNormalized, notionNormalized, notionSegments);
  const orderIssues = detectOrderIssues(htmlNormalized, notionNormalized, htmlSegments, filteredMetadata);
  
  // Determine if validation passed (95% similarity threshold)
  const success = similarity >= 95;
  
  // Determine if order issues are due to structural changes vs content reordering
  const hasStructuralChanges = Math.abs(htmlNormalized.length - notionNormalized.length) > 3 ||
                                 missing.length > 0 || 
                                 extra.length > 0;
  
  const orderIssueType = orderIssues.length > 0 ? 
    (hasStructuralChanges ? 'structural-changes' : 'content-reordering') : 
    'none';
  
  console.log(`   ${success ? '✅ PASS' : '❌ FAIL'} - Content validation ${success ? 'passed' : 'failed'}`);
  if (orderIssues.length > 0) {
    console.log(`   ⚠️  Order issue type: ${orderIssueType}`);
    if (hasStructuralChanges) {
      console.log(`   📊 Structural changes detected: HTML=${htmlNormalized.length} segments, Notion=${notionNormalized.length} segments`);
    }
  }
  
  return {
    success,
    similarity: parseFloat(similarity.toFixed(1)),
    htmlSegments: htmlNormalized.length,
    notionSegments: notionNormalized.length,
    htmlChars,
    notionChars,
    charDiff,
    charDiffPercent: parseFloat(charDiffPercent.toFixed(1)),
    missing,
    extra,
    orderIssues,
    orderIssueType,
    hasStructuralChanges
  };
}

/**
 * Find missing segments using containment matching
 */
function findMissingSegments(htmlNormalized, notionNormalized, htmlRaw) {
  const threshold = 70;
  const missing = [];
  
  for (let i = 0; i < htmlNormalized.length; i++) {
    let found = false;
    for (let j = 0; j < notionNormalized.length; j++) {
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      
      if (htmlInNotion >= threshold || notionInHtml >= threshold) {
        found = true;
        break;
      }
    }
    if (!found) {
      missing.push(htmlRaw[i]);
    }
  }
  
  return missing;
}

/**
 * Find extra segments using containment matching
 */
function findExtraSegments(htmlNormalized, notionNormalized, notionRaw) {
  const threshold = 70;
  const extra = [];
  
  for (let j = 0; j < notionNormalized.length; j++) {
    let found = false;
    for (let i = 0; i < htmlNormalized.length; i++) {
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      
      if (notionInHtml >= threshold || htmlInNotion >= threshold) {
        found = true;
        break;
      }
    }
    if (!found) {
      extra.push(notionRaw[j]);
    }
  }
  
  return extra;
}

/**
 * Detect order issues
 */
function detectOrderIssues(htmlNormalized, notionNormalized, htmlRaw, blockMetadata = []) {
  const issues = [];
  const fuzzyThreshold = 85; // For fuzzy matching in second pass
  const exactThreshold = 95; // For near-exact matching in first pass
  
  // Get page ID from first block metadata for log filename
  const pageId = blockMetadata[0]?.blockId || 'unknown';
  initOrderLog(pageId);
  
  logToFile(`\n[ORDER-DEBUG] ========================================`);
  logToFile(`[ORDER-DEBUG] Starting order detection`);
  logToFile(`[ORDER-DEBUG] HTML segments: ${htmlNormalized.length}`);
  logToFile(`[ORDER-DEBUG] Notion segments: ${notionNormalized.length}`);
  logToFile(`[ORDER-DEBUG] Block metadata available: ${blockMetadata.length} entries`);
  logToFile(`[ORDER-DEBUG] Exact match threshold: ${exactThreshold}% | Fuzzy threshold: ${fuzzyThreshold}%`);
  logToFile(`[ORDER-DEBUG] ========================================`);
  
  // Build index maps for segments that match
  const htmlToNotion = new Map();
  const notionToHtml = new Map();
  
  // FIRST PASS: Match near-exact segments (95%+) to prevent false matches
  // When multiple matches exist, prefer closest in proximity (position-based)
  logToFile(`\n[ORDER-DEBUG] === FIRST PASS: Near-exact matches (${exactThreshold}%+) ===`);
  
  // Track last matched Notion position to prefer nearby matches
  let lastMatchedNotionPos = -1;
  
  for (let i = 0; i < htmlNormalized.length; i++) {
    let bestMatch = null;
    let bestScore = 0;
    let bestProximity = Infinity;
    const candidates = [];
    
    // Find all candidates above threshold
    for (let j = 0; j < notionNormalized.length; j++) {
      if (notionToHtml.has(j)) continue; // Skip already matched
      
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      const maxScore = Math.max(htmlInNotion, notionInHtml);
      
      if (maxScore >= exactThreshold) {
        // CRITICAL: Check length ratio to prevent short segments matching to long ones
        // Example: "learn" (5 chars) shouldn't match "Set up the service management..." (80 chars)
        const htmlLen = htmlNormalized[i].length;
        const notionLen = notionNormalized[j].length;
        const lengthRatio = Math.min(htmlLen, notionLen) / Math.max(htmlLen, notionLen);
        
        // Skip if length ratio is too different (< 30%) unless it's a near-perfect containment match
        // This prevents single words from matching to full paragraphs
        if (lengthRatio < 0.3 && maxScore < 99) {
          continue; // Skip this candidate
        }
        
        // Calculate proximity: distance from last matched position
        // For FIRST match (lastMatchedNotionPos = -1), use actual position to prefer document start
        // This prevents matching HTML[0] to the end of the document (e.g., "Learn" heading)
        const notionPos = blockMetadata[j]?.position ?? j;
        const proximity = lastMatchedNotionPos >= 0 
          ? Math.abs(notionPos - lastMatchedNotionPos)  // Distance from last match
          : notionPos;  // First match: prefer earlier positions (0 < 1 < 2 < ...)
        
        // Store candidate for logging
        candidates.push({ 
          j, 
          score: maxScore, 
          proximity, 
          notionPos,
          lengthRatio,
          text: notionNormalized[j].substring(0, 60)
        });
        
        // CRITICAL: Prioritize perfect/near-perfect length matches over proximity
        // If we have a near-perfect length match (>90%), strongly prefer it
        // This ensures "learn" (5 chars) matches "Learn" (5 chars), not "...to learn more..." (107 chars)
        const isPerfectLengthMatch = lengthRatio > 0.9;
        const currentBestIsPerfect = bestMatch !== null && 
          candidates.find(c => c.j === bestMatch)?.lengthRatio > 0.9;
        
        let shouldUpdate = false;
        if (isPerfectLengthMatch && !currentBestIsPerfect) {
          // Strong preference: this candidate has perfect length match, current best doesn't
          shouldUpdate = true;
        } else if (!isPerfectLengthMatch && currentBestIsPerfect) {
          // Don't replace perfect match with imperfect one
          shouldUpdate = false;
        } else {
          // Both perfect or both imperfect: use score + proximity logic
          shouldUpdate = maxScore > bestScore + 5 || 
                         (Math.abs(maxScore - bestScore) <= 5 && proximity < bestProximity);
        }
        
        if (shouldUpdate) {
          bestMatch = j;
          bestScore = maxScore;
          bestProximity = proximity;
        }
      }
    }
    
    // Log all candidates if multiple found (helps debug matching issues)
    if (candidates.length > 1) {
      console.log(`\n[ORDER-DEBUG] 🔍 HTML[${i}] has ${candidates.length} candidates:`);
      logToFile(`[ORDER-DEBUG]    HTML text: "${htmlNormalized[i].substring(0, 80)}" (len:${htmlNormalized[i].length})`);
      logToFile(`[ORDER-DEBUG]    Last matched position: ${lastMatchedNotionPos}`);
      candidates.forEach(c => {
        const chosen = c.j === bestMatch ? '✓ CHOSEN' : '';
        const ratioStr = c.lengthRatio !== undefined ? ` ratio:${(c.lengthRatio * 100).toFixed(0)}%` : '';
        logToFile(`[ORDER-DEBUG]    → Notion[${c.j}] score:${c.score.toFixed(1)}% prox:${c.proximity} pos:${c.notionPos}${ratioStr} ${chosen}`);
        logToFile(`[ORDER-DEBUG]       "${c.text}..." (len:${notionNormalized[c.j].length})`);
      });
    }
    
    // Apply best match if found
    if (bestMatch !== null) {
      const j = bestMatch;
      const notionPos = blockMetadata[j]?.position ?? j;
      lastMatchedNotionPos = notionPos; // Update last position for next iteration
      
      htmlToNotion.set(i, j);
      notionToHtml.set(j, i);
      
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      const meta = blockMetadata[j];
      
      logToFile(`[ORDER-DEBUG] ✓ EXACT Match: HTML[${i}] ↔ Notion[${j}]`);
      logToFile(`[ORDER-DEBUG]   HTML→Notion: ${htmlInNotion.toFixed(1)}% | Notion→HTML: ${notionInHtml.toFixed(1)}%`);
      logToFile(`[ORDER-DEBUG]   Proximity: ${bestProximity} positions from last match (closer=better)`);
      logToFile(`[ORDER-DEBUG]   HTML text: "${htmlNormalized[i].substring(0, 80)}${htmlNormalized[i].length > 80 ? '...' : ''}"`);
      logToFile(`[ORDER-DEBUG]   Notion text: "${notionNormalized[j].substring(0, 80)}${notionNormalized[j].length > 80 ? '...' : ''}"`);
      if (meta) {
        logToFile(`[ORDER-DEBUG]   Notion block: ${meta.blockType} (ID: ${meta.blockId}, Pos: ${meta.position}, Depth: ${meta.depth})`);
      }
    }
  }
  
  logToFile(`[ORDER-DEBUG] First pass complete: ${htmlToNotion.size} exact matches`);
  
  // SECOND PASS: Match remaining segments with fuzzy threshold (85%+)
  // Continue using proximity-based matching from first pass
  console.log(`\n[ORDER-DEBUG] === SECOND PASS: Fuzzy matches (${fuzzyThreshold}%+) ===`);
  
  for (let i = 0; i < htmlNormalized.length; i++) {
    if (htmlToNotion.has(i)) continue; // Skip already matched
    
    let bestMatch = null;
    let bestScore = 0;
    let bestProximity = Infinity;
    const candidates = [];
    
    // Find all candidates above threshold
    for (let j = 0; j < notionNormalized.length; j++) {
      if (notionToHtml.has(j)) continue; // Skip already matched
      
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      const maxScore = Math.max(htmlInNotion, notionInHtml);
      
      if (maxScore >= fuzzyThreshold) {
        // CRITICAL: Check length ratio to prevent short segments matching to long ones
        const htmlLen = htmlNormalized[i].length;
        const notionLen = notionNormalized[j].length;
        const lengthRatio = Math.min(htmlLen, notionLen) / Math.max(htmlLen, notionLen);
        
        // Skip if length ratio is too different (< 30%) unless it's a near-perfect match
        if (lengthRatio < 0.3 && maxScore < 99) {
          continue; // Skip this candidate
        }
        
        // Calculate proximity: distance from last matched position
        // For FIRST match (lastMatchedNotionPos = -1), use actual position to prefer document start
        const notionPos = blockMetadata[j]?.position ?? j;
        const proximity = lastMatchedNotionPos >= 0 
          ? Math.abs(notionPos - lastMatchedNotionPos)  // Distance from last match
          : notionPos;  // First match: prefer earlier positions (0 < 1 < 2 < ...)
        
        // Store candidate for logging
        candidates.push({ 
          j, 
          score: maxScore, 
          proximity, 
          notionPos,
          lengthRatio,
          text: notionNormalized[j].substring(0, 60)
        });
        
        // CRITICAL: Prioritize perfect/near-perfect length matches over proximity (same as first pass)
        const isPerfectLengthMatch = lengthRatio > 0.9;
        const currentBestIsPerfect = bestMatch !== null && 
          candidates.find(c => c.j === bestMatch)?.lengthRatio > 0.9;
        
        let shouldUpdate = false;
        if (isPerfectLengthMatch && !currentBestIsPerfect) {
          shouldUpdate = true;
        } else if (!isPerfectLengthMatch && currentBestIsPerfect) {
          shouldUpdate = false;
        } else {
          shouldUpdate = maxScore > bestScore + 5 || 
                         (Math.abs(maxScore - bestScore) <= 5 && proximity < bestProximity);
        }
        
        if (shouldUpdate) {
          bestMatch = j;
          bestScore = maxScore;
          bestProximity = proximity;
        }
      }
    }
    
    // Log all candidates if multiple found (helps debug matching issues)
    if (candidates.length > 1) {
      console.log(`\n[ORDER-DEBUG] 🔍 HTML[${i}] has ${candidates.length} candidates (FUZZY):`);
      logToFile(`[ORDER-DEBUG]    HTML text: "${htmlNormalized[i].substring(0, 80)}" (len:${htmlNormalized[i].length})`);
      logToFile(`[ORDER-DEBUG]    Last matched position: ${lastMatchedNotionPos}`);
      candidates.forEach(c => {
        const chosen = c.j === bestMatch ? '✓ CHOSEN' : '';
        const ratioStr = c.lengthRatio !== undefined ? ` ratio:${(c.lengthRatio * 100).toFixed(0)}%` : '';
        logToFile(`[ORDER-DEBUG]    → Notion[${c.j}] score:${c.score.toFixed(1)}% prox:${c.proximity} pos:${c.notionPos}${ratioStr} ${chosen}`);
        logToFile(`[ORDER-DEBUG]       "${c.text}..." (len:${notionNormalized[c.j].length})`);
      });
    }
    
    // Apply best match if found
    if (bestMatch !== null) {
      const j = bestMatch;
      const notionPos = blockMetadata[j]?.position ?? j;
      lastMatchedNotionPos = notionPos; // Update last position for next iteration
      
      htmlToNotion.set(i, j);
      notionToHtml.set(j, i);
      
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      const meta = blockMetadata[j];
      
      logToFile(`[ORDER-DEBUG] ✓ FUZZY Match: HTML[${i}] ↔ Notion[${j}]`);
      logToFile(`[ORDER-DEBUG]   HTML→Notion: ${htmlInNotion.toFixed(1)}% | Notion→HTML: ${notionInHtml.toFixed(1)}%`);
      logToFile(`[ORDER-DEBUG]   Proximity: ${bestProximity} positions from last match (closer=better)`);
      logToFile(`[ORDER-DEBUG]   HTML text: "${htmlNormalized[i].substring(0, 80)}${htmlNormalized[i].length > 80 ? '...' : ''}"`);
      logToFile(`[ORDER-DEBUG]   Notion text: "${notionNormalized[j].substring(0, 80)}${notionNormalized[j].length > 80 ? '...' : ''}"`);
      if (meta) {
        logToFile(`[ORDER-DEBUG]   Notion block: ${meta.blockType} (ID: ${meta.blockId}, Pos: ${meta.position}, Depth: ${meta.depth})`);
      }
    }
  }
  
  console.log(`\n[ORDER-DEBUG] Matching complete: ${htmlToNotion.size} matches found`);
  logToFile(`[ORDER-DEBUG] Unmatched HTML segments: ${htmlNormalized.length - htmlToNotion.size}`);
  logToFile(`[ORDER-DEBUG] Unmatched Notion segments: ${notionNormalized.length - notionToHtml.size}`);
  
  // Check for inversions in matched segments
  const matchedIndices = Array.from(htmlToNotion.keys()).sort((a, b) => a - b);
  
  console.log(`\n[ORDER-DEBUG] Checking for inversions in ${matchedIndices.length} matched pairs...`);
  
  for (let k = 0; k < matchedIndices.length - 1; k++) {
    const htmlIdxA = matchedIndices[k];
    const htmlIdxB = matchedIndices[k + 1];
    const notionIdxA = htmlToNotion.get(htmlIdxA);
    const notionIdxB = htmlToNotion.get(htmlIdxB);
    
    logToFile(`[ORDER-DEBUG] Pair ${k + 1}: HTML[${htmlIdxA}→${htmlIdxB}] vs Notion[${notionIdxA}→${notionIdxB}]`);
    
    if (htmlIdxA < htmlIdxB && notionIdxA > notionIdxB) {
      // Potential inversion detected - but verify with visual positions if available
      // CRITICAL: blockMetadata parameter contains filteredMetadata (passed from caller)
      // notionIdxA/B are indices into the filtered array, so we can use them directly
      const metaA = blockMetadata[notionIdxA] || {};
      const metaB = blockMetadata[notionIdxB] || {};
      
      // Use visual positions from metadata if available, otherwise fall back to array indices
      const visualPosA = metaA.position !== undefined ? metaA.position : notionIdxA;
      const visualPosB = metaB.position !== undefined ? metaB.position : notionIdxB;
      
      // DEBUG: Log metadata before comparison
      logToFile(`[ORDER-DEBUG] metaA:`, JSON.stringify(metaA, null, 2));
      logToFile(`[ORDER-DEBUG] metaB:`, JSON.stringify(metaB, null, 2));
      logToFile(`[ORDER-DEBUG] visualPosA=${visualPosA}, visualPosB=${visualPosB}`);
      
      // Check if it's a REAL inversion based on visual positions
      const isRealInversion = visualPosA > visualPosB;
      
      logToFile(`[ORDER-DEBUG] isRealInversion = ${isRealInversion} (${visualPosA} > ${visualPosB})`);
      
      if (isRealInversion) {
        logToFile(`[ORDER-DEBUG] ❌ REAL INVERSION DETECTED!`);
      } else {
        logToFile(`[ORDER-DEBUG] ℹ️  Index inversion detected, but visual order is correct`);
        logToFile(`[ORDER-DEBUG]   (This is expected when paragraphs are merged/filtered during conversion)`);
      }
      
      logToFile(`[ORDER-DEBUG]   HTML order: [${htmlIdxA}] "${htmlRaw[htmlIdxA].substring(0, 60)}..."`);
      logToFile(`[ORDER-DEBUG]   HTML order: [${htmlIdxB}] "${htmlRaw[htmlIdxB].substring(0, 60)}..."`);
      logToFile(`[ORDER-DEBUG]   Notion array indices: [${notionIdxA}] vs [${notionIdxB}]`);
      logToFile(`[ORDER-DEBUG]   Notion visual positions: [${visualPosA}] vs [${visualPosB}]`);
      
      // Show block details for inverted segments
      if (metaA.blockId) {
        logToFile(`[ORDER-DEBUG]   Block A: ${metaA.blockType} (ID: ${metaA.blockId}, Visual Pos: ${visualPosA}, Depth: ${metaA.depth})`);
        logToFile(`[ORDER-DEBUG]   Block A metadata text: "${metaA.text}"`);
        logToFile(`[ORDER-DEBUG]   Notion segment A text: "${notionNormalized[notionIdxA]?.substring(0, 80)}"`);
      }
      if (metaB.blockId) {
        logToFile(`[ORDER-DEBUG]   Block B: ${metaB.blockType} (ID: ${metaB.blockId}, Visual Pos: ${visualPosB}, Depth: ${metaB.depth})`);
        logToFile(`[ORDER-DEBUG]   Block B metadata text: "${metaB.text}"`);
        logToFile(`[ORDER-DEBUG]   Notion segment B text: "${notionNormalized[notionIdxB]?.substring(0, 80)}"`);
      }
      
      if (!isRealInversion) {
        logToFile(`[ORDER-DEBUG]   ✓ Skipping - visual order is correct despite index mismatch`);
        logToFile(`[ORDER-DEBUG]   ✓ Order preserved`);
        continue; // Skip this false positive
      }
      
      // Check if this is a known false positive pattern
      
      // Pattern 1: Table content vs heading with similar text (extraction artifact)
      const isTableHeadingMismatch = (
        (metaA.blockType === 'table_row' && metaB.blockType?.startsWith('heading_')) ||
        (metaA.blockType?.startsWith('heading_') && metaB.blockType === 'table_row')
      );
      
      if (isTableHeadingMismatch) {
        // Calculate similarity between the two segments
        const segA = normalizeText(htmlRaw[htmlIdxA]);
        const segB = normalizeText(htmlRaw[htmlIdxB]);
        const similarity = calculateSimilarity(segA, segB);
        
        if (similarity >= 70) {
          logToFile(`[ORDER-DEBUG]   ⚠️ Skipping likely false positive: table/heading mismatch with ${similarity}% similarity`);
          logToFile(`[ORDER-DEBUG]   Pattern: ${metaA.blockType} vs ${metaB.blockType}`);
          logToFile(`[ORDER-DEBUG]   ✓ Order preserved (filtered false positive)`);
          continue;
        }
      }
      
      // Pattern 2: Table row reorderings (CSS/JS reordering or flex order properties)
      // HTML extraction gets raw DOM order, but CSS/JS may visually reorder rows
      // Filter inversions where both blocks are table_row from same table (same parent)
      const isBothTableRows = metaA.blockType === 'table_row' && metaB.blockType === 'table_row';
      
      if (isBothTableRows) {
        // Check if they're from the same table by comparing parent context
        // Table rows within the same table often have similar depth and close visual positions
        const depthMatch = metaA.depth === metaB.depth;
        const positionProximity = Math.abs(visualPosA - visualPosB);
        const isCloseProximity = positionProximity <= 5; // Within 5 positions suggests same table
        
        if (depthMatch && isCloseProximity) {
          logToFile(`[ORDER-DEBUG]   ⚠️ Skipping likely false positive: table_row reordering (CSS/JS order)`);
          logToFile(`[ORDER-DEBUG]   Pattern: Both table_row at depth ${metaA.depth}, proximity ${positionProximity}`);
          logToFile(`[ORDER-DEBUG]   Note: HTML extraction gets raw DOM order; visual order may differ due to CSS flex/grid`);
          logToFile(`[ORDER-DEBUG]   ✓ Order preserved (filtered false positive)`);
          continue;
        }
      }
      
      // Pattern 3: Segments from same Notion block (code blocks, long paragraphs split on newlines)
      // When extracting Notion text, long blocks may be split into multiple segments
      // These segments share the same blockId but have different array positions
      // This creates false inversions because they're not actually reordered content
      const sameBlockId = metaA.blockId && metaB.blockId && metaA.blockId === metaB.blockId;
      
      if (sameBlockId) {
        logToFile(`[ORDER-DEBUG]   ⚠️ Skipping likely false positive: segments from same Notion block`);
        logToFile(`[ORDER-DEBUG]   Pattern: Both segments share blockId ${metaA.blockId}`);
        logToFile(`[ORDER-DEBUG]   Block type: ${metaA.blockType} (split during extraction)`);
        logToFile(`[ORDER-DEBUG]   Note: Long blocks split on newlines create multiple segments with same blockId`);
        logToFile(`[ORDER-DEBUG]   ✓ Order preserved (filtered false positive)`);
        continue;
      }
      
      // Pattern 4: Parent-child nesting (child block appears before parent content)
      // In Notion, nested blocks are stored sequentially, so a child at depth N+1 
      // may have an earlier position than its parent's text at depth N
      // Example: list item (depth 0, pos 7) contains code block (depth 1, pos 6)
      // Or: paragraph (depth 1, pos 28) vs table_row (depth 2, pos 25) - table nested deeper
      // This is NOT a reordering - it's natural nested structure
      // When depths differ, allow larger proximity (up to 5 positions) because nested structures
      // create distance in the flattened array even when document order is correct
      const isParentChild = metaA.depth !== metaB.depth;
      const positionProximity = Math.abs(visualPosA - visualPosB);
      const isCloseProximity = positionProximity <= 5;
      
      if (isParentChild && isCloseProximity) {
        const higherDepth = Math.max(metaA.depth, metaB.depth);
        const lowerDepth = Math.min(metaA.depth, metaB.depth);
        logToFile(`[ORDER-DEBUG]   ⚠️ Skipping likely false positive: parent-child nesting`);
        logToFile(`[ORDER-DEBUG]   Pattern: Different depths (${lowerDepth} vs ${higherDepth}), proximity ${positionProximity}`);
        logToFile(`[ORDER-DEBUG]   Block A: ${metaA.blockType} (depth ${metaA.depth}, pos ${visualPosA})`);
        logToFile(`[ORDER-DEBUG]   Block B: ${metaB.blockType} (depth ${metaB.depth}, pos ${visualPosB})`);
        logToFile(`[ORDER-DEBUG]   Note: Nested blocks create positional gaps in flattened array`);
        logToFile(`[ORDER-DEBUG]   ✓ Order preserved (filtered false positive)`);
        continue;
      }
      
      logToFile(`[ORDER-DEBUG]   This is a genuine content reordering`);
      logToFile(`[ORDER-DEBUG]   Review this page manually if order matters for instructions`);
      
      issues.push({
        segmentA: htmlRaw[htmlIdxA].substring(0, 60),
        segmentB: htmlRaw[htmlIdxB].substring(0, 60),
        htmlOrder: [htmlIdxA, htmlIdxB],
        notionOrder: [visualPosA, visualPosB], // Use visual positions, not array indices
        blockA: metaA,
        blockB: metaB
      });
    } else {
      logToFile(`[ORDER-DEBUG]   ✓ Order preserved`);
    }
  }
  
  logToFile(`\n[ORDER-DEBUG] ========================================`);
  logToFile(`[ORDER-DEBUG] Order detection complete: ${issues.length} inversion(s) found`);
  logToFile(`[ORDER-DEBUG] ========================================`);
  logToFile(`[ORDER-DEBUG] Waiting for Validation property update before closing log...\n`);
  
  // DON'T close log here - let caller close it AFTER property update
  // closeOrderLog();
  return issues;
}

/**
 * Update Notion page properties with validation results
 * @param {string} pageId - Notion page ID
 * @param {Object} validationResult - Validation result object
 * @param {Object} blockCounts - Block count comparison data (from old validation)
 * @param {Object} notion - Notion client
 * @param {Object} contextFlags - Optional context flags (e.g., zeroBlockRecoveryFailed)
 * @returns {Promise<void>}
 */
async function updateNotionValidationProperty(pageId, validationResult, blockCounts, notion, contextFlags = {}) {
  const timestamp = new Date().toISOString().split('T')[0];
  // Soft-pass band: treat similarity >=90 as success (reduces near-threshold noise)
  const softPass = validationResult.similarity >= 90;
  const hardPass = validationResult.success || softPass;
  const status = hardPass ? (softPass && !validationResult.success ? '✅ PASS (Band)' : '✅ PASS') : '❌ FAIL';
  
  const { similarity, htmlChars, notionChars, charDiff, charDiffPercent, missing, extra, orderIssues } = validationResult;
  
  // Build Validation property text
  let validationText = '';
  
  // PREPEND ZERO-BLOCK RECOVERY DIAGNOSTIC if flagged
  if (contextFlags.zeroBlockRecoveryFailed) {
    validationText += `⚠️ ZERO-BLOCK RECOVERY FAILED\n`;
    validationText += `Page was created with no persisted children after immediate retry.\n`;
    validationText += `Re-extraction required.\n\n`;
  }
  
  validationText += `${status} - Content similarity ≥95%\n`;
  if (softPass && !validationResult.success) {
    validationText += `\nNote: Passed soft threshold (≥90%) despite minor discrepancies.\n`;
  }
  
  if (orderIssues && orderIssues.length > 0) {
    validationText += `\nNote: ${orderIssues.length} minor ordering difference${orderIssues.length > 1 ? 's' : ''} detected\n`;
  }
  
  validationText += `\n📊 Analysis:\n\n`;
  validationText += `✓ Similarity Score: ${similarity}%\n`;
  validationText += `✓ HTML text length: ${htmlChars} characters\n`;
  validationText += `✓ Notion text length: ${notionChars} characters\n`;
  validationText += `✓ Difference: ${charDiff >= 0 ? '+' : ''}${charDiff} (${charDiffPercent >= 0 ? '+' : ''}${charDiffPercent.toFixed(1)}%)\n\n`;
  
  if (!missing || missing.length === 0) {
    validationText += `✓ All HTML content found in Notion\n`;
  } else {
    validationText += `⚠️ Missing in Notion (${missing.length} segments):\n`;
    missing.slice(0, 3).forEach((seg, idx) => {
      const preview = seg.substring(0, 60) + (seg.length > 60 ? '...' : '');
      validationText += `   ${idx + 1}. "${preview}"\n`;
    });
    if (missing.length > 3) {
      validationText += `   ... and ${missing.length - 3} more\n`;
    }
  }
  
  if (extra && extra.length > 0) {
    validationText += `\n⚠️ Extra in Notion (${extra.length} segments):\n`;
    extra.slice(0, 3).forEach((seg, idx) => {
      const preview = seg.substring(0, 60) + (seg.length > 60 ? '...' : '');
      validationText += `   ${idx + 1}. "${preview}"\n`;
    });
    if (extra.length > 3) {
      validationText += `   ... and ${extra.length - 3} more\n`;
    }
  }
  
  if (orderIssues && orderIssues.length > 0) {
    validationText += `\n⚠️ Order Issues (${orderIssues.length} detected):\n`;
    orderIssues.slice(0, 2).forEach((issue, idx) => {
      validationText += `   ${idx + 1}. Inversion detected:\n`;
      validationText += `      A: "${issue.segmentA}..."\n`;
      validationText += `      B: "${issue.segmentB}..."\n`;
      validationText += `      HTML order: A at ${issue.htmlOrder[0]}, B at ${issue.htmlOrder[1]}\n`;
      validationText += `      Notion order: A at ${issue.notionOrder[0]}, B at ${issue.notionOrder[1]}\n`;
    });
    if (orderIssues.length > 2) {
      validationText += `   ... and ${orderIssues.length - 2} more\n`;
    }
  }
  
  // Build Stats property text (old block count validation)
  let statsText = '';
  if (blockCounts && blockCounts.source && blockCounts.notion) {
    statsText = `📊 Content Comparison (Source → Notion):\n`;
    statsText += `• Ordered list items: ${blockCounts.source.orderedListItems || 0} → ${blockCounts.notion.orderedListItems || 0}\n`;
    statsText += `• Unordered list items: ${blockCounts.source.unorderedListItems || 0} → ${blockCounts.notion.unorderedListItems || 0}\n`;
    statsText += `• Paragraphs: ${blockCounts.source.paragraphs || 0} → ${blockCounts.notion.paragraphs || 0}\n`;
    statsText += `• Headings: ${blockCounts.source.headings || 0} → ${blockCounts.notion.headings || 0}\n`;
    statsText += `• Tables: ${blockCounts.source.tables || 0} → ${blockCounts.notion.tables || 0}\n`;
    statsText += `• Images: ${blockCounts.source.images || 0} → ${blockCounts.notion.images || 0}\n`;
    statsText += `• Callouts: ${blockCounts.source.callouts || 0} → ${blockCounts.notion.callouts || 0}`;
  }
  
  try {
    const updatePayload = {
      page_id: pageId,
      properties: {
        'Validation': {
          rich_text: [
            {
              type: 'text',
              text: { content: validationText }
            }
          ]
        },
        'Error': {
          checkbox: !hardPass
        }
      }
    };
    
    // Only add Stats if we have block count data
    if (statsText) {
      updatePayload.properties['Stats'] = {
        rich_text: [
          {
            type: 'text',
            text: { content: statsText }
          }
        ]
      };
    }
    
    await notion.pages.update(updatePayload);
    
    console.log(`   ✓ Updated Notion page properties with validation results`);
  } catch (error) {
    console.warn(`   ⚠️ Failed to update Notion validation property: ${error.message}`);
  }
}

/**
 * Run full validation and update Notion properties
 * @param {string} htmlContent - Original HTML content
 * @param {string} pageId - Notion page ID
 * @param {Object} notion - Notion client
 * @param {Object} blockCounts - Optional block count comparison data
 * @param {Object} contextFlags - Optional context flags (e.g., zeroBlockRecoveryFailed)
 * @returns {Promise<Object>} Validation result
 */
async function runValidationAndUpdate(htmlContent, pageId, notion, blockCounts = null, contextFlags = {}) {
  try {
    const result = await validateContentOrder(htmlContent, pageId, notion);
    await updateNotionValidationProperty(pageId, result, blockCounts, notion, contextFlags);
    return result;
  } catch (error) {
    console.error(`[VALIDATION] Error during validation: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  extractPlainTextFromHtml,
  extractTextFromNotionBlocks,
  normalizeText,
  calculateSimilarity,
  validateContentOrder,
  updateNotionValidationProperty,
  runValidationAndUpdate,
  closeOrderLog
};
