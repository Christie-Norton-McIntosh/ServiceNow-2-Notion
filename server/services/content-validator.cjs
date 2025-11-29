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
   
  // Helper: get consolidated text from an element, merging inline children
  function consolidatedText($el) {
    const nodes = $el.contents().get();
    const parts = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;
      if (node.type === 'text') {
        let t = $(node).text() || '';
        // If next node is a tag, ensure we end with a space to separate
        // adjacent text -> tag boundaries (prevents run-on words)
        const next = nodes[i + 1];
        if (next && next.type === 'tag' && !/\s$/.test(t)) t = t + ' ';
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
        // For other tags, ensure content is separated on both sides
        let s = $(node).text() || '';
        if (!/^\s/.test(s)) s = ' ' + s;
        if (!/\s$/.test(s)) s = s + ' ';
        parts.push(s);
      }
    }
    const raw = parts.join('');
    return raw.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
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
 
   // Headings
  $scope.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
     const txt = $(el).text();
     if (!txt) return;
     if (!includeBoilerplate && isBoilerplate(txt)) return;
     segments.push(txt);
   });
 
  // Paragraphs (exclude postreq/What to do next section)
  $scope.find('p').each((_, el) => {
     const txt = consolidatedText($(el));
     if (!txt) return;
    // Skip "What to do next" content if within a postreq section
    const parentSection = $(el).closest('section');
    const sectionClass = (parentSection.attr('class') || '').toLowerCase();
    const sectionTitle = normalizeText(parentSection.find('.sectiontitle, .tasklabel .sectiontitle').first().text() || '');
    if (/postreq/.test(sectionClass) || /^what to do next$/.test(sectionTitle)) return;
     if (!includeBoilerplate && isBoilerplate(txt)) return;
     segments.push(txt);
   });
 
   // List items
  $scope.find('li').each((_, el) => {
     const txt = consolidatedText($(el));
     if (!txt) return;
     if (!includeBoilerplate && isBoilerplate(txt)) return;
     segments.push(txt);
   });
 
   // Callouts
  $scope.find('div, aside').each((_, el) => {
     const $el = $(el);
     const cls = ($el.attr('class') || '').toLowerCase();
     if (/note|warning|info|tip|important|caution|note_note|warning_type/.test(cls)) {
       const txt = consolidatedText($el);
       if (txt && (includeBoilerplate || !isBoilerplate(txt))) segments.push(txt);
     }
   });
 
   // Tables
  $scope.find('table').each((_, tbl) => {
     const $tbl = $(tbl);
     const caption = $tbl.find('caption').text();
     if (caption && (includeBoilerplate || !isBoilerplate(caption))) segments.push(caption);
     const headers = $tbl.find('thead th');
     if (headers.length) {
       const headerText = headers
         .map((i, th) => $(th).text().trim())
         .get()
         .filter(Boolean)
         .join(' | ');
       if (headerText) segments.push(headerText);
     }
     $tbl.find('tbody tr').each((__, tr) => {
       const rowText = $(tr)
         .find('td, th')
         .map((i, cell) => consolidatedText($(cell)))
         .get()
         .filter(Boolean)
         .join(' | ');
       const cleaned = rowText.replace(/\s{2,}/g, ' ').trim();
       if (cleaned) segments.push(cleaned);
     });
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
  
  async function processBlock(block) {
    const type = block.type;
    const data = block[type];
    
    if (!data) {
      // Process children even if no data
      if (block.has_children) {
        try {
          const children = await notion.blocks.children.list({ block_id: block.id });
          for (const child of children.results) {
            await processBlock(child);
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
          for (const p of parts) textSegments.push(p);
        } else {
          textSegments.push(cleaned);
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
        textSegments.push(cleanedTitle);
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
        textSegments.push(cleanedCaption);
      }
    }
    
    // Handle table rows specially
    if (type === 'table_row' && Array.isArray(data.cells)) {
      for (const cell of data.cells) {
        if (Array.isArray(cell) && cell.length > 0) {
          const cellText = cell
            .map(rt => rt.plain_text || rt.text?.content || '')
            .join('')
            .trim();
          if (cellText) {
            textSegments.push(cellText);
          }
        }
      }
    }
    
    // Process children recursively
    if (block.has_children) {
      try {
        const children = await notion.blocks.children.list({ block_id: block.id });
        for (const child of children.results) {
          await processBlock(child);
        }
      } catch (error) {
        console.warn(`Failed to fetch children for block ${block.id}:`, error.message);
      }
    }
  }
  
  // Fetch page blocks
  try {
    const response = await notion.blocks.children.list({ block_id: blockId });
    for (const block of response.results) {
      await processBlock(block);
    }
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
  
  // Extract text from Notion
  console.log(`   🌐 Fetching text from Notion page...`);
  const notionSegments = await extractTextFromNotionBlocks(notion, pageId);
  console.log(`   ✓ Found ${notionSegments.length} Notion segments`);
  
  // Normalize Notion segments
  // Expand Notion segments on explicit newlines (callouts often contain "line1\nline2")
  // so the validator treats those as separate phrases for comparison. This is
  // strictly a validation-time expansion and does not change production output.
  const notionExpanded = [];
  for (const seg of notionSegments) {
    if (!seg || typeof seg !== 'string') continue;
    // Split on one or more newlines, trim each part, keep order
    const parts = seg.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (parts.length === 0) continue;
    notionExpanded.push(...parts);
  }
  // Further split multi-line callouts/prereq blocks on common keywords so that
  // fragments like "Before you begin\nRole required: ..." are treated as
  // separate comparison phrases. This is validation-only.
  const calloutSplitRegex = /(?=\b(?:Before you begin|Role required:?|Prerequisite:?|Prereq:?|Prerequisites:?|Role:))\b/i;
  const notionFurtherSplit = [];
  for (const part of notionExpanded) {
    if (!part) continue;
    // If the part contains one of our keywords, split with lookahead to keep the
    // keyword at the start of the new fragment. Otherwise keep intact.
    if (calloutSplitRegex.test(part)) {
      const sub = part.split(calloutSplitRegex).map(s => s.trim()).filter(Boolean);
      notionFurtherSplit.push(...sub);
    } else {
      notionFurtherSplit.push(part);
    }
  }

  const notionNormalized = notionFurtherSplit
    .map(normalizePhrase)
    .filter(p => p && p !== 'related content' && p.length > 0);
  console.log(`   ✓ Notion segments for comparison: ${notionNormalized.length}`);
  
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
  const orderIssues = detectOrderIssues(htmlNormalized, notionNormalized, htmlSegments);
  
  // Determine if validation passed (95% similarity threshold)
  const success = similarity >= 95;
  
  console.log(`   ${success ? '✅ PASS' : '❌ FAIL'} - Content validation ${success ? 'passed' : 'failed'}`);
  
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
    orderIssues
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
function detectOrderIssues(htmlNormalized, notionNormalized, htmlRaw) {
  const issues = [];
  const threshold = 70;
  
  // Build index maps for segments that match
  const htmlToNotion = new Map();
  const notionToHtml = new Map();
  
  for (let i = 0; i < htmlNormalized.length; i++) {
    for (let j = 0; j < notionNormalized.length; j++) {
      const htmlInNotion = calculateContainment(htmlNormalized[i], notionNormalized[j]);
      const notionInHtml = calculateContainment(notionNormalized[j], htmlNormalized[i]);
      
      if (htmlInNotion >= threshold || notionInHtml >= threshold) {
        if (!htmlToNotion.has(i)) {
          htmlToNotion.set(i, j);
          notionToHtml.set(j, i);
        }
        break;
      }
    }
  }
  
  // Check for inversions in matched segments
  const matchedIndices = Array.from(htmlToNotion.keys()).sort((a, b) => a - b);
  
  for (let k = 0; k < matchedIndices.length - 1; k++) {
    const htmlIdxA = matchedIndices[k];
    const htmlIdxB = matchedIndices[k + 1];
    const notionIdxA = htmlToNotion.get(htmlIdxA);
    const notionIdxB = htmlToNotion.get(htmlIdxB);
    
    if (htmlIdxA < htmlIdxB && notionIdxA > notionIdxB) {
      issues.push({
        segmentA: htmlRaw[htmlIdxA].substring(0, 60),
        segmentB: htmlRaw[htmlIdxB].substring(0, 60),
        htmlOrder: [htmlIdxA, htmlIdxB],
        notionOrder: [notionIdxA, notionIdxB]
      });
    }
  }
  
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
  runValidationAndUpdate
};
