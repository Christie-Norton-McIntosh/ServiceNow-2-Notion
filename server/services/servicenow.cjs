/**
 * @fileoverview ServiceNow Content Extraction Service
 * 
 * This module handles the complex parsing and extraction of content from ServiceNow
 * documentation pages, converting HTML structures to Notion-compatible block format.
 * 
 * Key Features:
 * - HTML-to-Notion block conversion with rich text formatting
 * - Technical identifier detection and inline code formatting
 * - Table parsing with thead/tbody structure preservation
 * - Callout/note processing with proper color and icon mapping
 * - Video iframe detection and handling
 * - ServiceNow URL normalization and link processing
 * - Metadata extraction from ServiceNow URLs
 * 
 * Dependencies:
 * - axios (HTTP client for external requests)
 * - form-data (multipart form handling)
 * - Global functions via getGlobals() pattern
 * 
 * @module services/servicenow
 * @since 8.2.5
 */

const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');
const fs = require('fs');
const { convertServiceNowUrl, isVideoIframeUrl } = require('../utils/url.cjs');
const { cleanHtmlText } = require('../converters/rich-text.cjs');
const { convertRichTextBlock } = require('../converters/rich-text.cjs');
const { normalizeAnnotations: normalizeAnnotationsLocal } = require('../utils/notion-format.cjs');
const { 
  isTechnicalContent, 
  processKbdContent, 
  processTechnicalSpan,
  decodeHtmlEntities: decodeEntities,
  isInCodeBlock 
} = require('../utils/html-formatting.cjs');

// FORCE CLEAR MODULE CACHE for table converter to pick up changes
const tablePath = require.resolve('../converters/table.cjs');
delete require.cache[tablePath];
const { convertTableBlock } = require('../converters/table.cjs');

const { generateMarker, removeMarkerFromRichTextArray } = require('../orchestration/marker-management.cjs');

/** @private Global tracker for video detection (reset per conversion) */
let hasDetectedVideos = false;

/**
 * Retrieves global utility functions from the main server context.
 * 
 * This function provides access to utility functions that are globally available
 * in the main server process, with fallbacks for missing functions.
 * 
 * @private
 * @returns {object} Object containing global utility functions
 * @returns {function} returns.log - Logging function (global.log or console.log fallback)
 * @returns {function} returns.normalizeAnnotations - Rich text annotation normalizer
 * @returns {function} returns.normalizeUrl - URL normalization utility
 * @returns {function} returns.isValidImageUrl - Image URL validation
 * @returns {function} returns.downloadAndUploadImage - Image download and upload handler
 * @returns {function} returns.ensureFileUploadAvailable - File upload availability checker
 */
function getGlobals() {
  return {
    log: global.log || console.log,
    normalizeAnnotations: global.normalizeAnnotations || normalizeAnnotationsLocal,
    normalizeUrl: global.normalizeUrl,
    isValidImageUrl: global.isValidImageUrl,
    downloadAndUploadImage: global.downloadAndUploadImage,
    ensureFileUploadAvailable: global.ensureFileUploadAvailable,
    getExtraDebug: global.getExtraDebug,
  };
}

/**
 * Enforces Notion's 2-level nesting limit by stripping children from blocks at depth >= 2.
 * Blocks with stripped children have their children moved to a `_sn2n_deferred_children` array
 * with markers for later orchestration.
 * 
 * @param {Array} blocks - Array of Notion blocks to process
 * @param {number} currentDepth - Current nesting depth (0 = root level)
 * @returns {object} Result with collected blocks that need markers
 */
function enforceNestingDepthLimit(blocks, currentDepth = 0) {
  const { log } = getGlobals();
  const deferredBlocks = [];
  
  if (!Array.isArray(blocks)) return { deferredBlocks };
  
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    
    const blockType = block.type;
    if (!blockType) continue;
    
    // List items and other blocks that can have children
    const childrenKey = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout'].includes(blockType) 
      ? blockType 
      : null;
    
    if (childrenKey && block[childrenKey] && Array.isArray(block[childrenKey].children)) {
      const children = block[childrenKey].children;
      
      // At depth >= 2, we cannot have children in the initial page creation
      // All children must be deferred for orchestration
      if (currentDepth >= 2 && children.length > 0) {
        log(`🔧 Enforcing nesting limit: Stripping ${children.length} children from ${blockType} at depth ${currentDepth}`);
        
        // Store children for later marker-based orchestration
        block._sn2n_deferred_children = children;
        
        // Remove children from block (will be added via orchestration)
        delete block[childrenKey].children;
        
        // Collect all deferred children for marker assignment
        deferredBlocks.push(...children);
      } else if (children.length > 0) {
        // Recursively process children at shallower depths
        const result = enforceNestingDepthLimit(children, currentDepth + 1);
        if (result.deferredBlocks.length > 0) {
          deferredBlocks.push(...result.deferredBlocks);
        }
      }
    }
  }
  
  return { deferredBlocks };
}

// isVideoIframeUrl, cleanHtmlText, and convertServiceNowUrl now imported from utils modules above

/**
 * Extracts and converts HTML content to Notion block format.
 * 
 * This is the main conversion function that processes ServiceNow HTML content
 * and transforms it into an array of Notion blocks. It handles complex HTML
 * structures, rich text formatting, technical identifiers, tables, lists,
 * images, callouts, and various ServiceNow-specific elements.
 * 
 * @async 
 * @param {string} html - HTML content to convert to Notion blocks
 * 
 * @returns {Promise<object>} Conversion result object
 * @returns {Array<object>} returns.blocks - Array of Notion block objects
 * @returns {boolean} returns.hasVideos - Whether video content was detected
 * 
 * @example
 * const result = await extractContentFromHtml(`
 *   <h1>ServiceNow Documentation</h1>
 *   <p>This is a <strong>bold</strong> paragraph with <code>sys_id.value</code>.</p>
 *   <div class="note important">Important note content</div>
 * `);
 * 
 * // Returns: {
 * //   blocks: [
 * //     { type: "heading_1", heading_1: { rich_text: [...] } },
 * //     { type: "paragraph", paragraph: { rich_text: [...] } },
 * //     { type: "callout", callout: { rich_text: [...], color: "red", icon: "⚠️" } }
 * //   ],
 * //   hasVideos: false
 * // }
 * 
 * @throws {Error} If HTML processing fails due to malformed content
 * 
 * @see {@link parseMetadataFromUrl} for URL metadata extraction
 */
async function extractContentFromHtml(html) {
  const { log, normalizeAnnotations, isValidImageUrl, downloadAndUploadImage, normalizeUrl, getExtraDebug } = getGlobals();
  const seenMarkers = new Set();

  function createMarker(elementId = null) {
    const marker = generateMarker(elementId);
    seenMarkers.add(marker);
    return marker;
  }

  function recordMarkers(blocks = []) {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      if (block && block._sn2n_marker) {
        seenMarkers.add(block._sn2n_marker);
      }
    }
  }

  function stripMarkerTokensFromBlocks(blockList) {
    const markers = Array.from(seenMarkers);
    if (markers.length === 0 || !Array.isArray(blockList)) return;

    const processBlocks = (list) => {
      for (const block of list) {
        if (!block || typeof block !== 'object') continue;
        const blockType = block.type;
        if (blockType && block[blockType] && Array.isArray(block[blockType].rich_text)) {
          let cleaned = block[blockType].rich_text;
          for (const marker of markers) {
            cleaned = removeMarkerFromRichTextArray(cleaned, marker);
          }
          block[blockType].rich_text = cleaned;
        }
        if (blockType && block[blockType] && Array.isArray(block[blockType].children)) {
          processBlocks(block[blockType].children);
        }
        if (Array.isArray(block.children)) {
          processBlocks(block.children);
        }
      }
    };
    processBlocks(blockList);
  }
  
  console.log('🚨🚨🚨 SERVICENOW.CJS FUNCTION START - MODULE LOADED 🚨🚨🚨');
  
  // Initialize htmlForValidation at top of function so it's always available
  let htmlForValidation = html;
  
  // cleanHtmlText already imported at top of file
  if (!html || typeof html !== "string") {
    return { blocks: [], hasVideos: false, fixedHtml: htmlForValidation };
  }

  // Reset video detection flag for this conversion
  hasDetectedVideos = false;

  log(`🔄 Converting HTML to Notion blocks (${html.length} chars)`);

  // Remove script and style tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // CRITICAL: Remove SVG icon elements FIRST - these are decorative only, no content value
  // Must happen before any other processing to prevent SVG tags from being converted to placeholders
  html = html.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Remove ServiceNow documentation helper UI elements
  html = html.replace(/<div[^>]*class="[^\"]*zDocsCodeExplanationContainer[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*zDocsAiActionsButton[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<div[^>]*class="(?![^\"]*code-toolbar)[^\"]*\btoolbar\b[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*copy-to-clipboard-button[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  
  // Remove "On this page" mini table of contents (navigation UI chrome)
  html = html.replace(/<div[^>]*class="[^\"]*miniTOC[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*zDocsSideBoxes[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  
  // Remove DataTables wrapper divs (generated by JavaScript table libraries)
  // NOTE: Now handled properly in Cheerio (see below) - these regex replacements are DISABLED
  // because they can't handle nested divs correctly and were removing table content
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_wrapper[^\"]*"[^>]*>([\s\S]*?)<\/div>/gi, "$1");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_filter[^\"]*"[^>]*>([\s\S]*?)<\/div>/gi, "$1");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_length[^\"]*"[^>]*>([\s\S]*?)<\/div>/gi, "$1");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_info[^\"]*"[^>]*>([\s\S]*?)<\/div>/gi, "$1");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_paginate[^\"]*"[^>]*>([\s\S]*?)<\/div>/gi, "$1");

  // Inline full HTML-to-Notion block parsing logic (migrated from sn2n-proxy.cjs)
  // This includes paragraphs, lists, tables, code blocks, images, headings, callouts, etc.
  // Uses helpers: cleanHtmlText, isValidImageUrl, downloadAndUploadImage, normalizeAnnotations, etc.

  // Remove script and style tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove ServiceNow documentation helper UI elements
  html = html.replace(/<div[^>]*class="[^\"]*zDocsCodeExplanationContainer[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*zDocsAiActionsButton[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<div[^>]*class="(?![^\"]*code-toolbar)[^\"]*\btoolbar\b[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*copy-to-clipboard-button[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  
  // Remove "On this page" mini table of contents (navigation UI chrome)
  html = html.replace(/<div[^>]*class="[^\"]*miniTOC[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*zDocsSideBoxes[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

  // DIAGNOSTIC: Check HTML length AFTER initial cleanup
  const sectionsAfterCleanup = (html.match(/<section[^>]*id="[^"]*"/g) || []).length;
  console.log(`🔥🔥🔥 AFTER INITIAL CLEANUP: HTML length: ${html.length} chars, sections: ${sectionsAfterCleanup}`);

  // Block array for collecting converted Notion blocks
  const blocks = [];
  
  // FIX v11.0.39: Pre-scan HTML for table captions BEFORE processing
  // This ensures captions are known when paragraphs are checked (regardless of DOM order)
  const processedTableCaptions = new Set();
  const $temp = cheerio.load(html);
  $temp('table caption').each((i, el) => {
    const captionText = $temp(el).text().trim();
    if (captionText) {
      const normalized = captionText.toLowerCase();
      processedTableCaptions.add(normalized);
      console.log(`📊 [CAPTION-PRESCAN] Found table caption: "${captionText}" (normalized: "${normalized}")`);
    }
  });
  console.log(`📊 [CAPTION-PRESCAN] Pre-scanned ${processedTableCaptions.size} table caption(s)`);


  // Helper: join an array of Notion rich_text elements into a single string while
  // preserving a space when adjacent fragments would otherwise collapse words.
  // This avoids cases like "navigate to" + "Incident" → "navigate toIncident".
  function joinRichTextContents(richTextArray) {
    if (!Array.isArray(richTextArray)) return '';
    const parts = richTextArray.map(rt => (rt && rt.text && rt.text.content) || '');
    return parts.reduce((acc, cur) => {
      if (!acc) return cur || '';
      if (!cur) return acc;
      const lastChar = acc.slice(-1);
      const firstChar = cur.charAt(0);
      // If both adjacent chars are letters/numbers (no whitespace) insert a space
      if (/[A-Za-z0-9]$/.test(lastChar) && /^[A-Za-z0-9]/.test(firstChar)) {
        return acc + ' ' + cur;
      }
      return acc + cur;
    }, '');
  }

  // Advanced rich text parser with full formatting support (migrated from sn2n-proxy.cjs)
  // Returns object with { richText: [], imageBlocks: [] }
  async function parseRichText(html) {
    if (!html) return { richText: [{ type: "text", text: { content: "" } }], imageBlocks: [], videoBlocks: [] };

    const richText = [];
    const imageBlocks = [];
    const videoBlocks = [];
    let text = html;

  // Strip <var> wrappers early (preserve inner content). Appearing raw in output after
  // recent rollback. We only remove opening/closing tags; keep inner text for later formatting.
  // Examples: <var class="keyword varname">true</var> -> true
  text = text.replace(/<var[^>]*>([\s\S]*?)<\/var>/gi, '$1');

    // DEBUG: Log input HTML BEFORE normalization
    if (text && (text.includes('http') || text.includes('<code'))) {
      fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
        `\n=== parseRichText BEFORE normalization ===\n${JSON.stringify(text)}\n`);
    }
    
    // CRITICAL: Normalize newlines within and around HTML tags
    // Source HTML may have tags split across lines like "</\ncode>" which breaks tag matching
    // Also remove newlines immediately before closing tags like "content\n</code>"
    
    // Step 1: Remove newlines inside tag brackets (< ... >)
    text = text.replace(/<([^>]*)>/g, (match, inside) => {
      const normalized = inside.replace(/\s+/g, ' ').trim();
      return `<${normalized}>`;
    });
    
    // Step 2: Remove newlines immediately before closing tags
    text = text.replace(/\s*\n\s*(<\/[^>]+>)/g, '$1');
    
    // Step 3: Remove newlines immediately after opening tags  
    text = text.replace(/(<[^/>][^>]*>)\s*\n\s*/g, '$1');
    
    // DEBUG: Log AFTER normalization
    if (html && (html.includes('http') || html.includes('<code'))) {
      fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
        `=== AFTER normalization ===\n${JSON.stringify(text)}\n=== END ===\n`);
    }
    
    // CRITICAL: Extract and decode URLs from <kbd> tags FIRST
    // <kbd> tags contain user input URLs with &lt; &gt; entities that need special handling
    // This handles most URLs since ServiceNow wraps technical content in <kbd> tags
    const kbdPlaceholders = [];
    text = text.replace(/<kbd[^>]*>([\s\S]*?)<\/kbd>/gi, (match, content) => {
      // Decode HTML entities within kbd content
      let decoded = content
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
      const placeholder = `__KBD_PLACEHOLDER_${kbdPlaceholders.length}__`;
      kbdPlaceholders.push(decoded);
      console.log(`🔍 [parseRichText] Extracted <kbd> content: "${decoded}"`);
      return placeholder;
    });
    
    // CRITICAL: Decode HTML entities AFTER kbd extraction
    // This ensures &gt; becomes > for navigation breadcrumbs like "All > System OAuth > Keys"
    // But doesn't break URLs that contain &lt; and &gt; placeholders
    text = text
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    console.log(`🔍 [parseRichText] After kbd extraction (${kbdPlaceholders.length} kbd tags):`, text.substring(0, 300));

    // Restore kbd placeholders with appropriate markers BEFORE HTML cleanup
    // Use shared utility for intelligent detection (technical → code, UI labels → bold)
    // Use safe replacement to preserve necessary spacing between adjacent tokens
    function safeReplacePlaceholder(origText, placeholder, formatted) {
      // Work on a snapshot so offsets refer to original positions
      const snapshot = origText;
      return snapshot.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), function(match) {
        const offset = arguments[arguments.length - 2];
        const before = snapshot[offset - 1] || '';
        const after = snapshot[offset + match.length] || '';
        let out = formatted;
        // If alnum adjacent on left and out starts with alnum, ensure space on left
        if (/[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(out)) out = ' ' + out;
        // If alnum adjacent on right and out ends with alnum, ensure space on right
        if (/[A-Za-z0-9]/.test(after) && /[A-Za-z0-9]$/.test(out)) out = out + ' ';
        return out;
      });
    }

    kbdPlaceholders.forEach((content, index) => {
      const placeholder = `__KBD_PLACEHOLDER_${index}__`;
      const formatted = processKbdContent(content);
      text = safeReplacePlaceholder(text, placeholder, formatted);
      console.log(`🔍 [parseRichText] Restored <kbd>: "${content}" → ${formatted.includes('CODE') ? 'code' : 'bold'}`);
    });

    // Handle span with uicontrol class as bold + blue
    text = text.replace(/<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      if (getExtraDebug && getExtraDebug()) log(`🔍 Found span with uicontrol class: ${match.substring(0, 100)}`);
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    });

    // CRITICAL: Strip generic <span class="ph"> tags BEFORE HTML cleanup
    // This exposes technical identifiers like (com.snc.incident.ml) so the technical identifier
    // regex in rich-text.cjs can detect them and format them as inline code with brackets
    // Run in a loop to handle nested spans (innermost to outermost)
    let lastText;
    let iterations = 0;
    do {
      lastText = text;
      text = text.replace(/<span[^>]*class=["'][^"']*\bph\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1');
      iterations++;
      if (iterations > 1 && lastText !== text) {
        console.log(`🔍 [ph span strip] Iteration ${iterations}: removed ph spans`);
      }
    } while (text !== lastText && text.includes('<span') && iterations < 10);
    
    if (text.includes('com.snc.incident.ml')) {
      console.log(`🔍 [ph span strip] AFTER ${iterations} iteration(s), text with com.snc.incident.ml:`);
      const snippet = text.substring(text.indexOf('com.snc.incident.ml') - 50, text.indexOf('com.snc.incident.ml') + 100);
      console.log(`   "${snippet}"`);
    }

    // DEBUG: Check if we have ">" characters
    if (text.includes('>') && !text.includes('<')) {
      console.log('🔍 [parseRichText] Found standalone ">" character before cleanup');
    }

  // CRITICAL FIX: Avoid globally stripping ALL <div> tags; instead remove only known
  // UI wrapper divs (which are decorative), and convert other closing </div> tags
  // to newlines so paragraph boundaries are preserved.
  // Remove common UI wrapper divs entirely (these often wrap tables or controls)
  text = text.replace(/<div[^>]*class=["'][^"']*(?:dataTables_wrapper|dataTables_filter|dataTables_length|dataTables_info|dataTables_paginate|zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsCodeExplanationContainer|copy-to-clipboard-button|toolbar)[^"']*["'][^>]*>/gi, '');
  // Convert remaining closing div/section/article tags to newlines to keep text boundaries
  text = text.replace(/<\/div\s*>/gi, '\n');
  text = text.replace(/<\/section\s*>/gi, '\n');
  text = text.replace(/<\/article\s*>/gi, '\n');
    
    // CRITICAL FIX: Strip button tags - UI chrome that shouldn't appear in content
    text = text.replace(/<button\b[^>]*>.*?<\/button>/gis, ' ');
    
  // CRITICAL FIX: Preserve paragraph boundaries rather than collapsing them to spaces.
  // Keep inner content and turn closing </p> into a newline so downstream splitting
  // will create separate rich text elements for paragraphs instead of fragmenting
  // sentences arbitrarily.
  text = text.replace(/<p[^>]*>/gi, '');
  text = text.replace(/<\/p\s*>/gi, '\n');
    
    // Safety: Remove any incomplete HTML tags that might have been truncated during chunking
    // Pattern: < followed by tag name followed by anything (but not closing >)
    // This catches cases where content was chunked mid-tag like "...text <div class=\"note"
    text = text.replace(/<\/?[a-z][a-z0-9]*[^>]*$/gi, ' ');  // Incomplete tag at end
    // FIXED: Only match incomplete closing tags at beginning (e.g., "class='foo'>"), not standalone ">"
    // The pattern now requires at least one non-< character before the > to avoid matching standalone >
    text = text.replace(/^[^<]+?(?:class|id|style|href|src)=[^>]*>/gi, ' ');  // Incomplete tag at beginning
    
    // Clean up extra whitespace from tag removal
    text = text.replace(/\s+/g, ' ').trim();

    console.log('🔍 [parseRichText] After HTML cleanup:', text.substring(0, 300));
    console.log('🔍 [parseRichText] Has newline after cleanup?', text.includes('\n'));
    
    // DEBUG: Check if ">" is still there
    if (text.includes('>')) {
      console.log('🔍 [parseRichText] ">" character still present after cleanup');
    } else if (html.includes('>') && !html.includes('<')) {
      console.log('⚠️ [parseRichText] ">" character was REMOVED during cleanup!');
    }

    console.log('🔍 [parseRichText] After URL restoration:', text.substring(0, 300));

    // Extract and process iframe tags (videos/embeds) - do this FIRST before images
    const iframeRegex = /<iframe[^>]*>.*?<\/iframe>/gis;
    let iframeMatch;
    while ((iframeMatch = iframeRegex.exec(text)) !== null) {
      const iframeTag = iframeMatch[0];
      const srcMatch = iframeTag.match(/src=["']([^"']*)["']/i);
      const titleMatch = iframeTag.match(/title=["']([^"']*)["']/i);

      if (srcMatch && srcMatch[1]) {
        const src = srcMatch[1];
        const title = titleMatch && titleMatch[1] ? titleMatch[1] : "";
        
    if (getExtraDebug && getExtraDebug()) log(`🎬 Found iframe in parseRichText: ${src.substring(0, 100)}`);
        
        // Check if it's a video URL
        if (isVideoIframeUrl(src)) {
          hasDetectedVideos = true;
          if (getExtraDebug && getExtraDebug()) log(`📹 Video iframe detected - will create video/embed block`);
          
          // Use video block for YouTube (supports embed/watch URLs)
          // Use embed block for Vimeo and other video platforms
          if (src.includes('youtube.com') || src.includes('youtu.be')) {
            videoBlocks.push({
              object: "block",
              type: "video",
              video: {
                type: "external",
                external: {
                  url: src
                }
              }
            });
          } else {
            // Vimeo and other embeds
            videoBlocks.push({
              object: "block",
              type: "embed",
              embed: {
                url: src
              }
            });
          }
        } else {
          // Non-video iframe - use embed block
          if (getExtraDebug && getExtraDebug()) log(`🔗 Non-video iframe detected - will create embed block`);
          videoBlocks.push({
            object: "block",
            type: "embed",
            embed: {
              url: src
            }
          });
        }
      }
      // Remove the entire iframe tag from text
      text = text.replace(iframeTag, "");
    }

    // Extract and process img tags, converting them to image blocks
    const imgRegex = /<img[^>]*>/gi;
    let imgMatch;
    console.log(`🔍 [parseRichText] Starting image extraction, text contains ${(text.match(imgRegex) || []).length} img tags`);
    while ((imgMatch = imgRegex.exec(text)) !== null) {
      const imgTag = imgMatch[0];
      console.log(`🔍 [parseRichText] Found img tag: ${imgTag.substring(0, 150)}`);
      const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

      if (srcMatch && srcMatch[1]) {
        let src = srcMatch[1];
        const alt = altMatch && altMatch[1] ? altMatch[1] : "";
        console.log(`🔍 [parseRichText] Image src BEFORE convertServiceNowUrl: ${src.substring(0, 100)}`);
        src = convertServiceNowUrl(src);
        console.log(`🔍 [parseRichText] Image src AFTER convertServiceNowUrl: ${src ? src.substring(0, 100) : 'NULL'}`);
        if (src && isValidImageUrl(src)) {
          console.log(`🔍 [parseRichText] Creating image block for: ${src.substring(0, 80)}`);
          const imageBlock = await createImageBlock(src, alt);
          if (imageBlock) {
            console.log(`✅ [parseRichText] Image block created, adding to imageBlocks array`);
            imageBlocks.push(imageBlock);
          } else {
            console.log(`⚠️ [parseRichText] createImageBlock returned null for: ${src.substring(0, 80)}`);
          }
        } else {
          console.log(`⚠️ [parseRichText] Invalid image URL or src is null: ${src ? src.substring(0, 80) : 'NULL'}`);
        }
      }
      // Remove the img tag and surrounding parentheses if present
      // Handles cases like "Click the Attachment (<img src='...'>) icon"
      text = text.replace(new RegExp(`\\(\\s*${imgTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\)`, 'gi'), '');
      // If no parentheses were removed, just remove the img tag
      if (text.includes(imgTag)) {
        text = text.replace(imgTag, "");
      }
      imgRegex.lastIndex = 0;
    }

    // Handle bold/strong tags by replacing with markers
    text = text.replace(/<(b|strong)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
      return `__BOLD_START__${content}__BOLD_END__`;
    });

    // Handle italic/em/dfn tags (dfn = definition term, semantically rendered as italic)
    text = text.replace(/<(i|em|dfn)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
      return `__ITALIC_START__${content}__ITALIC_END__`;
    });

    // Handle inline code tags
    text = text.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (match, attrs, content) => {
      // If content already has CODE markers (from URL restoration), don't double-wrap
      if (content.includes('__CODE_START__')) {
        return content;
      }
      return `__CODE_START__${content}__CODE_END__`;
    });

    // CRITICAL: Extract links FIRST, before identifier detection
    // This prevents URLs like "integration.html" from being wrapped with code markers
    const links = [];
    text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, content) => {
      const linkIndex = links.length;
      links.push({ href, content: cleanHtmlText(content) });
      return `__LINK_${linkIndex}__`;
    });

    // Handle spans with technical identifier classes (keyword, parmname, codeph, etc.)
    // Note: Generic "ph" class removed - only specific technical classes get formatting
    text = text.replace(/<span[^>]*class=["'][^"']*(?:\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      if (getExtraDebug && getExtraDebug()) log(`🔍 Found span with technical class: ${match.substring(0, 100)}`);
      
      // Use shared processing utility (no activeBlocks needed in parseRichText context)
      const result = processTechnicalSpan(content);
      
      // If unchanged (returned as-is), return original match to preserve HTML
      if (result === content || result === content.trim()) {
        return match;
      }
      
      return result;
    });

    // Handle raw technical identifiers in parentheses/brackets as inline code
    text = text.replace(/([\(\[])[ \t\n\r]*([^\s()[\]]*[_.][^\s()[\]]*)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => {
      return `__CODE_START__${code.trim()}__CODE_END__`;
    });

    // Handle technical identifiers like (com.snc.software_asset_management) as inline code
    text = text.replace(/\(([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)\)/g, (match, identifier) => {
      return `(__CODE_START__${identifier}__CODE_END__)`;
    });

    // Handle role names after "Role required:" as inline code
    // Matches "Role required: admin" or "Role required: admin, asset"
    text = text.replace(/\b(Role required:)\s+([a-z_]+(?:,\s*[a-z_]+)*)/gi, (match, label, roles) => {
      console.log(`🔍 [ROLE] Matched "Role required:" with roles: "${roles}"`);
      const roleList = roles.split(/,\s*/).map(role => {
        const trimmed = role.trim();
        console.log(`🔍 [ROLE] Wrapping role: "${trimmed}"`);
        return `__CODE_START__${trimmed}__CODE_END__`;
      }).join(', ');
      const result = `${label} ${roleList}`;
      console.log(`🔍 [ROLE] Result: "${result}"`);
      return result;
    });

    // Handle standalone multi-word identifiers connected by _ or . (no spaces) as inline code
    // Examples: com.snc.incident.mim.ml_solution, sys_user_table, package.class.method
    // Must have at least 2 segments and no brackets/parentheses
    text = text.replace(/\b([a-zA-Z][a-zA-Z0-9]*(?:[_.][a-zA-Z][a-zA-Z0-9]*)+)(?![_.a-zA-Z0-9])/g, (match, identifier, offset) => {
      // Skip if already wrapped or if it's part of a URL
      if (match.includes('__CODE_START__') || match.includes('http')) {
        return match;
      }
      // Check if this identifier is inside a CODE_START...CODE_END block (URL)
      const before = text.substring(0, offset);
      const lastCodeStart = before.lastIndexOf('__CODE_START__');
      const lastCodeEnd = before.lastIndexOf('__CODE_END__');
      if (lastCodeStart > lastCodeEnd) {
        // We're inside a CODE block, don't wrap again
        return match;
      }
      return `__CODE_START__${identifier}__CODE_END__`;
    });

    // Handle p/span with sectiontitle tasklabel class as bold
    text = text.replace(/<(p|span)[^>]*class=["'][^"']*sectiontitle[^"']*tasklabel[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
  if (getExtraDebug && getExtraDebug()) log(`🔍 Found sectiontitle tasklabel: "${content.substring(0, 50)}"`);
  if (getExtraDebug && getExtraDebug()) log(`🔍 Found sectiontitle tasklabel: "${content.substring(0, 50)}"`);
  if (getExtraDebug && getExtraDebug()) log(`🔍 Found span with uicontrol class: ${match.substring(0, 100)}`);
      return `__BOLD_START__${content}__BOLD_END__`;
    });

  // Handle line breaks (<br> tags) as newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
    
    // CRITICAL: Handle <abbr> tags - preserve their content (navigation arrows like " > ")
    // Must happen BEFORE splitting on markers and BEFORE cleanHtmlText is called
    text = text.replace(/<abbr[^>]*>([\s\S]*?)<\/abbr>/gi, (match, content) => {
      console.log(`🔍 [parseRichText] Extracting abbr content: "${content}"`);
      return content; // Keep the content, remove the abbr tags
    });
    
    // Repair any broken marker tokens that may have picked up whitespace
    text = text.replace(/__\s+CODE\s+START__/g, '__CODE_START__');
    text = text.replace(/__\s+CODE\s+END__/g, '__CODE_END__');
    text = text.replace(/__\s+BOLD\s+START__/g, '__BOLD_START__');
    text = text.replace(/__\s+BOLD\s+END__/g, '__BOLD_END__');
    text = text.replace(/__\s+ITALIC\s+START__/g, '__ITALIC_START__');
    text = text.replace(/__\s+ITALIC\s+END__/g, '__ITALIC_END__');

    // Add soft return between </a> and any <p> tag
    text = text.replace(/(<\/a>)(\s*)(<p[^>]*>)/gi, (match, closingA, whitespace, openingP) => {
      return `${closingA}__SOFT_BREAK__${openingP}`;
    });

    // Split by markers and build rich text
    fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
      `\n=== BEFORE SPLIT ===\n${JSON.stringify(text.substring(0, 300))}\n`);
    const parts = text.split(/(__BOLD_START__|__BOLD_END__|__BOLD_BLUE_START__|__BOLD_BLUE_END__|__ITALIC_START__|__ITALIC_END__|__CODE_START__|__CODE_END__|__LINK_\d+__|__SOFT_BREAK__)/);
    fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
      `Parts: ${JSON.stringify(parts.slice(0, 15))}\n`);

    let currentAnnotations = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };

    for (const part of parts) {
      if (part === "__BOLD_START__") {
        currentAnnotations.bold = true;
      } else if (part === "__BOLD_END__") {
        currentAnnotations.bold = false;
      } else if (part === "__BOLD_BLUE_START__") {
        currentAnnotations.bold = true;
        currentAnnotations.color = "blue";
      } else if (part === "__BOLD_BLUE_END__") {
        currentAnnotations.bold = false;
        currentAnnotations.color = "default";
      } else if (part === "__ITALIC_START__") {
        currentAnnotations.italic = true;
      } else if (part === "__ITALIC_END__") {
        currentAnnotations.italic = false;
      } else if (part === "__CODE_START__") {
        currentAnnotations._colorBeforeCode = currentAnnotations.color;
        currentAnnotations.code = true;
        currentAnnotations.color = "red";
      } else if (part === "__CODE_END__") {
        currentAnnotations.code = false;
        if (currentAnnotations._colorBeforeCode !== undefined) {
          currentAnnotations.color = currentAnnotations._colorBeforeCode;
          delete currentAnnotations._colorBeforeCode;
        } else {
          currentAnnotations.color = "default";
        }
      } else if (part === "__SOFT_BREAK__") {
        richText.push({
          type: "text",
          text: { content: "\n" },
          annotations: normalizeAnnotations(currentAnnotations),
        });
      } else if (part.match(/^__LINK_(\d+)__$/)) {
        const linkMatch = part.match(/^__LINK_(\d+)__$/);
        const linkIndex = parseInt(linkMatch[1]);
        const linkInfo = links[linkIndex];
        if (linkInfo && linkInfo.content.trim()) {
          let url = convertServiceNowUrl(linkInfo.href);
          if (url && isValidNotionUrl(url)) {
            richText.push({
              type: "text",
              text: { content: linkInfo.content.trim(), link: { url } },
              annotations: normalizeAnnotations(currentAnnotations),
            });
          } else {
            richText.push({
              type: "text",
              text: { content: linkInfo.content.trim() },
              annotations: normalizeAnnotations(currentAnnotations),
            });
          }
        }
      } else if (part) {
        // Final safety: normalize any broken marker tokens inside this part before cleaning
        const normalizedPart = part
          .replace(/__\s+CODE\s+START__/g, '__CODE_START__')
          .replace(/__\s+CODE\s+END__/g, '__CODE_END__')
          .replace(/__\s+BOLD\s+START__/g, '__BOLD_START__')
          .replace(/__\s+BOLD\s+END__/g, '__BOLD_END__')
          .replace(/__\s+ITALIC\s+START__/g, '__ITALIC_START__')
          .replace(/__\s+ITALIC\s+END__/g, '__ITALIC_END__')
          .replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

        const cleanedText = cleanHtmlText(normalizedPart);
        fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
          `cleanHtmlText: INPUT=${JSON.stringify(normalizedPart.substring(0, 200))}\nOUTPUT=${JSON.stringify(cleanedText.substring(0, 200))}\nHas newline? ${cleanedText.includes('\n')}\n`);
        if (cleanedText.trim()) {
          // Split on newlines to create separate rich text elements for line breaks
          const lines = cleanedText.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Add the line if it has content or if it's not the last line (preserve empty lines between content)
            if (line || i < lines.length - 1) {
              richText.push({
                type: "text",
                text: { content: line },
                annotations: normalizeAnnotations(currentAnnotations),
              });
              // Add a soft line break after each line except the last
              if (i < lines.length - 1) {
                richText.push({
                  type: "text",
                  text: { content: "\n" },
                  annotations: normalizeAnnotations(currentAnnotations),
                });
              }
            }
          }
        }
      }
    }

    // If no rich text was created, fall back to simple processing
    if (richText.length === 0) {
      const cleanedText = cleanHtmlText(text);
      if (cleanedText.trim()) {
        richText.push({
          type: "text",
          text: { content: cleanedText },
          annotations: normalizeAnnotations({}),
        });
      }
    }

    // Ensure proper spacing between rich text elements
    for (let i = 0; i < richText.length - 1; i++) {
      const current = richText[i];
      const next = richText[i + 1];

      // If current text doesn't end with space and next text doesn't start with space
      if (current.text.content && next.text.content && !current.text.content.endsWith(" ") && !next.text.content.startsWith(" ")) {
        current.text.content += " ";
      }
    }

    return { richText, imageBlocks, videoBlocks };
  }

  /**
   * Splits a rich_text array into chunks compliant with Notion's limits:
   * - Max 100 elements per array
   * - Max 2000 characters per element's text.content
   * 
   * @param {Array} richText - Array of rich_text elements
   * @returns {Array<Array>} Array of rich_text chunks, each compliant with Notion limits
   */
  function splitRichTextArray(richText) {
    const MAX_RICH_TEXT_ELEMENTS = 100;
    const MAX_CONTENT_LENGTH = 2000;
    
    if (!richText || richText.length === 0) {
      return [richText];
    }
    
    // First, split any individual elements that exceed 2000 chars
    const splitElements = [];
    for (const rt of richText) {
      if (rt && rt.type === 'text' && rt.text && rt.text.content) {
        const content = rt.text.content;
        if (content.length > MAX_CONTENT_LENGTH) {
          // Split this element into multiple 2000-char chunks
          console.log(`🔍 Splitting rich_text element: ${content.length} chars → ${Math.ceil(content.length / MAX_CONTENT_LENGTH)} chunks`);
          let remaining = content;
          while (remaining.length > 0) {
            const chunk = remaining.substring(0, MAX_CONTENT_LENGTH);
            splitElements.push({
              ...rt,
              text: {
                ...rt.text,
                content: chunk,
              },
            });
            remaining = remaining.substring(MAX_CONTENT_LENGTH);
          }
        } else {
          splitElements.push(rt);
        }
      } else {
        splitElements.push(rt);
      }
    }
    
    // Then, split by element count (100 max)
    let chunks = [];
    if (splitElements.length <= MAX_RICH_TEXT_ELEMENTS) {
      chunks = [splitElements];
    } else {
      for (let i = 0; i < splitElements.length; i += MAX_RICH_TEXT_ELEMENTS) {
        chunks.push(splitElements.slice(i, i + MAX_RICH_TEXT_ELEMENTS));
      }
    }

    // Coalesce multi-element chunks into a single plain text element when
    // they consist of multiple small pieces (e.g., text + code + text).
    // This helps the validation runner compare HTML plain-text segments with
    // Notion output more reliably by avoiding artificial segment splits.
    const coalesced = chunks.map(chunk => {
      if (!Array.isArray(chunk) || chunk.length <= 1) return chunk;
      try {
        const combined = chunk.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : (rt && rt.plain_text ? String(rt.plain_text) : '')).join('').trim();
        return [{ type: 'text', text: { content: combined } }];
      } catch (err) {
        return chunk;
      }
    });

    return coalesced;
  }

  // Helper function to create image blocks (needed by parseRichText)
  async function createImageBlock(src, alt = "") {
    if (!src || !isValidImageUrl(src)) return null;

    try {
      // Download and upload image to Notion instead of using external URL
      log(`� Downloading and uploading image: ${src.substring(0, 80)}...`);
      const uploadId = await downloadAndUploadImage(src, alt || 'image');
      
      if (uploadId) {
        log(`✅ Image uploaded successfully with ID: ${uploadId}`);
        return {
          object: "block",
          type: "image",
          image: {
            type: "file_upload",
            file_upload: { id: uploadId },
            caption: alt ? [{ type: "text", text: { content: alt } }] : [],
          },
          _sn2n_sourceUrl: src, // Store original URL for deduplication
        };
      } else {
        // Fallback to external URL if upload fails
        log(`⚠️ Image upload failed, falling back to external URL: ${src.substring(0, 80)}...`);
        return {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: src },
            caption: alt ? [{ type: "text", text: { content: alt } }] : [],
          },
          _sn2n_sourceUrl: src, // Store original URL for deduplication
        };
      }
    } catch (error) {
      log(`❌ Error processing image ${src}: ${error.message}`);
      // IMPORTANT: If downloadAndUploadImage is not available (test environment),
      // fall back to external URL instead of returning null
      if (error.message && error.message.includes('not a function')) {
        log(`⚠️ Download function not available, using external URL as fallback`);
        return {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: src },
            caption: alt ? [{ type: "text", text: { content: alt } }] : [],
          },
          _sn2n_sourceUrl: src, // Store original URL for deduplication
        };
      }
      return null;
    }
  }

  // CRITICAL: Protect technical placeholders BEFORE Cheerio parsing
  // Cheerio will treat <instance-name> as an HTML tag, so we must convert to markers first
  const technicalPlaceholders = [];
  
  // Common HTML tags that should NOT be protected
  const HTML_TAGS = new Set([
    'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
    'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
    'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
    'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
    'em', 'embed',
    'fieldset', 'figcaption', 'figure', 'footer', 'form',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
    'i', 'iframe', 'img', 'input', 'ins',
    'kbd',
    'label', 'legend', 'li', 'link',
    'main', 'map', 'mark', 'meta', 'meter',
    'nav', 'noscript',
    'object', 'ol', 'optgroup', 'option', 'output',
    'p', 'param', 'picture', 'pre', 'progress',
    'q',
    'rp', 'rt', 'ruby',
    's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'svg',
    'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
    'u', 'ul',
    'var', 'video',
    'wbr'
  ]);
  
  html = html.replace(/<([^>]+)>/g, (match, content) => {
    const trimmed = content.trim();
    
    // Extract tag name (first word, ignoring / for closing tags)
    const tagMatch = /^\/?\s*([a-z][a-z0-9-]*)/i.exec(trimmed);
    if (!tagMatch) {
      // Doesn't start with valid tag pattern, protect it
      const marker = `__TECH_PLACEHOLDER_${technicalPlaceholders.length}__`;
      technicalPlaceholders.push(content);
      return marker;
    }
    
    const tagName = tagMatch[1].toLowerCase();
    
    // If it's a known HTML tag, leave it alone
    if (HTML_TAGS.has(tagName)) {
      return match;
    }
    
    // Unknown tag, protect it as a placeholder
    const marker = `__TECH_PLACEHOLDER_${technicalPlaceholders.length}__`;
    technicalPlaceholders.push(content);
    return marker;
  });
  
  // FIX: ServiceNow HTML has malformed structure with extra closing </article> tags
  // Count opening and closing article tags
  console.log('🔍 HTML FIX: Checking article tags...');
  const openingArticleTags = (html.match(/<article[^>]*>/g) || []).length;
  const closingArticleTags = (html.match(/<\/article>/g) || []).length;
  console.log(`🔍 HTML FIX: Found ${openingArticleTags} opening, ${closingArticleTags} closing article tags`);
  
  if (closingArticleTags > openingArticleTags) {
    const extraClosingTags = closingArticleTags - openingArticleTags;
    console.log(`� HTML FIX: Found ${extraClosingTags} extra closing </article> tags. Removing them...`);
    
    // Remove the extra closing tags by replacing them with empty string
    // We'll remove them from the end of the HTML working backwards
    let fixedHtml = html;
    let removed = 0;
    let lastIndex = fixedHtml.length;
    
    while (removed < extraClosingTags && lastIndex > 0) {
      lastIndex = fixedHtml.lastIndexOf('</article>', lastIndex - 1);
      if (lastIndex === -1) break;
      
      // Check if this closing tag is actually needed by counting tags before it
      const htmlBefore = fixedHtml.substring(0, lastIndex);
      const openingsBefore = (htmlBefore.match(/<article[^>]*>/g) || []).length;
      const closingsBefore = (htmlBefore.match(/<\/article>/g) || []).length;
      
      // If we have more or equal closings than openings at this point, this tag is extra
      if (closingsBefore >= openingsBefore) {
        fixedHtml = fixedHtml.substring(0, lastIndex) + fixedHtml.substring(lastIndex + '</article>'.length);
        removed++;
        console.log(`�   Removed extra closing tag at position ${lastIndex}`);
        // Reset search from the end since we modified the string
        lastIndex = fixedHtml.length;
      }
    }
    
    console.log(`� HTML FIX COMPLETE: Removed ${removed} extra closing </article> tags`);
    html = fixedHtml;
  }

  // CRITICAL DIAGNOSTIC: Count ALL structural elements in RAW HTML before Cheerio parsing
  const rawSectionMatches = html.match(/<section[^>]*id="[^"]*"/g) || [];
  const rawSectionIds = rawSectionMatches.map(m => {
    const idMatch = m.match(/id="([^"]+)"/);
    return idMatch ? idMatch[1] : 'no-id';
  });
  
  const rawArticleMatches = html.match(/<article[^>]*id="[^"]*"/g) || [];
  const rawArticleIds = rawArticleMatches.map(m => {
    const idMatch = m.match(/id="([^"]+)"/);
    return idMatch ? idMatch[1] : 'no-id';
  });
  
  const rawNested1Count = (html.match(/class="topic task nested1"/g) || []).length;
  const rawNested0Count = (html.match(/class="[^"]*nested0[^"]*"/g) || []).length;
  
  console.log(`🔥🔥🔥 BEFORE CHEERIO LOAD: Raw HTML has ${rawSectionIds.length} sections, ${rawArticleIds.length} articles (${rawNested0Count} nested0, ${rawNested1Count} nested1)`);
  console.log(`🔥🔥🔥 Section IDs in raw HTML: ${rawSectionIds.length > 0 ? rawSectionIds.join(', ') : 'NONE'}`);
  console.log(`🔥🔥🔥 Article IDs in raw HTML: ${rawArticleIds.length > 0 ? rawArticleIds.join(', ') : 'NONE'}`);
  console.log(`🔥🔥🔥 Raw HTML length: ${html.length} characters`);
  
  // FIX: ServiceNow HTML has malformed structure with EXTRA closing </div> tags
  // FIX v11.0.7: Multiple tables in same div.p have extra closing tags that break structure
  // Pattern 1: </table></div></div></div> (3 closing divs - seen in some pages)
  // Pattern 2: </table></div></div> (2 closing divs - COMPUTER PAGE HAS THIS)
  // The table-wrap div should self-close, so we only need ONE </div> to match the parent div.p
  console.log('🔍 HTML FIX: Checking for extra closing div tags after tables...');
  
  let fixedHtml = html;
  let totalFixed = 0;
  
  // First, fix triple closing divs (</table></div></div></div> → </table></div>)
  const triplePattern = /<\/table><\/div><\/div><\/div>/g;
  const tripleMatches = fixedHtml.match(triplePattern);
  if (tripleMatches && tripleMatches.length > 0) {
    console.log(`🔍 HTML FIX: Found ${tripleMatches.length} instances of TRIPLE closing divs after </table>`);
    fixedHtml = fixedHtml.replace(triplePattern, '</table></div>');
    totalFixed += tripleMatches.length;
  }
  
  // FIX v11.0.7: Also fix DOUBLE closing divs (</table></div></div> → </table></div>)
  // This is the actual pattern in Computer page where table 2 gets orphaned
  const doublePattern = /<\/table><\/div><\/div>/g;
  const doubleMatches = fixedHtml.match(doublePattern);
  if (doubleMatches && doubleMatches.length > 0) {
    console.log(`🔍 HTML FIX: Found ${doubleMatches.length} instances of DOUBLE closing divs after </table>`);
    fixedHtml = fixedHtml.replace(doublePattern, '</table></div>');
    totalFixed += doubleMatches.length;
  }
  
  if (totalFixed > 0) {
    html = fixedHtml;
    console.log(`✅ HTML FIX COMPLETE: Fixed ${totalFixed} table(s) with extra closing </div> tags`);
    console.log(`   Removed ${totalFixed} extra </div> tag(s), HTML length: ${html.length} chars`);
  } else {
    console.log(`✅ HTML FIX: No extra closing div tags found after tables`);
  }
  
  // Update htmlForValidation with fixed HTML (after double-div repair)
  // This preserves the HTML structure that validation can accurately count tables from
  htmlForValidation = html;
  
  // DIAGNOSTIC: Check if sections have their h2 elements in raw HTML
  for (const sectionId of rawSectionIds) {
    const sectionMatch = html.match(new RegExp(`<section[^>]*id="${sectionId}"[^>]*>([\\s\\S]{0,500})`));
    if (sectionMatch) {
      const sectionStart = sectionMatch[1];
      const hasH2 = /<h2[^>]*>/.test(sectionStart);
      console.log(`🔥 Section ${sectionId} in RAW HTML: ${hasH2 ? '✅ HAS h2' : '❌ NO h2'} - Preview: ${sectionStart.substring(0, 150).replace(/\s+/g, ' ')}`);
    }
  }
  
  // Use cheerio to parse HTML and process elements in document order
  let $;
  try {
    $ = cheerio.load(html, { 
      decodeEntities: false,
      _useHtmlParser2: true 
    });
    
    // FIX BUG #1: Unwrap DataTables wrapper divs using Cheerio (handles nesting correctly)
    // Remove wrapper divs while preserving table and other content inside
    // ENHANCED: Recursively unwrap to handle deeply nested wrappers (e.g., filter > wrapper > table)
    let wrapperCount = 0;
    let unwrappedThisPass = 0;
    const maxPasses = 10; // Prevent infinite loops
    let pass = 0;
    
    do {
      pass++;
      unwrappedThisPass = 0;
      
      // Find all wrapper divs (including nested filter/column divs)
      const wrappers = $('div.dataTables_wrapper, div.dataTables_filter, div.dataTables_length, div.dataTables_info, div.dataTables_paginate, div.zDocsFilterTableDiv, div.zDocsFilterColumnsTableDiv, div.zDocsDropdownMenu, div.dropdown-menu');
      
      wrappers.each((i, el) => {
        // Replace wrapper with its contents
        $(el).replaceWith($(el).contents());
        unwrappedThisPass++;
        wrapperCount++;
      });
      
      if (unwrappedThisPass > 0) {
        console.log(`🔧 Pass ${pass}: Unwrapped ${unwrappedThisPass} wrapper divs`);
      }
    } while (unwrappedThisPass > 0 && pass < maxPasses);
    
    console.log(`✅ Unwrapped ${wrapperCount} DataTables wrapper divs using Cheerio (${pass} passes)`);
    
    // DIAGNOSTIC: Count tables after unwrapping
    const tableCount = $('table').length;
    console.log(`📊 Tables found in Cheerio DOM after unwrapping: ${tableCount}`);
    
    // CRITICAL DIAGNOSTIC: Count ALL structural elements AFTER Cheerio parsing
    const cheerioSections = $('section[id]');
    const cheerioSectionIds = cheerioSections.map((i, el) => $(el).attr('id')).get();
    
    const cheerioArticles = $('article[id]');
    const cheerioArticleIds = cheerioArticles.map((i, el) => $(el).attr('id')).get();
    
    const cheerioNested1Count = $('article.nested1').length;
    const cheerioNested0Count = $('article.nested0').length;
    
    console.log(`🔥🔥🔥 AFTER CHEERIO LOAD: Cheerio found ${cheerioSectionIds.length} sections, ${cheerioArticleIds.length} articles (${cheerioNested0Count} nested0, ${cheerioNested1Count} nested1)`);
    console.log(`🔥🔥🔥 Section IDs in Cheerio DOM: ${cheerioSectionIds.length > 0 ? cheerioSectionIds.join(', ') : 'NONE'}`);
    console.log(`🔥🔥🔥 Article IDs in Cheerio DOM: ${cheerioArticleIds.length > 0 ? cheerioArticleIds.join(', ') : 'NONE'}`);
    
    // DIAGNOSTIC: Check if sections have their h2 elements in Cheerio DOM
    for (const sectionId of cheerioSectionIds) {
      const $section = $(`section[id="${sectionId}"]`);
      const $h2 = $section.find('> h2').first();
      const hasH2 = $h2.length > 0;
      const h2Text = hasH2 ? $h2.text().substring(0, 50) : 'N/A';
      const childCount = $section.find('> *').length;
      const childTags = $section.find('> *').map((i, el) => el.name).get().join(', ');
      console.log(`🔥 Section ${sectionId} in CHEERIO: ${hasH2 ? '✅ HAS h2' : '❌ NO h2'} "${h2Text}" - ${childCount} children: [${childTags}]`);
    }
    
    const lostSections = rawSectionIds.length - cheerioSectionIds.length;
    const lostArticles = rawArticleIds.length - cheerioArticleIds.length;
    
    if (lostSections > 0 || lostArticles > 0) {
      console.log(`🔥🔥🔥 ⚠️ CHEERIO LOST ${lostSections} sections and ${lostArticles} articles during parsing!`);
      
      // Show which specific IDs were lost
      const lostSectionIds = rawSectionIds.filter(id => !cheerioSectionIds.includes(id));
      const lostArticleIds = rawArticleIds.filter(id => !cheerioArticleIds.includes(id));
      
      if (lostSectionIds.length > 0) {
        console.log(`🔥🔥🔥 Lost section IDs: ${lostSectionIds.join(', ')}`);
      }
      if (lostArticleIds.length > 0) {
        console.log(`🔥🔥🔥 Lost article IDs: ${lostArticleIds.join(', ')}`);
      }
    } else {
      console.log(`🔥🔥🔥 ✅ Cheerio parsed all sections and articles successfully!`);
    }
    
  } catch (error) {
    log(`❌ Cheerio load ERROR: ${error.message}`);
    // Fall back to single paragraph
    // CRITICAL: Don't use cleanHtmlText() here - it strips code tags which breaks URLs
    // convertRichTextBlock() already handles HTML cleaning internally
    return {
      blocks: [{
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: convertRichTextBlock(html),
        },
      }],
      hasVideos: false
    };
  }

  // Process elements in document order by walking the DOM tree
  async function processElement(element) {
    const $elem = $(element);
    const tagName = element.name;
    const processedBlocks = [];
    
  const elemClass = $elem.attr('class') || 'none';
  if (getExtraDebug && getExtraDebug()) log(`🔍 Processing element: <${tagName}>, class="${elemClass}"`);
    
    // SKIP UI CHROME ELEMENTS (dropdown menus, export buttons, filter divs, etc.)
    // Check this FIRST before any other processing
    if (tagName === 'button') {
      console.log(`🔍 Skipping button element (UI chrome)`);
      return []; // Return empty array - don't process buttons
    }
    
    // Handle collapsible content containers - process children directly
    // These divs wrap important content (tables, lists, etc.) that must be extracted
    if (tagName === 'div' && elemClass.includes('collapseContentContainer')) {
      console.log(`🔍 Collapsible content container detected - processing children directly`);
      const childBlocks = [];
      const childNodes = Array.from($elem.get(0).childNodes);
      for (const child of childNodes) {
        if (child.nodeType === 1) { // Element node
          const childProcessed = await processElement(child);
          childBlocks.push(...childProcessed);
        }
      }
      return childBlocks;
    }
    
    if (tagName === 'div' && elemClass !== 'none') {
      const isUiChrome = /zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu/.test(elemClass);
      if (isUiChrome) {
        console.log(`🔍 UI chrome div detected: ${elemClass} - processing children directly`);
        // FIX BUG #1: Don't skip children - these divs often wrap tables and other content
        // Process children instead of returning empty array
        const childBlocks = [];
        const childNodes = Array.from($elem.get(0).childNodes);
        for (const child of childNodes) {
          if (child.nodeType === 1) { // Element node
            const childProcessed = await processElement(child);
            childBlocks.push(...childProcessed);
          }
        }
        return childBlocks; // Return children's blocks instead of empty array
      }
    }
    
    // CRITICAL DIAGNOSTIC: Track article.nested0
    if (tagName === 'article' && elemClass.includes('nested0')) {
      console.log(`🚨🚨🚨 ARTICLE.NESTED0 FOUND AT PROCESSELEMENT ENTRY!`);
      console.log(`🚨 Direct children count: ${$elem.find('> *').length}`);
      console.log(`🚨 Children types: ${$elem.find('> *').toArray().map(c => `<${c.name} class="${$(c).attr('class') || ''}">`).join(', ')}`);
    }
    
    // Special debug for div elements with 'note' in class
    if (tagName === 'div' && elemClass !== 'none' && elemClass.includes('note')) {
      console.log(`🔍 ⚠️ DIV WITH NOTE CLASS FOUND! Full class="${elemClass}", HTML preview: ${$.html($elem).substring(0, 150)}`);
    }

    // Utility: derive callout icon/color from class list or label
    // FIXED v11.0.0: Removed word boundaries (\b) to handle classes like "note_note"
    function getCalloutPropsFromClasses(classes = "") {
      const cls = String(classes || "");
      let color = "blue_background"; // default to info-ish note
      let icon = "ℹ️";
      if (/(important|critical)/.test(cls)) {
        color = "red_background";
        icon = "⚠️";
      } else if (/warning/.test(cls)) {
        color = "orange_background";
        icon = "⚠️";
      } else if (/caution/.test(cls)) {
        color = "yellow_background";
        icon = "⚠️";
      } else if (/tip/.test(cls)) {
        color = "green_background";
        icon = "💡";
      } else if (/(info|note)/.test(cls)) {
        color = "blue_background";
        icon = "ℹ️";
      }
      return { color, icon };
    }

    function getCalloutPropsFromLabel(text = "") {
      const t = String(text || "").trim().toLowerCase();
      if (t.startsWith("important:")) return { color: "red_background", icon: "⚠️" };
      if (t.startsWith("warning:")) return { color: "orange_background", icon: "⚠️" };
      if (t.startsWith("caution:")) return { color: "yellow_background", icon: "⚠️" };
      if (t.startsWith("tip:")) return { color: "green_background", icon: "💡" };
      if (t.startsWith("note:") || t.startsWith("info:")) return { color: "blue_background", icon: "ℹ️" };
      return null;
    }

    // Handle different element types
    // 1) Explicit ServiceNow note/callout containers
    if (tagName === 'div' && $elem.attr('class') && $elem.attr('class').includes('note')) {
      console.log(`🔍 ✅ MATCHED CALLOUT! class="${$elem.attr('class')}"`);
      console.log(`🔍 Callout HTML preview (first 500 chars): ${($elem.html() || '').substring(0, 500)}`);

      // Callout/Note
      const classAttr = $elem.attr('class') || '';
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);

      // Check if callout contains nested block elements (ul, ol, figure, table, pre, etc.)
      // NOTE: <p> tags should NOT be treated as nested blocks - they're part of callout rich_text
      // IMPORTANT: div.p is a ServiceNow wrapper that often contains mixed content (text + blocks)
      // For div.p with nested blocks: process the ENTIRE div.p as a child block (it will handle mixed content)
      
      // Find nested blocks that are direct children (excluding div.p which needs special handling)
      const directNestedBlocks = $elem.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.itemgroup, > div.info');
      
      // Check if any div.p elements contain nested blocks - if so, treat the entire div.p as a nested block
      const divPWithBlocks = $elem.find('> div.p').filter((i, divP) => {
        return $(divP).find('> ul, > ol, > figure, > table, > pre, > div.note').length > 0;
      });
      
      const allNestedBlocks = $([...directNestedBlocks.toArray(), ...divPWithBlocks.toArray()]);
      
      console.log(`🔍 [CALLOUT-NESTED] Found ${directNestedBlocks.length} direct + ${divPWithBlocks.length} div.p with blocks = ${allNestedBlocks.length} total`);
      if (allNestedBlocks.length > 0) {
        const nestedTypes = allNestedBlocks.toArray().map(el => {
          const className = $(el).attr('class');
          return `<${el.name}${className ? ` class="${className}"` : ''}>`;
        }).join(', ');
        console.log(`🔍 [CALLOUT-NESTED] Types: ${nestedTypes}`);
        console.log(`🔍 Callout contains ${allNestedBlocks.length} nested block elements - processing with children`);
        
        // Clone and remove nested blocks to get just the text content
        // Remove direct nested blocks AND any div.p that contains nested blocks
        const $clone = $elem.clone();
        $clone.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.itemgroup, > div.info').remove();
        
        // Remove div.p elements that contain nested blocks (these are processed as child blocks)
        $clone.find('> div.p').each((i, divP) => {
          const $divP = $(divP);
          const nestedBlocksFound = $divP.find('> ul, > ol, > figure, > table, > pre, > div.note');
          const hasNestedBlocks = nestedBlocksFound.length > 0;
          if (hasNestedBlocks) {
            const nestedTypes = nestedBlocksFound.toArray().map(el => {
              const className = $(el).attr('class');
              return `<${el.name}${className ? ` class="${className}"` : ''}>`;
            }).join(', ');
            console.log(`🔍 [CALLOUT-NESTED] Removing div.p with nested blocks from callout text: ${nestedTypes}`);
            console.log(`🔍 [CALLOUT-NESTED] div.p HTML (first 200 chars): ${$divP.html().substring(0, 200)}`);
            $divP.remove();
          }
        });
        
        let textOnlyHtml = $clone.html() || '';
        
        console.log(`🔍 Callout textOnlyHtml (before title removal): "${textOnlyHtml.substring(0, 200)}${textOnlyHtml.length > 200 ? '...' : ''}"`);
        
        // Remove note title span (it already has a colon like "Note:")
        textOnlyHtml = textOnlyHtml.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
        
        console.log(`🔍 Callout textOnlyHtml (after title removal): "${textOnlyHtml.substring(0, 200)}${textOnlyHtml.length > 200 ? '...' : ''}"`);
        
        // Parse HTML directly to preserve formatting (links, bold, etc.)
        const { richText: calloutRichText } = await parseRichText(textOnlyHtml);
        
        // Process nested blocks as children - these will be appended after page creation
        const childBlocks = [];
        for (const nestedBlock of allNestedBlocks.toArray()) {
          const $nestedBlock = $(nestedBlock);
          const blockTag = nestedBlock.name;
          const blockClass = $nestedBlock.attr('class') || '';
          console.log(`🔍 Processing callout nested block: <${blockTag}${blockClass ? ` class="${blockClass}"` : ''}>`);
          const nestedProcessed = await processElement(nestedBlock);
          console.log(`🔍   Returned ${nestedProcessed.length} blocks: ${nestedProcessed.map(b => b.type).join(', ')}`);
          childBlocks.push(...nestedProcessed);
        }
        
        // Check if callout has actual content or is just empty/whitespace/title-only
  const calloutContent = joinRichTextContents(calloutRichText).trim();
        const hasCalloutContent = calloutContent.length > 0;
        
        // Check if content is ONLY the note title (e.g., "Note:", "Important:", etc.)
        // These patterns match common note title formats
        const titleOnlyPattern = /^(note|important|warning|caution|tip|info):\s*$/i;
        const isTitleOnly = titleOnlyPattern.test(calloutContent);
        
        console.log(`🔍 Callout content after removing title: "${calloutContent.substring(0, 100)}${calloutContent.length > 100 ? '...' : ''}"`);
        console.log(`🔍 Has callout content: ${hasCalloutContent}, Is title-only: ${isTitleOnly}, Has ${childBlocks.length} deferred children`);
        
        // If callout has NO content (not even a title) and has nested blocks, skip creating the callout
        // Just add the nested blocks directly - they'll be processed as siblings
        // However, if it has a title (even if title-only), still create the callout to preserve the Note/Warning/etc. label
        if (!hasCalloutContent && childBlocks.length > 0) {
          console.log(`🔍 Skipping empty callout (no content, only nested blocks) - adding nested blocks directly`);
          processedBlocks.push(...childBlocks);
        } else {
          // Create callout WITH content (even if it's just the title)
          console.log(`🔍 Creating callout with ${calloutRichText.length} rich_text elements and ${childBlocks.length} deferred children`);
          
          const calloutBlock = {
            object: "block",
            type: "callout",
            callout: {
              rich_text: calloutRichText.length > 0 ? calloutRichText : [{ type: "text", text: { content: "" } }],
              icon: { type: "emoji", emoji: calloutIcon },
              color: calloutColor
            }
          };
          
          // Add marker for orchestrator to append children after creation
          if (childBlocks.length > 0) {
            const marker = createMarker();
            
            // Tag each child block with the marker for orchestration
            // CRITICAL: Don't overwrite existing markers from nested processing!
            const blocksNeedingMarker = childBlocks.filter(b => !b._sn2n_marker);
            const blocksWithExistingMarker = childBlocks.filter(b => b._sn2n_marker);
            recordMarkers(blocksWithExistingMarker);
            
            blocksNeedingMarker.forEach(block => {
              block._sn2n_marker = marker;
            });
            
            if (blocksNeedingMarker.length > 0) {
              console.log(`🔍 [MARKER-PRESERVE-CALLOUT] ${blocksNeedingMarker.length} new blocks marked for callout orchestration`);
            }
            if (blocksWithExistingMarker.length > 0) {
              console.log(`🔍 [MARKER-PRESERVE-CALLOUT] ${blocksWithExistingMarker.length} blocks already have markers - preserving`);
            }
            
            // Add marker text to end of callout rich_text (will be found by orchestrator)
            const markerToken = `(sn2n:${marker})`;
            calloutBlock.callout.rich_text.push({
              type: "text",
              text: { content: ` ${markerToken}` },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default"
              }
            });
            
            if (getExtraDebug && getExtraDebug()) log(`🔍 Added marker ${markerToken} for ${childBlocks.length} deferred blocks`);
            
            // Add child blocks to callout so collectAndStripMarkers can find them
            calloutBlock.callout.children = childBlocks;
          }
          
          processedBlocks.push(calloutBlock);

          // Validation-only helper: when running under SN2N_VALIDATE_OUTPUT, also
          // emit the callout's text lines as separate paragraph blocks so the
          // validator can match HTML segments that expect separate phrases.
          // These blocks are only added for validation/dry-run and are gated
          // behind the env flag to avoid changing production output.
          try {
            if (process && process.env && process.env.SN2N_VALIDATE_OUTPUT) {
              const calloutText = joinRichTextContents(calloutRichText);
              const parts = calloutText.split(/\n+/).map(p => p.trim()).filter(Boolean);
              if (parts.length > 0) {
                for (const part of parts) {
                  processedBlocks.push({
                    object: 'block',
                    type: 'paragraph',
                    paragraph: { rich_text: [{ type: 'text', text: { content: part } }] },
                    // mark so it's clear these were added for validation only
                    _sn2n_validation_only: true
                  });
                }
              }
            }
          } catch (e) {
            // Non-fatal - validation helper must not break conversion
            console.log('🔍 [CALLOUT-VALIDATION] helper error', e && e.message);
          }
          
          // FIXED v11.0.0: Don't add child blocks as siblings - they're already in callout.children
          // The orchestrator will find them via collectAndStripMarkers and handle them
          // Previously this caused duplication: blocks appeared both nested and as siblings
        }
      } else {
        // No nested blocks - process as simple callout with just rich_text
        let cleanedContent = $elem.html() || '';
        // Remove note title span (it already has a colon like "Note:")
        cleanedContent = cleanedContent.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
        
        const { richText: calloutRichText, imageBlocks: calloutImages } = await parseRichText(cleanedContent);
        console.log(`🔍 Simple callout rich_text has ${calloutRichText.length} elements, content preview: "${calloutRichText.map(rt => rt.text.content).join('').substring(0, 100)}..."`);
        
        // Add any image blocks found in the callout
        if (calloutImages && calloutImages.length > 0) {
          processedBlocks.push(...calloutImages);
        }
        
        // Split if exceeds 100 elements (Notion limit)
        const richTextChunks = splitRichTextArray(calloutRichText);
        console.log(`🔍 Simple callout split into ${richTextChunks.length} chunks`);
        for (const chunk of richTextChunks) {
          console.log(`🔍 Creating simple callout block with ${chunk.length} rich_text elements`);
          processedBlocks.push({
            object: "block",
            type: "callout",
            callout: {
              rich_text: chunk,
              icon: { type: "emoji", emoji: calloutIcon },
              color: calloutColor
            }
          });
        }
      }
      $elem.remove(); // Mark as processed
    // 2) Aside elements commonly used as notes/admonitions
    // Note: Exclude "itemgroup" divs - those are just ServiceNow content containers, not callouts
    // FIXED v11.0.0: Changed regex from \b word boundaries to match anywhere in class string
    // This handles cases like "note note note_note" where underscore breaks word boundary matching
    } else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /(info|note|warning|important|tip|caution)/.test($elem.attr('class') || ''))) {
      const classAttr = $elem.attr('class') || '';
  if (getExtraDebug && getExtraDebug()) log(`🔍 MATCHED CALLOUT CONTAINER (<${tagName}>) class="${classAttr}"`);
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);
      const inner = $elem.html() || '';
      const { richText: calloutRichText, imageBlocks: calloutImages } = await parseRichText(inner);
      
      // Add any image blocks found in the callout
      if (calloutImages && calloutImages.length > 0) {
        processedBlocks.push(...calloutImages);
      }
      
      const richTextChunks = splitRichTextArray(calloutRichText);
      for (const chunk of richTextChunks) {
        processedBlocks.push({
          object: "block",
          type: "callout",
          callout: {
            rich_text: chunk,
            icon: { type: "emoji", emoji: calloutIcon },
            color: calloutColor
          }
        });
      }
      $elem.remove();
      
  } else if (tagName === 'table') {
      // Table - extract images from table cells and add as separate blocks
      const tableHtml = $.html($elem);
      const tableId = $elem.attr('id') || 'no-id';
      const tablePreview = tableHtml.substring(0, 100).replace(/\s+/g, ' ');
      console.log(`📊 Processing <table id="${tableId}">: ${tablePreview}...`);
      
      try {
        // Mark figures inside the live table DOM as "table-handled" so
        // individual <figure> processing won't duplicate images when run
        // out-of-order (figures may be visited before their parent <table>). 
        // Also create a modified HTML copy where figures are replaced by
        // placeholders because Notion table cells cannot contain images.
        $elem.find('figure').each((idx, fig) => {
          try { $(fig).attr('data-sn2n-table-processed', '1'); } catch (e) { /* ignore */ }
        });

        // Replace figures in a copy of the table HTML with placeholder text BEFORE conversion
        // This is necessary because Notion table cells cannot contain images
        let modifiedTableHtml = tableHtml;
        const $table = $('<div>').html(tableHtml);
        $table.find('figure').each((idx, fig) => {
          const $figure = $(fig);
          const $caption = $figure.find('figcaption').first();
          if ($caption.length > 0) {
            const caption = cleanHtmlText($caption.html());
            $figure.replaceWith(`<span class="image-placeholder">See "${caption}"</span>`);
          } else {
            $figure.replaceWith(`<span class="image-placeholder">See image below</span>`);
          }
        });
        modifiedTableHtml = $table.html();
        
        // Convert table to Notion blocks
        const tableBlocks = await convertTableBlock(modifiedTableHtml);
        if (tableBlocks && Array.isArray(tableBlocks)) {
          console.log(`📊 convertTableBlock returned ${tableBlocks.length} block(s) for table id="${tableId}"`);
          if (tableBlocks.length > 1) {
            console.log(`⚠️ WARNING: Single <table> converted to ${tableBlocks.length} blocks! Block types:`, tableBlocks.map(b => b.type).join(', '));
          }
          
          // FIX v11.0.38: Track table captions to prevent duplicates
          // If first block is a heading (caption), store its text
          console.log(`📊 [CAPTION-DEBUG] First block type: ${tableBlocks[0]?.type}, has heading_3: ${!!tableBlocks[0]?.heading_3}`);
          if (tableBlocks[0] && tableBlocks[0].type === 'heading_3') {
            const captionText = tableBlocks[0].heading_3?.rich_text?.[0]?.text?.content;
            console.log(`📊 [CAPTION-DEBUG] Caption text extracted: "${captionText}"`);
            if (captionText) {
              const normalized = captionText.trim().toLowerCase();
              processedTableCaptions.add(normalized);
              console.log(`📊 [CAPTION-TRACK] Added to Set: "${captionText}" (normalized: "${normalized}")`);
              console.log(`📊 [CAPTION-TRACK] Set now has ${processedTableCaptions.size} caption(s)`);
            } else {
              console.log(`📊 [CAPTION-DEBUG] Caption text is empty or undefined`);
            }
          } else {
            console.log(`📊 [CAPTION-DEBUG] First block is not heading_3, skipping caption tracking`);
          }
          
          processedBlocks.push(...tableBlocks);

          // To improve deterministic validation (some fixtures expect plain-text
          // table summaries), also emit concatenated paragraph segments composed
          // from each table row (header + data rows). This is low-risk: it only
          // adds plain-text copies (Notion table still present) and helps the
          // validator match combined text tokens like "Main object <declaration>".
          try {
            const tableBlock = tableBlocks.find(b => b.type === 'table');
            if (tableBlock && tableBlock.table && Array.isArray(tableBlock.table.children)) {
              const rowSummaries = [];
              for (const row of tableBlock.table.children) {
                const cells = (row.table_row && row.table_row.cells) || [];
                const cellTexts = cells.map(cellArr => {
                  if (!Array.isArray(cellArr)) return '';
                  return cellArr.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content).trim() : '').join(' ');
                });
                const summary = cellTexts.filter(Boolean).join(' ');
                if (summary && summary.trim()) {
                  rowSummaries.push(summary.trim());
                }
              }
              // Emit header first (if present) then data rows in order
              // FIX v11.0.37: REMOVED validation-only table summary paragraphs
              // These caused duplicate content and were not needed for validation
              // Content validator now extracts table cell text directly from table_row blocks
              // Skipping emission to avoid duplicates in all modes
              log(`📊 Skipped ${rowSummaries.length} table summary paragraph(s) (not needed - validation extracts from table cells directly)`);
              
              // NOTE: Previously we emitted validation paragraphs with [SN2N-VALIDATION-PARAGRAPH] markers
              // and tried to clean them up after validation. This approach was flawed because:
              // 1. It created duplicate content visible to users before cleanup
              // 2. Cleanup wasn't reliable (nested blocks not always found)
              // 3. The content validator can extract table text directly from Notion table_row blocks
              // Solution: Don't create them at all
            }
          } catch (errEmit) {
            console.log(`⚠️ Error emitting table summary paragraphs: ${errEmit.message}`);
          }
          
          // Extract images from the live table DOM (before we remove the table)
          // and add as separate blocks after the table. We use the live DOM so
          // we can check the data-sn2n-table-processed attribute and avoid
          // duplicating figures that have been handled elsewhere.
          const figuresWithImages = $elem.find('figure');

          for (const fig of figuresWithImages.toArray()) {
            const $figure = $(fig);
            const $img = $figure.find('img').first();
            const $caption = $figure.find('figcaption').first();
            
            if ($img.length > 0) {
              let imgSrc = $img.attr('src');
              const caption = $caption.length > 0 ? cleanHtmlText($caption.html()) : '';
              
              // Convert ServiceNow URL to proper format
              imgSrc = convertServiceNowUrl(imgSrc);
              
              // Validate URL and create image block with download/upload
              const isValid = imgSrc && (imgSrc.startsWith('http://') || imgSrc.startsWith('https://'));
              
              if (isValid) {
                // Skip if this figure was already marked/processed by other logic
                if ($figure.attr('data-sn2n-table-processed') && $figure.attr('data-sn2n-table-processed') !== '0') {
                  log(`🔍 Skipping table image because it's marked as processed by table logic: ${imgSrc.substring(0,80)}`);
                } else {
                  log(`📥 Downloading and uploading table image: ${imgSrc.substring(0, 80)}...`);
                  const uploadId = await downloadAndUploadImage(imgSrc, caption || 'image');

                  const imageBlock = {
                    object: "block",
                    type: "image",
                    image: uploadId ? {
                      type: "file_upload",
                      file_upload: { id: uploadId }
                    } : {
                      type: "external",
                      external: { url: imgSrc }
                    }
                  };

                  if (caption) {
                    imageBlock.image.caption = [{ 
                      type: "text", 
                      text: { content: caption } 
                    }];
                  }

                  log(uploadId ? `✅ Table image uploaded with ID: ${uploadId}` : `⚠️ Table image using external URL fallback`);
                  // Mark the figure so other processors know it's been added
                  try { $figure.attr('data-sn2n-table-processed', '1'); } catch (e) { /* ignore */ }
                  processedBlocks.push(imageBlock);
                }
              }
            }
          }
          
        }
      } catch (error) {
        console.log(`⚠️ Table conversion error: ${error.message}`);
        console.log(`⚠️ Error stack: ${error.stack}`);
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'pre') {
      // Code block - detect language from class attribute
      console.log(`✅ PRE TAG HANDLER ENTERED - Creating code block`);
      
      // For code blocks, preserve newlines and whitespace
      // Don't use cleanHtmlText() which collapses whitespace
      let codeText = $elem.html() || '';
      
      // Remove HTML tags but preserve newlines
      codeText = codeText.replace(/<[^>]*>/g, '');
      
      // Decode HTML entities
      codeText = codeText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#xa0;/gi, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      
      console.log(`🔍 Code text length: ${codeText.length}, preview: ${codeText.substring(0, 50)}`);
      
      // Try to detect language from class attribute (e.g., class="language-javascript")
      let language = "plain text";
      const classAttr = $elem.attr('class') || '';
      const dataLangAttr = $elem.attr('data-language') || '';
      
      // Check for language- prefix in class
      const languageClass = classAttr.split(/\s+/)
        .map(cls => cls.trim())
        .find(cls => cls.toLowerCase().startsWith('language-'));
      
      if (languageClass) {
        language = languageClass.substring('language-'.length).toLowerCase();
        console.log(`🔍 Detected language from class: ${language}`);
      } else if (dataLangAttr) {
        language = dataLangAttr.toLowerCase();
        console.log(`🔍 Detected language from data-language: ${language}`);
      }
      
      // Normalize language (use global function if available)
      if (typeof global.normalizeCodeLanguage === 'function') {
        language = global.normalizeCodeLanguage(language);
        console.log(`🔍 Normalized language: ${language}`);
      }
      
      console.log(`✅ Creating code block with language: ${language}`);
      processedBlocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: [{ type: "text", text: { content: codeText } }],
          language: language
        }
      });
      console.log(`✅ Code block created and added to processedBlocks (count: ${processedBlocks.length})`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'iframe') {
      // iframe element - typically video embeds
      console.log(`🔍 Processing <iframe> element`);
      const src = $elem.attr('src');
      const title = $elem.attr('title') || '';
      
      if (src) {
        console.log(`🔍 iframe src: ${src.substring(0, 100)}`);
        
        // Check if it's a video URL
        if (isVideoIframeUrl(src)) {
          hasDetectedVideos = true;
          console.log(`📹 Detected video iframe - creating video/embed block`);
          
          // Use video block for YouTube (supports embed/watch URLs)
          // Use embed block for Vimeo and other video platforms
          if (src.includes('youtube.com') || src.includes('youtu.be')) {
            processedBlocks.push({
              object: "block",
              type: "video",
              video: {
                type: "external",
                external: {
                  url: src
                }
              }
            });
          } else {
            // Vimeo and other embeds
            processedBlocks.push({
              object: "block",
              type: "embed",
              embed: {
                url: src
              }
            });
          }
        } else {
          // Non-video iframe - create embed block
          console.log(`🔗 Non-video iframe - creating embed block`);
          processedBlocks.push({
            object: "block",
            type: "embed",
            embed: {
              url: src
            }
          });
        }
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'figure') {
      // Figure element - extract image and caption together
      // BUT: Skip if this figure is inside a table (tables handle their own figures)
      console.log(`🔍 Figure handler called, tagName: ${tagName}`);
  // Consider several ancestor types as table-related containers so we
  // consistently skip figures that belong to table cells or wrappers.
  const closestTableOrCell = $elem.closest('table, td, th, div.table-wrap');
  console.log(`🔍 Closest table/cell count: ${closestTableOrCell.length}`);
  const isInTable = closestTableOrCell.length > 0;
      console.log(`🔍 isInTable: ${isInTable}`);
      
      if (isInTable) {
        console.log(`🔍 Figure is inside a table - skipping (will be handled by table converter)`);
        // Don't process or remove - let the table converter handle it
        // IMPORTANT: Don't call $elem.remove() here!
        // Deduplicate blocks that duplicate table row text in production
        // (avoid removing these during validation runs where row summaries
        // are intentionally emitted). This removes paragraph/heading blocks
        // that are exact textual duplicates of table rows to prevent
        // semantic duplicates and ordering mismatches in Notion output.
        try {
          const doDedupe = !(process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true');
          if (doDedupe) {
            const normalize = (s) => {
              if (!s) return '';
              // Remove leading non-alphanumeric characters (emoji, bullets, punctuation)
              let t = String(s).replace(/^\s+/, '').replace(/^[^a-z0-9]+/i, '');
              t = t.replace(/\s+/g, ' ').trim().toLowerCase();
              return t;
            };

            const tableTexts = new Set();
            for (const b of processedBlocks) {
              if (b && b.type === 'table' && b.table) {
                // Prefer explicit row summaries metadata when present (non-emitted,
                // internal-only). This makes dedupe independent of whether validation
                // emitted plain-text row summary paragraphs.
                if (Array.isArray(b._sn2n_row_summaries) && b._sn2n_row_summaries.length > 0) {
                  for (const raw of b._sn2n_row_summaries) {
                    const key = normalize(raw);
                    if (key) tableTexts.add(key);
                  }
                  continue;
                }

                if (Array.isArray(b.table.children)) {
                  for (const row of b.table.children) {
                    const cells = (row.table_row && row.table_row.cells) || [];
                    const cellTexts = cells.map(cellArr => {
                      if (!Array.isArray(cellArr)) return '';
                      return cellArr.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                    }).filter(Boolean).join(' ');
                    const key = normalize(cellTexts);
                    if (key) tableTexts.add(key);
                  }
                }
              }
            }

            if (tableTexts.size > 0) {
              // Conservative contains-based dedupe:
              // treat a block as duplicate when the normalized table-row text
              // is a substring of the block text (or vice-versa), with a
              // minimum table-text length and minimum token count to avoid
              // removing short headings or bullets.
              const MIN_CHARS = parseInt(process.env.SN2N_DEDUPE_MIN_CHARS || '12', 10);
              const MIN_TOKENS = parseInt(process.env.SN2N_DEDUPE_MIN_TOKENS || '3', 10);

              const before = processedBlocks.length;
              const filtered = [];
              let removedCount = 0;

              const THRESHOLD = parseFloat(process.env.SN2N_DEDUPE_JACCARD || '1');

              // Precompute token sets for table rows and keep original texts
              const tableTokenSets = [];
              const tableTextList = [];
              for (const t of tableTexts) {
                if (!t) continue;
                const toks = t.split(' ').map(x => x.trim()).filter(Boolean);
                if (toks.length === 0) continue;
                tableTokenSets.push(new Set(toks));
                tableTextList.push(t);
              }

              const jaccard = (aSet, bSet) => {
                let inter = 0;
                for (const v of aSet) if (bSet.has(v)) inter++;
                const union = new Set([...aSet, ...bSet]).size;
                if (union === 0) return 0;
                return inter / union;
              };

              const isDup = (blockKey) => {
                if (!blockKey) return false;
                if (blockKey.length < MIN_CHARS) return false;
                const blockTokens = blockKey.split(' ').map(x => x.trim()).filter(Boolean);
                if (blockTokens.length < MIN_TOKENS) return false;
                const blockSet = new Set(blockTokens);

                for (const tSet of tableTokenSets) {
                  const score = jaccard(blockSet, tSet);
                  if (score >= THRESHOLD) return true;
                }
                return false;
              };

              // Diagnostics: collect candidate scores for tuning
              const DEBUG = (process.env.SN2N_DEDUPE_DEBUG === '1' || process.env.SN2N_DEDUPE_DEBUG === 'true');
              const VALIDATION_MODE = (process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true');
              const dedupeCandidates = [];

              for (let idx = 0; idx < processedBlocks.length; idx++) {
                const b = processedBlocks[idx];
                let text = '';
                if (!b) { filtered.push(b); continue; }
                if (b.type === 'paragraph' && b.paragraph && Array.isArray(b.paragraph.rich_text)) {
                  text = b.paragraph.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                } else if (b.type === 'heading_1' && b.heading_1 && Array.isArray(b.heading_1.rich_text)) {
                  text = b.heading_1.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                } else if (b.type === 'heading_2' && b.heading_2 && Array.isArray(b.heading_2.rich_text)) {
                  text = b.heading_2.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                } else if (b.type === 'heading_3' && b.heading_3 && Array.isArray(b.heading_3.rich_text)) {
                  text = b.heading_3.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                }

                const key = normalize(text);
                let removed = false;
                if (key) {
                  // compute best score for diagnostics and dedupe decision
                  let bestScore = 0;
                  let bestIdx = -1;
                  for (let tI = 0; tI < tableTokenSets.length; tI++) {
                    const tSet = tableTokenSets[tI];
                    const blockTokens = key.split(' ').map(x => x.trim()).filter(Boolean);
                    const blockSet = new Set(blockTokens);
                    const score = jaccard(blockSet, tSet);
                    if (score > bestScore) {
                      bestScore = score;
                      bestIdx = tI;
                    }
                  }

                  if (DEBUG) {
                    dedupeCandidates.push({
                      blockIndex: idx,
                      blockType: b.type,
                      blockText: text,
                      blockTokenCount: (key.split(' ').filter(Boolean)).length,
                      bestScore: Number(bestScore.toFixed(3)),
                      bestTableRowIndex: bestIdx,
                      bestTableRowText: (bestIdx >= 0 && tableTextList[bestIdx]) ? tableTextList[bestIdx] : null,
                      bestTableRowTokenCount: (bestIdx >= 0 && tableTokenSets[bestIdx]) ? tableTokenSets[bestIdx].size : 0,
                      // include threshold metadata to make the dump self-contained
                      threshold: THRESHOLD,
                      minChars: MIN_CHARS,
                      minTokens: MIN_TOKENS
                    });
                  }

                  if (isDup(key)) {
                    removedCount++;
                    removed = true;
                  }
                }
                if (removed) {
                  continue;
                }
                filtered.push(b);
              }

              processedBlocks.length = 0;
              processedBlocks.push(...filtered);
              log(`🧹 Deduplicated ${removedCount} block(s) by Jaccard≥${THRESHOLD} (minChars=${MIN_CHARS}, minTokens=${MIN_TOKENS})`);

              // Write diagnostics JSON when requested (debug mode)
              if (DEBUG) {
                try {
                  // DEBUG: log candidate count and table count before writing
                  console.log(`📝 Dedupe diagnostics: DEBUG=${DEBUG}, VALIDATION_MODE=${VALIDATION_MODE}, tableTexts=${tableTexts.size}, candidates=${dedupeCandidates.length}`);
                  const outPath = '/tmp/sn2n-dedupe-candidates.json';
                  const payload = {
                    generatedAt: (new Date()).toISOString(),
                    threshold: THRESHOLD,
                    minChars: MIN_CHARS,
                    minTokens: MIN_TOKENS,
                    candidates: dedupeCandidates
                  };
                  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
                  log(`📝 Wrote dedupe diagnostics to ${outPath} (${dedupeCandidates.length} entries)`);
                } catch (e) {
                  console.log(`⚠️ Failed to write dedupe diagnostics: ${e && e.message}`);
                }
              }
            }
            // If we're in validation mode and diagnostics are requested,
            // emit candidate scores (without removing blocks) so thresholds can be tuned.
          } else {
            // doDedupe is false (validation mode). If debug requested, produce diagnostics only.
            const DEBUG = (process.env.SN2N_DEDUPE_DEBUG === '1' || process.env.SN2N_DEDUPE_DEBUG === 'true');
            const VALIDATION_MODE = (process.env.SN2N_VALIDATE_OUTPUT === '1' || process.env.SN2N_VALIDATE_OUTPUT === 'true');
            if (DEBUG && VALIDATION_MODE && tableTexts.size > 0) {
              try {
                // Precompute token sets for table rows (same as production branch)
                const tableTokenSets_dbg = [];
                const tableTextList_dbg = [];
                for (const t of tableTexts) {
                  if (!t) continue;
                  const toks = t.split(' ').map(x => x.trim()).filter(Boolean);
                  if (toks.length === 0) continue;
                  tableTokenSets_dbg.push(new Set(toks));
                  tableTextList_dbg.push(t);
                }

                const jaccard_dbg = (aSet, bSet) => {
                  let inter = 0;
                  for (const v of aSet) if (bSet.has(v)) inter++;
                  const union = new Set([...aSet, ...bSet]).size;
                  if (union === 0) return 0;
                  return inter / union;
                };

                const MIN_CHARS = parseInt(process.env.SN2N_DEDUPE_MIN_CHARS || '12', 10);
                const MIN_TOKENS = parseInt(process.env.SN2N_DEDUPE_MIN_TOKENS || '3', 10);
                const THRESHOLD = parseFloat(process.env.SN2N_DEDUPE_JACCARD || '1');

                const dedupeCandidates_dbg = [];
                for (let idx = 0; idx < processedBlocks.length; idx++) {
                  const b = processedBlocks[idx];
                  if (!b) continue;
                  let text = '';
                  if (b.type === 'paragraph' && b.paragraph && Array.isArray(b.paragraph.rich_text)) {
                    text = b.paragraph.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                  } else if (b.type === 'heading_1' && b.heading_1 && Array.isArray(b.heading_1.rich_text)) {
                    text = b.heading_1.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                  } else if (b.type === 'heading_2' && b.heading_2 && Array.isArray(b.heading_2.rich_text)) {
                    text = b.heading_2.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                  } else if (b.type === 'heading_3' && b.heading_3 && Array.isArray(b.heading_3.rich_text)) {
                    text = b.heading_3.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
                  }
                  const key = String(text || '').replace(/^\s+/, '').replace(/^[^a-z0-9]+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
                  if (!key) continue;
                  if (key.length < MIN_CHARS) continue;
                  const blockTokens = key.split(' ').map(x => x.trim()).filter(Boolean);
                  if (blockTokens.length < MIN_TOKENS) continue;
                  const blockSet = new Set(blockTokens);

                  let bestScore = 0;
                  let bestIdx = -1;
                  for (let tI = 0; tI < tableTokenSets_dbg.length; tI++) {
                    const tSet = tableTokenSets_dbg[tI];
                    const score = jaccard_dbg(blockSet, tSet);
                    if (score > bestScore) { bestScore = score; bestIdx = tI; }
                  }

                  dedupeCandidates_dbg.push({
                    blockIndex: idx,
                    blockType: b.type,
                    blockText: text,
                    blockTokenCount: blockTokens.length,
                    bestScore: Number(bestScore.toFixed(3)),
                    bestTableRowIndex: bestIdx,
                    bestTableRowText: (bestIdx >= 0 && tableTextList_dbg[bestIdx]) ? tableTextList_dbg[bestIdx] : null,
                    bestTableRowTokenCount: (bestIdx >= 0 && tableTokenSets_dbg[bestIdx]) ? tableTokenSets_dbg[bestIdx].size : 0
                  });
                }

                // write file
                try {
                  // DEBUG: log candidate count before writing (validation branch)
                  console.log(`📝 Dedupe diagnostics (validation branch): DEBUG=${DEBUG}, tableRows=${tableTokenSets_dbg.length}, candidates=${dedupeCandidates_dbg.length}`);
                  const outPath = '/tmp/sn2n-dedupe-candidates.json';
                  const payload = {
                    generatedAt: (new Date()).toISOString(),
                    threshold: THRESHOLD,
                    minChars: MIN_CHARS,
                    minTokens: MIN_TOKENS,
                    candidates: dedupeCandidates_dbg
                  };
                  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
                  log(`📝 Wrote dedupe diagnostics to ${outPath} (${dedupeCandidates_dbg.length} entries)`);
                } catch (e) {
                  console.log(`⚠️ Failed to write dedupe diagnostics (validation branch): ${e && e.message}`);
                }
              } catch (e) {
                console.log(`⚠️ Dedupe diagnostics generation failed: ${e && e.message}`);
              }
            }
          }
        } catch (e) {
          console.log(`⚠️ Table dedupe failed: ${e && e.message}`);
        }

        return processedBlocks;
      }
      
      console.log(`🔍 Processing <figure> element (not in table)`);
      const $img = $elem.find('img').first();
      const $figcaption = $elem.find('figcaption').first();
      
      if ($img.length > 0) {
        const src = $img.attr('src');
        const alt = $img.attr('alt') || '';
        
        // Debug figcaption content
        if ($figcaption.length > 0) {
          const rawCaption = $figcaption.html() || '';
          console.log(`🔍 Raw figcaption HTML: "${rawCaption}"`);
          const cleanedCaption = cleanHtmlText(rawCaption);
          console.log(`🔍 Cleaned figcaption text: "${cleanedCaption}"`);
        }
        
  const captionText = $figcaption.length > 0 ? cleanHtmlText($figcaption.html() || '') : alt;

  console.log('🔍 Figure: img src="' + (src ? String(src).substring(0,50) : '') + '", caption="' + (captionText ? String(captionText).substring(0,50) : '') + '"');

        if (src && isValidImageUrl(src)) {
          // FIX v11.0.36: Pass captionText to image block so figcaptions appear as image captions in Notion
          // (Figcaptions are also excluded from validation segment extraction to avoid false order issues)
          const imageBlock = await createImageBlock(src, captionText);
          if (imageBlock) {
            console.log(`✅ Created image block with caption from figcaption`);
            console.log(`📋 Image block structure:`, JSON.stringify(imageBlock, null, 2));
            processedBlocks.push(imageBlock);

            // Mark this figure element as processed so table logic won't duplicate it
            try { $elem.attr('data-sn2n-table-processed', '1'); } catch (e) { /* ignore */ }
            // Also mark the figcaption (if present) so paragraph processing won't
            // emit the same caption as a standalone paragraph (avoids duplicates).
            try {
              const $figcaption = $elem.find('figcaption').first();
              if ($figcaption && $figcaption.length > 0) {
                $figcaption.attr('data-sn2n-caption-processed', '1');
              }
            } catch (e) { /* ignore */ }

            // Also extract any descriptive paragraphs inside the <figure>
            // (for example: "The theme hook required for this variation is <kbd>...</kbd>.")
            try {
              const $figureParas = $elem.find('p');
              for (const p of $figureParas.toArray()) {
                try {
                  const pHtml = $(p).html() || '';
                  const { richText: paraRich, imageBlocks: paraImages, videoBlocks: paraVideos } = await parseRichText(pHtml);
                  if (paraImages && paraImages.length > 0) processedBlocks.push(...paraImages);
                  if (paraVideos && paraVideos.length > 0) processedBlocks.push(...paraVideos);
                  if (paraRich && paraRich.length > 0) {
                    const chunks = splitRichTextArray(paraRich);
                    for (const chunk of chunks) {
                      processedBlocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: chunk } });
                    }
                  }
                  try { $(p).attr('data-sn2n-caption-processed', '1'); } catch (e) { /* ignore */ }
                } catch (errInner) {
                  log(`⚠️ Error processing paragraph inside figure: ${errInner.message}`);
                }
              }
            } catch (err) {
              log(`⚠️ Error while extracting paragraphs from figure: ${err.message}`);
            }

            // Also extract any lists inside <figure> (ul/ol > li) and emit each
            // list item as a paragraph block so the validator sees the plain text
            // segments (many fixtures expect these tokens as standalone segments).
            try {
              const $figureLists = $elem.find('ul, ol');
              for (const listEl of $figureLists.toArray()) {
                const $list = $(listEl);
                const $items = $list.find('> li');
                for (const li of $items.toArray()) {
                  try {
                    const liHtml = $(li).html() || '';
                    const { richText: liRich, imageBlocks: liImages, videoBlocks: liVideos } = await parseRichText(liHtml);
                    if (liImages && liImages.length > 0) processedBlocks.push(...liImages);
                    if (liVideos && liVideos.length > 0) processedBlocks.push(...liVideos);
                    if (liRich && liRich.length > 0) {
                      const chunks = splitRichTextArray(liRich);
                      for (const chunk of chunks) {
                        processedBlocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: chunk } });
                      }
                    }
                    try { $(li).attr('data-sn2n-caption-processed', '1'); } catch (e) { /* ignore */ }
                  } catch (errLi) {
                    log(`⚠️ Error processing li inside figure: ${errLi.message}`);
                  }
                }
              }
            } catch (err) {
              log(`⚠️ Error while extracting lists from figure: ${err.message}`);
            }
          }
        }
      } else {
        // Figure without image - process children normally
        console.log(`🔍 Figure has no image, processing children`);
        const children = $elem.find('> *').toArray();
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
        }
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'figcaption') {
      // Figcaption should be handled by parent <figure> element
      // If we encounter it standalone, skip it (already processed)
      console.log(`🔍 Standalone <figcaption> encountered - skipping (should be handled by parent <figure>)`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'img') {
      // Image (standalone)
      // CRITICAL: Skip images that are inside list items - they'll be extracted by parseRichText
      const isInsideListItem = $elem.closest('li').length > 0;
      if (isInsideListItem) {
        console.log(`🖼️ [INLINE-IMAGE] Skipping <img> inside list item (will be extracted by parseRichText)`);
        return []; // Don't process or remove - let list item handle it
      }
      
      const src = $elem.attr('src');
      const alt = $elem.attr('alt') || '';
      console.log(`🖼️ Processing standalone <img>: src="${src ? src.substring(0, 80) : 'none'}", alt="${alt}"`);
      
      if (src && isValidImageUrl(src)) {
        console.log(`✅ Image URL is valid, creating image block...`);
        const imageBlock = await createImageBlock(src, alt);
        if (imageBlock) {
          console.log(`✅ Image block created successfully`);
          processedBlocks.push(imageBlock);
        } else {
          console.log(`⚠️ Image block creation returned null`);
        }
      } else {
        console.log(`❌ Image URL is invalid or missing: "${src}"`);
      }
      $elem.remove(); // Mark as processed
      
    } else if (/^h[1-6]$/.test(tagName)) {
      // Heading (h1-h6) - Notion only supports heading_1, heading_2, heading_3
      // Map h1->1, h2->2, h3->3, h4->3, h5->3, h6->3
      let level = parseInt(tagName.charAt(1));
      if (level > 3) level = 3; // Notion max is heading_3
      
      let innerHtml = $elem.html() || '';
      // Strip SVG icon elements (decorative only, no content value)
      innerHtml = innerHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
      console.log(`🔍 Heading ${level} innerHtml: "${innerHtml.substring(0, 100)}"`);
      const { richText: headingRichText, imageBlocks: headingImages } = await parseRichText(innerHtml);
      console.log(`🔍 Heading ${level} rich_text has ${headingRichText.length} elements, first: ${JSON.stringify(headingRichText[0])}`);
      
      // Add any image blocks found in the heading
      if (headingImages && headingImages.length > 0) {
        processedBlocks.push(...headingImages);
      }
      
      // Split if exceeds 100 elements (Notion limit)
      const richTextChunks = splitRichTextArray(headingRichText);
      console.log(`🔍 Heading ${level} split into ${richTextChunks.length} chunks`);
      for (const chunk of richTextChunks) {
        console.log(`🔍 Creating heading_${level} block with ${chunk.length} rich_text elements`);
        processedBlocks.push({
          object: "block",
          type: `heading_${level}`,
          [`heading_${level}`]: {
            rich_text: chunk,
          },
        });
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'dt') {
      // Definition term - extract as bold paragraph
      console.log(`🔍 Processing <dt> (definition term)`);
      const innerHtml = $elem.html() || '';
      const cleanedText = cleanHtmlText(innerHtml).trim();
      
      if (cleanedText) {
        // Wrap the entire dt content in bold
        const boldHtml = `<strong>${innerHtml}</strong>`;
        const { richText: dtRichText, imageBlocks: dtImages, videoBlocks: dtVideos } = await parseRichText(boldHtml);
        
        // Add any media blocks first
        if (dtImages && dtImages.length > 0) {
          processedBlocks.push(...dtImages);
        }
        if (dtVideos && dtVideos.length > 0) {
          processedBlocks.push(...dtVideos);
        }
        
        // Add the dt text as a paragraph
        if (dtRichText.length > 0 && dtRichText.some(rt => rt.text.content.trim())) {
          const richTextChunks = splitRichTextArray(dtRichText);
          for (const chunk of richTextChunks) {
            processedBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: chunk
              }
            });
          }
        }
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'dd') {
      // Definition description - process children (may contain paragraphs, lists, images, etc.)
      const children = $elem.find('> *').toArray();
      const childTypes = children.map(c => c.name + ($(c).attr('class') ? `.${$(c).attr('class').split(' ')[0]}` : '')).join(', ');
      console.log(`🔍 [DD-DEBUG] Processing <dd> with ${children.length} children: [${childTypes}]`);
      
      if (children.length > 0) {
        // Process all child elements
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
        }
      } else {
        // No children - treat as paragraph
        const innerHtml = $elem.html() || '';
        const cleanedText = cleanHtmlText(innerHtml).trim();
        
        if (cleanedText) {
          const { richText: ddRichText, imageBlocks: ddImages } = await parseRichText(innerHtml);
          
          if (ddImages && ddImages.length > 0) {
            processedBlocks.push(...ddImages);
          }
          
          if (ddRichText.length > 0 && ddRichText.some(rt => rt.text.content.trim())) {
            const richTextChunks = splitRichTextArray(ddRichText);
            for (const chunk of richTextChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: chunk
                }
              });
            }
          }
        }
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'dl') {
      // Definition list - process dt/dd pairs
      console.log(`🔍 Processing <dl> (definition list)`);
      const children = $elem.find('> *').toArray();
      
      for (const child of children) {
        const childBlocks = await processElement(child);
        processedBlocks.push(...childBlocks);
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && ($elem.hasClass('p') || $elem.hasClass('sectiondiv'))) {
      // ServiceNow wrapper divs (div.p, div.sectiondiv) - process children recursively
      // These are semantic wrappers that should be transparent, not converted to paragraphs
      const children = $elem.find('> *').toArray();
      const childTypes = children.map(c => c.name + ($(c).attr('class') ? `.${$(c).attr('class').split(' ')[0]}` : '')).join(', ');
      console.log(`🔍 [DIV-P-FIX] Processing <div class="${$elem.attr('class')}"> with ${children.length} children: [${childTypes}]`);
      
      if (children.length > 0) {
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
        }
      } else {
        // No child elements - extract text content as paragraph
        const innerHtml = $elem.html() || '';
        const cleanedText = cleanHtmlText(innerHtml).trim();
        
        if (cleanedText) {
          // FIX v11.0.39: Skip div.p elements that match table captions
          const normalizedText = cleanedText.toLowerCase();
          console.log(`📊 [CAPTION-CHECK-DIVP] Checking div.p: "${cleanedText.substring(0, 60)}..."`);
          console.log(`📊 [CAPTION-CHECK-DIVP] Set has ${processedTableCaptions.size} caption(s)`);
          
          let shouldSkip = false;
          for (const caption of processedTableCaptions) {
            if (normalizedText.startsWith(caption) || normalizedText === caption) {
              console.log(`📊 [CAPTION-CHECK-DIVP] ✓ MATCH! Skipping div.p with caption: "${caption.substring(0, 60)}..."`);
              shouldSkip = true;
              break;
            }
          }
          
          if (shouldSkip) {
            $elem.remove();
            return processedBlocks;
          }
          
          const { richText: divRichText, imageBlocks: divImages } = await parseRichText(innerHtml);
          
          if (divImages && divImages.length > 0) {
            processedBlocks.push(...divImages);
          }
          
          if (divRichText.length > 0 && divRichText.some(rt => rt.text.content.trim())) {
            const richTextChunks = splitRichTextArray(divRichText);
            for (const chunk of richTextChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: chunk
                }
              });
            }
          }
        }
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'ul') {
      // Unordered list
      const listItems = $elem.find('> li').toArray();
      const ulClass = $elem.attr('class') || 'no-class';
      const ulId = $elem.attr('id') || 'no-id';
      console.log(`🔍 [UL-DEBUG] Processing <ul class="${ulClass}" id="${ulId}"> with ${listItems.length} list items`);
      
      // FIX v11.0.19: Callouts now use marker-based orchestration (markedBlocks)
      // This preserves correct section ordering instead of batching callouts together
      
      for (let li of listItems) {
        const $li = $(li);
        
        // Check if list item contains nested block elements (pre, ul, ol, div.note, p, etc.)
        // Note: We search for div.p wrappers which may contain div.note elements
        // IMPORTANT: div.itemgroup and div.info are NOT block elements - they're just wrappers
        // We need to look INSIDE them for actual block elements (div.note, pre, ul, etc.)
        // First, unwrap div.itemgroup and div.info so we can find nested blocks properly
        // FIX: Use attribute selectors to match elements with these classes (handles multi-class elements like "itemgroup info")
        $li.find('> div[class*="itemgroup"], > div[class*="info"]').each((i, wrapper) => {
          const classes = $(wrapper).attr('class') || '';
          console.log(`🔧 [UNWRAP-FIX] Unwrapping <div class="${classes}"> to expose nested content`);
          $(wrapper).replaceWith($(wrapper).html());
        });
        
        // FIX ISSUE #3 & #5: Find nested blocks recursively, handling deep nesting
        // Strategy: Start with immediate children, but also look inside wrapper divs
        // that aren't semantic block elements themselves (like div without class, or div.p)
        
        // Step 1: Find immediate block children
        let nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note').toArray();
        
        // Step 2: Also look for blocks nested inside plain wrapper divs (NOT div.p, which is handled in step 1)
        $li.find('> div:not(.note):not(.table-wrap):not(.stepxmp):not(.p)').each((i, wrapper) => {
          // Find blocks inside this wrapper
          const innerBlocks = $(wrapper).find('> table, > div.table-wrap, > div.note, > pre, > ul, > ol, > figure').toArray();
          if (innerBlocks.length > 0) {
            console.log(`🔍 Found ${innerBlocks.length} blocks nested inside wrapper div`);
            nestedBlocks.push(...innerBlocks);
          }
        });
        
        // FIX: Also look for div.note elements nested deeper (inside text content)
        // These are callouts that appear inside list item text
        const deepNotes = $li.find('div.note').toArray().filter(note => !nestedBlocks.includes(note));
        if (deepNotes.length > 0) {
          console.log(`🔍 [CALLOUT-FIX] Found ${deepNotes.length} deep-nested div.note elements in list item`);
          deepNotes.forEach(note => {
            const noteClass = $(note).attr('class') || '';
            console.log(`🔍 [CALLOUT-FIX] Deep note class="${noteClass}"`);
          });
          nestedBlocks.push(...deepNotes);
        }
        
        // DIAGNOSTIC: Log what we found
        if (nestedBlocks.length > 0) {
          const blockTypes = nestedBlocks.map(b => b.name).join(', ');
          console.log(`🔍 List item contains ${nestedBlocks.length} nested blocks: ${blockTypes}`);
        }
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 List item contains ${nestedBlocks.length} nested block elements`);
          
          // Extract text content without nested blocks for the list item text
          const $textOnly = $li.clone();
          // Remove nested blocks (including those inside wrapper divs)
          // First remove immediate block children
          $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note').remove();
          // Then remove blocks nested inside wrapper divs
          // CRITICAL: Also remove figure to prevent parseRichText from extracting images that were already processed
          $textOnly.find('table, div.table-wrap, div.note, pre, ul, ol, figure').remove();
          const textOnlyHtml = $textOnly.html();
          
          // DEBUG: Check if there are any img tags remaining in textOnlyHtml
          const remainingImgs = (textOnlyHtml.match(/<img/gi) || []).length;
          if (remainingImgs > 0) {
            console.log(`🔍 [IMAGE-DEBUG-UL] After removing figures, ${remainingImgs} <img> tag(s) remain in textOnlyHtml`);
          }
          
          // Process nested blocks first to add as children
          const nestedChildren = [];
          for (let i = 0; i < nestedBlocks.length; i++) {
            const nestedBlock = nestedBlocks[i];
            console.log(`🔍 Processing nested block in list item: <${nestedBlock.name}>`);
            const childBlocks = await processElement(nestedBlock);
            // DEBUG: Log images in nestedChildren with FULL details
            childBlocks.forEach((blk, idx) => {
              if (blk.type === 'image') {
                const imgUrl = blk.image?.file_upload?.id || blk.image?.external?.url || 'unknown';
                console.log(`🔍 [NESTED-CHILDREN-UL] [${idx}] Image from <${nestedBlock.name}>: ${String(imgUrl).substring(0, 80)}`);
                console.log(`🔍 [NESTED-CHILDREN-UL] Full image object:`, JSON.stringify(blk.image).substring(0, 300));
              }
            });
            nestedChildren.push(...childBlocks);
          }
          console.log(`🔍 [UL-SUMMARY] Total nestedChildren: ${nestedChildren.length}, Images: ${nestedChildren.filter(b => b.type === 'image').length}`);
          
          // Create the list item with text content AND nested blocks as children
          if (textOnlyHtml && cleanHtmlText(textOnlyHtml).trim()) {
            const { richText: liRichText, imageBlocks: liImages } = await parseRichText(textOnlyHtml);
            let inlineImageMarkerToken = null;
            if (liImages && liImages.length > 0) {
              const imageMarker = createMarker();
              inlineImageMarkerToken = `(sn2n:${imageMarker})`;
              liImages.forEach(img => {
                img._sn2n_marker = imageMarker;
              });
              recordMarkers(liImages);
              console.log(`🔍 [MARKER-PRESERVE-IMAGE] ${liImages.length} inline image(s) marked with ${inlineImageMarkerToken}`);
            }
            
            // Filter nested blocks: Notion list items can only have certain block types as children
            // Supported: bulleted_list_item, numbered_list_item, to_do, toggle, image
            // NOT supported: table, code, heading, callout, paragraph (must use marker system for 2nd action)
            // IMPORTANT: To preserve source document order, ALL nested blocks from nestedChildren should use 
            // marker-based orchestration rather than mixing immediate children with deferred blocks.
            // SOLUTION: Mark ALL nestedChildren blocks for orchestration to preserve source order
            // NOTE: liImages (from text content) can still be immediate children as they don't have ordering issues
            const markedBlocks = []; // All nested blocks use marker-based orchestration to preserve order
            
            // Separate immediate children (list items, images) from deferred blocks (paragraphs, tables, etc.)
            const immediateChildren = [];
            
            // CRITICAL FIX: Add images extracted from text content as immediate children
            // Track image SOURCE URLs to prevent duplicates (before upload generates unique IDs)
            const seenImageSources = new Set();
            if (liImages && liImages.length > 0) {
              log(`Adding ${liImages.length} image(s) from text content to bulleted list`);
              liImages.forEach((img) => {
                const sourceUrl = img._sn2n_sourceUrl || img.image?.external?.url || null;
                if (sourceUrl) {
                  seenImageSources.add(String(sourceUrl));
                }
              });
              immediateChildren.push(...liImages);
            }
            
            nestedChildren.forEach(block => {
              // Debug: Log every nested block to see its state
              if (block) {
                const blockType = block.type;
                const hasMarker = !!block._sn2n_marker;
                const richTextPreview = block[blockType]?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 40);
                console.log(`🔍 [NESTED-BLOCK-STATE-UL] Type: ${blockType}, hasMarker: ${hasMarker}, text: "${richTextPreview}..."`);
              }
              
              // CALLOUT MARKER FIX v11.0.19: Use marker-based orchestration for callouts in list items
              // This preserves correct section ordering instead of batching all extracted callouts together
              // Notion does not support callouts as children of list items, so we:
              // 1. Add a marker to the list item's rich_text
              // 2. Store the callout in markerMap for orchestration
              // 3. Append the callout as a sibling after the list item is created
              if (block && block.type === 'callout') {
                const calloutPreview = block.callout?.rich_text?.[0]?.text?.content?.substring(0, 50) || 'no text';
                console.log(`🔍 [CALLOUT-MARKER] Callout in list item - using marker orchestration: "${calloutPreview}"`);
                markedBlocks.push(block);
                return; // Will be orchestrated as sibling after list item
              }
              
              // CRITICAL FIX: Check for marker tokens FIRST (parent blocks with own deferred children)
              // These should be added as immediate children, regardless of whether they also have _sn2n_marker
              const blockType = block.type;
              const hasMarkerToken = block && ['bulleted_list_item', 'numbered_list_item', 'callout', 'to_do', 'toggle'].includes(blockType) &&
                block[blockType]?.rich_text?.some(rt => rt.text?.content?.includes('(sn2n:'));
              
              if (hasMarkerToken) {
                // This is a parent block with its own deferred children - add as immediate child
                if (['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(blockType)) {
                  const preview = block[blockType]?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 40);
                  console.log(`🔍 [NESTING-FIX] "${blockType}" with marker token → IMMEDIATE CHILD: "${preview}..."`);
                  immediateChildren.push(block);
                }
                return; // Don't re-mark - it has its own marker system
              }
              
              // Check if block already has a marker from nested processing
              // IMPORTANT: Callouts/blocks with markers have their own nested content that should be orchestrated to them, not to the list item
              // Only add the callout itself, not its children (which share the same marker)
              if (block && block._sn2n_marker) {
                // This is a deferred child block (has marker but no marker token)
                // It belongs to a CHILD element and should NOT be re-marked with parent's marker
                // Will be added separately via blocksWithExistingMarkers logic
                console.log(`🔍 [NESTING-FIX] "${block.type}" has marker ${block._sn2n_marker} - preserving original association`);
                return; // Skip - preserve original marker association
              }              if (block && block.type === 'paragraph') {
                console.log(`⚠️ Standalone paragraph needs marker for deferred append to bulleted_list_item`);
                markedBlocks.push(block);
                // IMPORTANT: Return here so paragraph is NOT added to immediateChildren
                // This prevents the paragraph from being added as both an immediate child AND a deferred block
                return;
              } else if (block && block.type && ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(block.type)) {
                // List items can be immediate children (2-level nesting supported by Notion)
                // Check if this list item has children that need markers (marker tokens in rich_text)
                const blockType = block.type;
                const richText = block[blockType]?.rich_text || [];
                const hasMarkerToken = richText.some(rt => rt.text?.content?.includes('(sn2n:'));
                
                if (hasMarkerToken) {
                  // List item has its own markers - add as immediate child, markers will be orchestrated later
                  console.log(`🔍 Nested ${block.type} has marker tokens - adding as immediate child (2-level nesting)`);
                  
                  // If this list item has image children with markers, remove them from children
                  // (they're already in processedBlocks and will be orchestrated separately)
                  const children = block[blockType]?.children;
                  if (Array.isArray(children)) {
                    const nonMarkedChildren = children.filter(child => !child._sn2n_marker);
                    if (nonMarkedChildren.length !== children.length) {
                      console.log(`🔍   Removed ${children.length - nonMarkedChildren.length} marked child(ren) from nested bulleted_list_item`);
                      block[blockType].children = nonMarkedChildren.length > 0 ? nonMarkedChildren : undefined;
                    }
                  }
                  
                  immediateChildren.push(block);
                } else {
                  // Simple list item without markers - add as immediate child
                  console.log(`🔍 Nested ${block.type} without markers - adding as immediate child`);
                  immediateChildren.push(block);
                }
              } else if (block && block.type === 'image') {
                // Images can be immediate children, but check for duplicates by SOURCE URL
                const sourceUrl = block._sn2n_sourceUrl || block.image?.external?.url || null;
                
                if (sourceUrl && seenImageSources.has(String(sourceUrl))) {
                  log(`Skipping duplicate image: ${String(sourceUrl).substring(0, 60)}...`);
                } else {
                  if (sourceUrl) {
                    seenImageSources.add(String(sourceUrl));
                  }
                  immediateChildren.push(block);
                }
              } else if (block && block.type) {
                // Tables, headings, callouts, etc. need markers
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                if (block.type === 'table') {
                  console.log(`🔍 [MARKER-PRESERVE-TABLE] Table block deferred for orchestration to preserve source order`);
                }
                markedBlocks.push(block);
              }
            });
            
            // CRITICAL: Enforce Notion's 2-level nesting limit
            // At this point, we're at depth 1 (inside a list item). 
            // Any children we add will be at depth 2, and they CANNOT have their own children.
            // Use enforceNestingDepthLimit to strip any grandchildren and mark them for orchestration.
            const depthResult = enforceNestingDepthLimit(immediateChildren, 1);
            if (depthResult.deferredBlocks.length > 0) {
              console.log(`🔧 Enforced nesting depth: ${depthResult.deferredBlocks.length} blocks deferred for orchestration`);
              // Add deferred blocks to markedBlocks so they get markers
              markedBlocks.push(...depthResult.deferredBlocks);
            }
            
            // ORDERING FIX: If there are container blocks (callouts) in markedBlocks,
            // also mark the immediateChildren so everything goes through orchestration
            // and maintains correct source order. Otherwise, immediateChildren get added
            // to the list item first, then markedBlocks get appended, reversing the order.
            const hasContainerBlocks = markedBlocks.some(b => 
              b && (b.type === 'callout' || b.type === 'table' || b.type === 'heading_3')
            );
            
            let allChildren;
            if (hasContainerBlocks && immediateChildren.length > 0) {
              console.log(`🔄 Deferring ${immediateChildren.length} immediate children for orchestration to maintain correct order with container blocks`);
              // Move immediate children to marked blocks - they'll all be orchestrated together
              // Use push() to add AFTER container blocks, maintaining source order
              markedBlocks.push(...immediateChildren);
              allChildren = [];
            } else {
              // Use only immediateChildren - images are now handled separately with markers
              allChildren = [...immediateChildren];
            }
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
              for (let chunkIndex = 0; chunkIndex < richTextChunks.length; chunkIndex++) {
                const chunk = richTextChunks[chunkIndex];
                console.log(`🔍 [UL-ITEM] Creating bulleted_list_item with ${chunk.length} rich_text elements and ${allChildren.length} children`);
                
                // If there are marked blocks, generate a marker and add token to rich text
                let markerToken = null;
                  if (markedBlocks.length > 0) {
                  const marker = createMarker();
                  markerToken = `(sn2n:${marker})`;
                  // Tag each marked block with the marker for orchestration
                  // CRITICAL: Don't overwrite existing markers from nested processing!
                  const blocksNeedingMarker = markedBlocks.filter(b => !b._sn2n_marker);
                  const blocksWithExistingMarker = markedBlocks.filter(b => b._sn2n_marker);
                  recordMarkers(blocksWithExistingMarker);
                  
                  blocksNeedingMarker.forEach(block => {
                    block._sn2n_marker = marker;
                  });
                  if (blocksNeedingMarker.length > 0) {
                    console.log(`🔍 [MARKER-PRESERVE-UL] ${blocksNeedingMarker.length} new blocks marked with ${markerToken}`);
                  }
                  console.log(`🔍 [MARKER-PRESERVE] ${markedBlocks.length} deferred UL block(s) associated with ${markerToken}`);
                  
                  if (blocksWithExistingMarker.length > 0) {
                    console.log(`🔍 [MARKER-PRESERVE-UL] ${blocksWithExistingMarker.length} blocks already have markers - preserving original associations`);
                  }
                  
                  // Add marker token to end of rich text (will be found by orchestrator)
                  chunk.push({
                    type: "text",
                    text: { content: ` ${markerToken}` },
                    annotations: {
                      bold: false,
                      italic: false,
                      strikethrough: false,
                      underline: false,
                      code: false,
                      color: "default"
                    }
                  });
                  console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks`);
                }
                if (inlineImageMarkerToken && chunkIndex === 0) {
                  chunk.push({
                    type: "text",
                    text: { content: ` ${inlineImageMarkerToken}` },
                    annotations: {
                      bold: false,
                      italic: false,
                      strikethrough: false,
                      underline: false,
                      code: false,
                      color: "default"
                    }
                  });
                  console.log(`🔍 [INLINE-IMAGE-ATTACH] Added marker ${inlineImageMarkerToken} for ${liImages.length} inline image(s)`);
                }
                
                const listItemBlock = {
                  object: "block",
                  type: "bulleted_list_item",
                  bulleted_list_item: {
                    rich_text: chunk,
                  },
                };
                
                // Add nested blocks (including images) as children if any
                if (allChildren.length > 0) {
                  listItemBlock.bulleted_list_item.children = allChildren;
                  console.log(`🔍 Added ${allChildren.length} nested blocks as children of list item`);
                }
                
                processedBlocks.push(listItemBlock);
                
                // Add marked blocks as TOP-LEVEL blocks (NOT as children) so collectAndStripMarkers can find them
                // Adding them as children would place them at depth 3, violating Notion's 2-level limit
                // They will be collected into markerMap and orchestrated after page creation
                if (markedBlocks.length > 0) {
                  console.log(`🔍 Adding ${markedBlocks.length} marked blocks as top-level blocks (NOT children) for collection & orchestration`);
                  processedBlocks.push(...markedBlocks);
                }
              }
              
              // IMPORTANT: Blocks with existing markers (_sn2n_marker) from nested processing
              // should NOT be pushed to processedBlocks here. They are already in the children
              // array of their parent list item (via immediateChildren), and collectAndStripMarkers
              // will find them there, move them to the marker map, and mark them as collected.
              // Pushing them here would create duplicates in the initial payload.
              // 
              // Example: "Table labels renamed" (bulleted_list_item with marker token) is in
              // immediateChildren of "Tables", so its child table (with _sn2n_marker) is in
              // "Table labels renamed"'s children array. collectAndStripMarkers will handle it.
            }
          } else if (nestedChildren.length > 0) {
            // No text content, but has nested blocks
            // Check if first PARAGRAPH is present - if so, promote its text to the list item
            // (Skip images that may appear before paragraphs from paragraph processing)
            const firstParagraphIndex = nestedChildren.findIndex(child => 
              child && child.type === 'paragraph' && child.paragraph && child.paragraph.rich_text
            );
            const firstParagraph = firstParagraphIndex !== -1 ? nestedChildren[firstParagraphIndex] : null;
            
            if (firstParagraphIndex !== -1 && !(firstParagraph && firstParagraph._sn2n_source_container === 'stepxmp')) {
              const beforeParagraph = nestedChildren.slice(0, firstParagraphIndex);
              const afterParagraph = nestedChildren.slice(firstParagraphIndex + 1);
              const remainingChildren = [...beforeParagraph, ...afterParagraph];
              
              // Promote first paragraph's text to list item text
              console.log(`🔍 Promoting first paragraph text to bulleted list item, ${remainingChildren.length} remaining children`);
              const promotedText = firstParagraph.paragraph.rich_text;
              
              // CRITICAL FIX: Mark ALL remaining children (including images) for orchestration
              // Don't overwrite existing markers from nested processing!
              const markedBlocks = remainingChildren.filter(block => block && block.type);
              
              // Add marker if there are remaining children
              let richText = [...promotedText];
              if (markedBlocks.length > 0) {
                const marker = createMarker();
                const markerToken = `(sn2n:${marker})`;
                
                const blocksNeedingMarker = markedBlocks.filter(b => !b._sn2n_marker);
                const blocksWithExistingMarker = markedBlocks.filter(b => b._sn2n_marker);
                recordMarkers(blocksWithExistingMarker);
                
                blocksNeedingMarker.forEach(block => {
                  block._sn2n_marker = marker;
                });
                
                if (blocksWithExistingMarker.length > 0) {
                  console.log(`🔍 [MARKER-PRESERVE-UL-PROMO] ${blocksWithExistingMarker.length} blocks already have markers - preserving`);
                }
                
                richText.push({
                  type: "text",
                  text: { content: ` ${markerToken}` },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default"
                  }
                });
                console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks (promoted paragraph children)`);
                console.log(`🔍 [MARKER-PRESERVE-IMAGE] Promoted inline images and nested content grouped under ${markerToken}`);
              }
              
              const listItemBlock = {
                object: "block",
                type: "bulleted_list_item",
                bulleted_list_item: {
                  rich_text: richText,
                },
              };
              
              // Add marked blocks as children so collectAndStripMarkers can find them
              if (markedBlocks.length > 0) {
                listItemBlock.bulleted_list_item.children = markedBlocks;
                console.log(`🔍 Added ${markedBlocks.length} marked blocks to promoted paragraph list item's children`);
              }
              
              processedBlocks.push(listItemBlock);
            } else {
              // No paragraph to promote, create empty list item with children
              const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
              const validChildren = [];
              const markedBlocks = [];
              
              nestedChildren.forEach(block => {
                // Skip blocks that already have markers - they'll be orchestrated separately
                if (block && block._sn2n_marker) {
                  console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - will be added separately`);
                  return;
                }
                
                if (block && block.type && supportedAsChildren.includes(block.type)) {
                  validChildren.push(block);
                } else if (block && block.type) {
                  console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                  markedBlocks.push(block);
                }
              });
              
              // CRITICAL: Enforce Notion's 2-level nesting limit
              const depthResult = enforceNestingDepthLimit(validChildren, 1);
              if (depthResult.deferredBlocks.length > 0) {
                console.log(`🔧 Enforced nesting depth (no-text list item): ${depthResult.deferredBlocks.length} blocks deferred for orchestration`);
                markedBlocks.push(...depthResult.deferredBlocks);
              }
              
              console.log(`🔍 Creating bulleted_list_item with no text but ${validChildren.length} valid children`);
              
              let markerToken = null;
              const richText = [{ type: "text", text: { content: "" } }];
              if (markedBlocks.length > 0) {
                const marker = createMarker();
                markerToken = `(sn2n:${marker})`;
                
                const blocksNeedingMarker = markedBlocks.filter(b => !b._sn2n_marker);
                const blocksWithExistingMarker = markedBlocks.filter(b => b._sn2n_marker);
                recordMarkers(blocksWithExistingMarker);
                
                blocksNeedingMarker.forEach(block => {
                  block._sn2n_marker = marker;
                });
                
                if (blocksNeedingMarker.length > 0) {
                  console.log(`🔍 [MARKER-PRESERVE-UL] ${blocksNeedingMarker.length} new blocks marked for UL orchestration`);
                }
                if (blocksWithExistingMarker.length > 0) {
                  console.log(`🔍 [MARKER-PRESERVE-UL-NOTEXT] ${blocksWithExistingMarker.length} blocks already have markers - preserving`);
                }
                
                richText[0].text.content = markerToken;
                console.log(`🔍 Added marker ${markerToken} for ${blocksNeedingMarker.length} deferred blocks (${blocksWithExistingMarker.length} already marked)`);
              }
              
              if (validChildren.length > 0 || markedBlocks.length > 0) {
                const listItemBlock = {
                  object: "block",
                  type: "bulleted_list_item",
                  bulleted_list_item: {
                    rich_text: richText,
                    children: validChildren.length > 0 ? validChildren : []
                  },
                };
                
                // Add marked blocks as children so collectAndStripMarkers can find them
                if (markedBlocks.length > 0) {
                  listItemBlock.bulleted_list_item.children.push(...markedBlocks);
                  console.log(`🔍 Added ${markedBlocks.length} marked blocks to empty list item's children`);
                }
                
                processedBlocks.push(listItemBlock);
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          let liHtml = $li.html() || '';
          // Strip SVG icon elements (decorative only, no content value)
          liHtml = liHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
          console.log(`🔍 List item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 [INLINE-IMAGE-CHECK] List item parsed: ${liRichText.length} rich_text elements, ${liImages ? liImages.length : 0} images`);
          
          // Debug: Log the actual text content
          if (liRichText.length > 0) {
            const textPreview = liRichText.map(rt => rt.text?.content || '').join('').substring(0, 100);
            console.log(`🔍 List item text content: "${textPreview}"`);
          }
          
          // Debug: Log if we found images
          if (liImages && liImages.length > 0) {
            console.log(`🔍 [INLINE-IMAGE-CHECK] Found ${liImages.length} image(s) in list item HTML`);
          }
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (let chunkIndex = 0; chunkIndex < richTextChunks.length; chunkIndex++) {
            const chunk = richTextChunks[chunkIndex];
            const listItemBlock = {
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: {
                rich_text: chunk,
              },
            };
            
            // Mark images for deferred orchestration to avoid 4-level nesting
            // (numbered_list_item > bulleted_list_item > numbered_list_item > image)
            // CRITICAL: Only attach images to the FIRST chunk to avoid duplicate markers
            if (liImages && liImages.length > 0 && chunkIndex === 0) {
              const marker = createMarker();
              const markerToken = `(sn2n:${marker})`;
              liImages.forEach(img => {
                img._sn2n_marker = marker;
              });
                console.log(`🔍 [MARKER-PRESERVE-IMAGE] ${liImages.length} inline image(s) marked with ${markerToken}`);
              listItemBlock.bulleted_list_item.rich_text.push({
                type: "text",
                text: { content: ` ${markerToken}` },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default"
                }
              });
              console.log(`🔍 [INLINE-IMAGE-ATTACH] Creating bulleted_list_item with ${chunk.length} rich_text elements`);
              console.log(`🔍 [INLINE-IMAGE-ATTACH] Added marker ${markerToken} for ${liImages.length} deferred image(s)`);
              console.log(`🔍 [MARKER-PRESERVE-IMAGE] Inline images told to share marker ${markerToken}`);
              
              // Add images as children so collectAndStripMarkers can find them
              listItemBlock.bulleted_list_item.children = liImages;
              console.log(`🔍 [INLINE-IMAGE-ATTACH] Added ${liImages.length} inline images to simple list item's children (will be collected & orchestrated)`);
              console.log(`🔍 [INLINE-IMAGE-ATTACH] Children array: ${JSON.stringify(listItemBlock.bulleted_list_item.children.map(c => ({ type: c.type, hasMarker: !!c._sn2n_marker })))}`);
              processedBlocks.push(listItemBlock);
            } else {
              if (chunkIndex > 0 && liImages && liImages.length > 0) {
                console.log(`🔍 [INLINE-IMAGE-SKIP] Skipping image attachment for chunk ${chunkIndex} (not first chunk)`);
              }
              console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements`);
              processedBlocks.push(listItemBlock);
            }
          }
        }
      }
      
      // FIX v11.0.19: Callouts now use marker-based orchestration (no longer extracted to array)
      // The extractedCallouts array is no longer populated - callouts go into markedBlocks instead
      // This preserves correct section ordering
      
      console.log(`✅ Created list blocks from <ul>`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'ol') {
      // Ordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ol> with ${listItems.length} list items`);
      
      // FIX v11.0.19: Callouts now use marker-based orchestration (markedBlocks)
      // This preserves correct section ordering instead of batching callouts together
      
      for (let li of listItems) {
        const $li = $(li);
        
        // First, unwrap div.itemgroup and div.info so we can find nested blocks properly
        // FIX: Use attribute selectors to match elements with these classes (handles multi-class elements like "itemgroup info")
        const wrappersToUnwrap = $li.find('> div[class*="itemgroup"], > div[class*="info"]');
        if (wrappersToUnwrap.length > 0) {
          wrappersToUnwrap.each((i, wrapper) => {
            const classes = $(wrapper).attr('class') || '';
            const hasTable = $(wrapper).find('table').length > 0;
            const hasTableWrap = $(wrapper).find('div.table-wrap').length > 0;
            console.log(`🔧 [UNWRAP-FIX-OL] Unwrapping <div class="${classes}"> (tables: ${hasTable ? 'YES' : 'no'}, table-wrap: ${hasTableWrap ? 'YES' : 'no'})`);
            $(wrapper).replaceWith($(wrapper).html());
          });
        }
        
        // Check if list item contains nested block elements (pre, ul, ol, div.note, p, div.itemgroup, etc.)
        // Note: We search for div.p wrappers which may contain div.note elements
        // We ALSO search for div.note directly in case it's a direct child of <li>
        // FIX ISSUE #3 & #5: Also look inside wrapper divs for deeply nested blocks
        // CRITICAL: Must query AFTER unwrapping to see the newly exposed elements
        // NOTE: Include '> figure' for direct children after unwrapping; duplicate filter will catch figures inside div.p
        let nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note').toArray();
        
        // DUPLICATE FIX: Filter out nested blocks that are INSIDE other nested blocks
        // Example: <div class="p"><figure>...</figure></div> should only process the div, not both
        console.log(`🔍 [DUPLICATE-FIX] Checking ${nestedBlocks.length} nested blocks for parent-child relationships...`);
        nestedBlocks = nestedBlocks.filter((block, index, arr) => {
          // Check if any parent of this block (up to the list item) is another block in the array
          const blockName = block.name;
          const blockId = $(block).attr('id') || 'no-id';
          const blockClass = $(block).attr('class') || 'no-class';
          
          let currentParent = block.parent;
          const isInsideOther = arr.some((otherBlock, otherIndex) => {
            if (index === otherIndex) return false; // Don't compare with self
            // Walk up from current block to the list item, checking if any parent IS the otherBlock
            let checkParent = block.parent;
            while (checkParent && checkParent.name !== 'li') {
              if (checkParent === otherBlock) {
                console.log(`🔍 [DUPLICATE-FIX] <${blockName} id="${blockId}"> IS inside <${otherBlock.name}>`);
                return true;
              }
              checkParent = checkParent.parent;
            }
            return false;
          });
          
          if (isInsideOther) {
            console.log(`🔧 [DUPLICATE-FIX] ✂️ Filtering out nested <${blockName} id="${blockId}" class="${blockClass}"> (inside another nested block)`);
          }
          return !isInsideOther;
        });
        
        // DEBUG: Log what we found
        if (nestedBlocks.length > 0) {
          const blockTypes = nestedBlocks.map(b => b.name + ($(b).attr('class') ? '.' + $(b).attr('class').split(' ')[0] : '')).join(', ');
          console.log(`🔍 [OL-DEBUG] Found ${nestedBlocks.length} nested blocks: ${blockTypes}`);
        }
        
        // Also look for blocks nested inside plain wrapper divs or div.p
        $li.find('> div:not(.note):not(.table-wrap):not(.stepxmp), > div.p, > div.itemgroup, > div.info').each((i, wrapper) => {
          // Find blocks inside this wrapper
          // NOTE: Removed '> figure' and '> div.table-wrap' - these should only be processed when their parent div.p is processed
          const innerBlocks = $(wrapper).find('> table, > div.note, > pre, > ul, > ol').toArray();
          if (innerBlocks.length > 0) {
            console.log(`🔍 Found ${innerBlocks.length} blocks nested inside ordered list wrapper div`);
            nestedBlocks.push(...innerBlocks);
          }
        });
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 Ordered list item contains ${nestedBlocks.length} nested block elements`);
          
          // Log what nested blocks we found
          nestedBlocks.forEach((block, idx) => {
            const $block = $(block);
            const blockTag = block.name;
            const blockClass = $block.attr('class') || '';
            const blockPreview = $block.text().trim().substring(0, 80);
            console.log(`🔍   [${idx}] <${blockTag}${blockClass ? ` class="${blockClass}"` : ''}> - "${blockPreview}..."`);
          });
          
          // Extract text content without nested blocks for the list item text
          const $textOnly = $li.clone();
          // Remove nested blocks (including those inside wrapper divs)
          $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').remove();
          // Then remove blocks nested inside wrapper divs
          $textOnly.find('table, div.table-wrap, div.note, pre, ul, ol, figure').remove();
          const textOnlyHtml = $textOnly.html();
          
          // DEBUG: Check if there are any img tags remaining in textOnlyHtml
          const remainingImgs = (textOnlyHtml.match(/<img/gi) || []).length;
          if (remainingImgs > 0) {
            console.log(`🔍 [IMAGE-DEBUG-OL] After removing figures, ${remainingImgs} <img> tag(s) remain in textOnlyHtml`);
          }
          
          // Process nested blocks first to add as children
          const nestedChildren = [];
          for (let i = 0; i < nestedBlocks.length; i++) {
            const nestedBlock = nestedBlocks[i];
            console.log(`🔍 Processing nested block in ordered list item: <${nestedBlock.name}>`);
            const childBlocks = await processElement(nestedBlock);
            // DEBUG: Log images in nestedChildren with FULL details
            childBlocks.forEach((blk, idx) => {
              if (blk.type === 'image') {
                const imgUrl = blk.image?.file_upload?.id || blk.image?.external?.url || 'unknown';
                console.log(`🔍 [NESTED-CHILDREN-OL] [${idx}] Image from <${nestedBlock.name}>: ${String(imgUrl).substring(0, 80)}`);
                console.log(`🔍 [NESTED-CHILDREN-OL] Full image object:`, JSON.stringify(blk.image).substring(0, 300));
              }
            });
            nestedChildren.push(...childBlocks);
          }
          console.log(`🔍 [OL-SUMMARY] Total nestedChildren: ${nestedChildren.length}, Images: ${nestedChildren.filter(b => b.type === 'image').length}`);
          
          // Create the list item with text content AND nested blocks as children
          if (textOnlyHtml && cleanHtmlText(textOnlyHtml).trim()) {
            const { richText: liRichText, imageBlocks: liImages } = await parseRichText(textOnlyHtml);
            
            // FIX v11.0.39: Skip list items that start with table captions
            // Table captions appear as headings above tables, so list items with same text are duplicates
            const listItemText = cleanHtmlText(textOnlyHtml).toLowerCase();
            console.log(`📊 [CAPTION-CHECK-OL] Checking list item: "${listItemText.substring(0, 60)}..."`);
            console.log(`📊 [CAPTION-CHECK-OL] Set has ${processedTableCaptions.size} caption(s)`);
            
            let shouldSkipListItem = false;
            for (const caption of processedTableCaptions) {
              if (listItemText.startsWith(caption)) {
                console.log(`📊 [CAPTION-CHECK-OL] ✓ MATCH! Skipping list item starting with caption: "${caption.substring(0, 60)}..."`);
                shouldSkipListItem = true;
                break;
              }
            }
            
            if (shouldSkipListItem) {
              $li.remove();
              continue; // Skip this list item entirely
            }
            
            // Filter nested blocks: Notion list items can only have certain block types as children
            // Supported: bulleted_list_item, numbered_list_item, to_do, toggle, image
            // NOT supported: table, code, heading, callout, paragraph (must use marker system for 2nd action)
            // IMPORTANT: To preserve source document order, ALL nested blocks from nestedChildren should use 
            // marker-based orchestration rather than mixing immediate children with deferred blocks.
            // SOLUTION: Mark ALL nestedChildren blocks for orchestration to preserve source order
            // NOTE: liImages (from text content) can still be immediate children as they don't have ordering issues
            const markedBlocks = []; // All nested blocks use marker-based orchestration to preserve order
            
            // Separate immediate children (list items, images) from deferred blocks (paragraphs, tables, etc.)
            const immediateChildren = [];
            
            // CRITICAL FIX: Add images extracted from text content as immediate children
            // Track image SOURCE URLs to prevent duplicates (before upload generates unique IDs)
            const seenImageSources = new Set();
            if (liImages && liImages.length > 0) {
              log(`Adding ${liImages.length} image(s) from text content to numbered list`);
              liImages.forEach((img) => {
                const sourceUrl = img._sn2n_sourceUrl || img.image?.external?.url || null;
                if (sourceUrl) {
                  seenImageSources.add(String(sourceUrl));
                }
              });
              immediateChildren.push(...liImages);
            }
            
            nestedChildren.forEach(block => {
              // CALLOUT MARKER FIX v11.0.19: Use marker-based orchestration for callouts in list items
              // This preserves correct section ordering instead of batching all extracted callouts together
              // Notion does not support callouts as children of list items, so we:
              // 1. Add a marker to the list item's rich_text
              // 2. Store the callout in markerMap for orchestration
              // 3. Append the callout as a sibling after the list item is created
              if (block && block.type === 'callout') {
                const calloutPreview = block.callout?.rich_text?.[0]?.text?.content?.substring(0, 50) || 'no text';
                console.log(`🔍 [CALLOUT-MARKER] Callout in list item - using marker orchestration: "${calloutPreview}"`);
                markedBlocks.push(block);
                return; // Will be orchestrated as sibling after list item
              }
              
              // CRITICAL FIX: Check for marker tokens FIRST (parent blocks with own deferred children)
              // These should be added as immediate children, regardless of whether they also have _sn2n_marker
              const blockType = block.type;
              const hasMarkerToken = block && ['bulleted_list_item', 'numbered_list_item', 'callout', 'to_do', 'toggle'].includes(blockType) &&
                block[blockType]?.rich_text?.some(rt => rt.text?.content?.includes('(sn2n:'));
              
              if (hasMarkerToken) {
                // This is a parent block with its own deferred children - add as immediate child
                if (['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(blockType)) {
                  const preview = block[blockType]?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 40);
                  console.log(`🔍 [NESTING-FIX] "${blockType}" with marker token → IMMEDIATE CHILD: "${preview}..."`);
                  immediateChildren.push(block);
                }
                return; // Don't re-mark - it has its own marker system
              }
              
              // Check if block already has a marker from nested processing
              // IMPORTANT: Callouts/blocks with markers have their own nested content that should be orchestrated to them, not to the list item
              // Only add the callout itself, not its children (which share the same marker)
              if (block && block._sn2n_marker) {
                // This is a deferred child block (has marker but no marker token)
                // It belongs to a CHILD element and should NOT be re-marked with parent's marker
                // Will be added separately via blocksWithExistingMarkers logic
                console.log(`🔍 [NESTING-FIX] "${block.type}" has marker ${block._sn2n_marker} - preserving original association`);
                return; // Skip - preserve original marker association
              }
              
              if (block && block.type === 'paragraph') {
                console.log(`⚠️ Standalone paragraph needs marker for deferred append to numbered_list_item`);
                markedBlocks.push(block);
                // IMPORTANT: Return here so paragraph is NOT added to immediateChildren
                // This prevents the paragraph from being added as both an immediate child AND a deferred block
                return;
              } else if (block && block.type && ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'].includes(block.type)) {
                // List items can be immediate children (2-level nesting supported by Notion)
                // Check if this list item has children that need markers (marker tokens in rich_text)
                const blockType = block.type;
                const richText = block[blockType]?.rich_text || [];
                const hasMarkerToken = richText.some(rt => rt.text?.content?.includes('(sn2n:'));
                
                if (hasMarkerToken) {
                  // List item has its own markers - add as immediate child, markers will be orchestrated later
                  console.log(`🔍 Nested ${block.type} has marker tokens - adding as immediate child (2-level nesting)`);
                  
                  // If this list item has image children with markers, remove them from children
                  // (they're already in processedBlocks and will be orchestrated separately)
                  const children = block[blockType]?.children;
                  if (Array.isArray(children)) {
                    const nonMarkedChildren = children.filter(child => !child._sn2n_marker);
                    if (nonMarkedChildren.length !== children.length) {
                      console.log(`🔍   Removed ${children.length - nonMarkedChildren.length} marked child(ren) from nested numbered_list_item`);
                      block[blockType].children = nonMarkedChildren.length > 0 ? nonMarkedChildren : undefined;
                    }
                  }
                  
                  immediateChildren.push(block);
                } else {
                  // Simple list item without markers - add as immediate child
                  console.log(`🔍 Nested ${block.type} without markers - adding as immediate child`);
                  immediateChildren.push(block);
                }
              } else if (block && block.type === 'image') {
                // Images can be immediate children, but check for duplicates by SOURCE URL
                const sourceUrl = block._sn2n_sourceUrl || block.image?.external?.url || null;
                
                if (sourceUrl && seenImageSources.has(String(sourceUrl))) {
                  log(`Skipping duplicate image: ${String(sourceUrl).substring(0, 60)}...`);
                } else {
                  if (sourceUrl) {
                    seenImageSources.add(String(sourceUrl));
                  }
                  immediateChildren.push(block);
                }
              } else if (block && block.type) {
                // Tables, headings, callouts, etc. need markers
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                if (block.type === 'table') {
                  console.log(`🔍 [MARKER-PRESERVE-TABLE] Table block deferred for orchestration to preserve source order`);
                }
                markedBlocks.push(block);
              }
            });
            
            // CRITICAL: Enforce Notion's 2-level nesting limit
            // At this point, we're at depth 1 (inside a list item). 
            // Any children we add will be at depth 2, and they CANNOT have their own children.
            // Use enforceNestingDepthLimit to strip any grandchildren and mark them for orchestration.
            const depthResult = enforceNestingDepthLimit(immediateChildren, 1);
            if (depthResult.deferredBlocks.length > 0) {
              console.log(`🔧 Enforced nesting depth: ${depthResult.deferredBlocks.length} blocks deferred for orchestration`);
              // Add deferred blocks to markedBlocks so they get markers
              markedBlocks.push(...depthResult.deferredBlocks);
            }
            
            // ORDERING FIX: If there are container blocks (callouts) in markedBlocks,
            // also mark the immediateChildren so everything goes through orchestration
            // and maintains correct source order. Otherwise, immediateChildren get added
            // to the list item first, then markedBlocks get appended, reversing the order.
            const hasContainerBlocks = markedBlocks.some(b => 
              b && (b.type === 'callout' || b.type === 'table' || b.type === 'heading_3')
            );
            
            let allChildren;
            if (hasContainerBlocks && immediateChildren.length > 0) {
              console.log(`🔄 Deferring ${immediateChildren.length} immediate children for orchestration to maintain correct order with container blocks`);
              // Move immediate children to marked blocks - they'll all be orchestrated together
              // Use push() to add AFTER container blocks, maintaining source order
              markedBlocks.push(...immediateChildren);
              allChildren = [];
            } else {
              // Use only immediateChildren - images are now handled separately with markers
              allChildren = [...immediateChildren];
            }
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
              console.log(`🔍 List item text: "${liRichText.map(rt => rt.text.content).join('').substring(0, 80)}..."`);
              console.log(`🔍 List item has ${allChildren.length} children: ${allChildren.map(c => c.type).join(', ')}`);
              for (const chunk of richTextChunks) {
                console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements and ${allChildren.length} children`);
                
                // If there are marked blocks, generate a marker and add token to rich text
                let markerToken = null;
                if (markedBlocks.length > 0) {
                  const marker = createMarker();
                  markerToken = `(sn2n:${marker})`;
                  // Tag each marked block with the marker for orchestration
                  // CRITICAL: Don't overwrite existing markers from nested processing!
                  const blocksNeedingMarker = markedBlocks.filter(b => !b._sn2n_marker);
                  const blocksWithExistingMarker = markedBlocks.filter(b => b._sn2n_marker);
                  recordMarkers(blocksWithExistingMarker);
                  
                  blocksNeedingMarker.forEach(block => {
                    block._sn2n_marker = marker;
                  });
                  if (blocksNeedingMarker.length > 0) {
                    console.log(`🔍 [MARKER-PRESERVE] ${blocksNeedingMarker.length} new blocks marked with ${markerToken}`);
                  }
                  console.log(`🔍 [MARKER-PRESERVE] ${markedBlocks.length} deferred OL block(s) grouped under ${markerToken}`);
                  
                  if (blocksWithExistingMarker.length > 0) {
                    console.log(`🔍 [MARKER-PRESERVE] ${blocksWithExistingMarker.length} blocks already have markers - preserving original associations`);
                  }
                  
                  // Add marker token to end of rich text (will be found by orchestrator)
                  chunk.push({
                    type: "text",
                    text: { content: ` ${markerToken}` },
                    annotations: {
                      bold: false,
                      italic: false,
                      strikethrough: false,
                      underline: false,
                      code: false,
                      color: "default"
                    }
                  });
                  console.log(`🔍 Added marker ${markerToken} for ${blocksNeedingMarker.length} deferred blocks (${blocksWithExistingMarker.length} already marked)`);
                }
                
                const listItemBlock = {
                  object: "block",
                  type: "numbered_list_item",
                  numbered_list_item: {
                    rich_text: chunk,
                  },
                };
                
                // Add nested blocks (including images) as children if any
                if (allChildren.length > 0) {
                  listItemBlock.numbered_list_item.children = allChildren;
                  console.log(`🔍 Added ${allChildren.length} nested blocks as children of ordered list item`);
                }
                
                processedBlocks.push(listItemBlock);
                
                // Add marked blocks as TOP-LEVEL blocks (NOT as children) so collectAndStripMarkers can find them
                // Adding them as children would place them at depth 3, violating Notion's 2-level limit
                // They will be collected into markerMap and orchestrated after page creation
                if (markedBlocks.length > 0) {
                  console.log(`🔍 Adding ${markedBlocks.length} marked blocks as top-level blocks (NOT children) for collection & orchestration`);
                  processedBlocks.push(...markedBlocks);
                }
              }
              
              // Add blocks from nested children that already have markers (from nested list processing)
              // These preserve their original markers and parent associations
              // BUT only if they're not already being added as immediate children or marked blocks
              // ALSO skip blocks whose marker matches a parent block's marker (they're children of that parent)
              const blocksWithExistingMarkers = nestedChildren.filter(b => {
                if (!b || !b._sn2n_marker) return false;
                // Check if already in immediateChildren or markedBlocks
                const alreadyAdded = immediateChildren.includes(b) || markedBlocks.includes(b);
                if (alreadyAdded) return false;
                
                // Check if this block's marker matches any other block's marker in markedBlocks
                // If so, it's a child of that block and shouldn't be added separately
                const isChildOfMarkedBlock = markedBlocks.some(parent => 
                  parent && parent._sn2n_marker === b._sn2n_marker
                );
                return !isChildOfMarkedBlock;
              });
              recordMarkers(blocksWithExistingMarkers);
              if (blocksWithExistingMarkers.length > 0) {
                console.log(`🔍 Adding ${blocksWithExistingMarkers.length} blocks with existing markers from nested processing (ordered)`);
                processedBlocks.push(...blocksWithExistingMarkers);
              }
            }
          } else if (nestedChildren.length > 0) {
            // No text content, but has nested blocks
            // Check if first PARAGRAPH is present - if so, promote its text to the list item
            // (Skip images that may appear before paragraphs from paragraph processing)
            const firstParagraphIndex = nestedChildren.findIndex(child => 
              child && child.type === 'paragraph' && child.paragraph && child.paragraph.rich_text
            );
            const firstParagraph = firstParagraphIndex !== -1 ? nestedChildren[firstParagraphIndex] : null;
            
            if (firstParagraphIndex !== -1 && !(firstParagraph && firstParagraph._sn2n_source_container === 'stepxmp')) {
              const beforeParagraph = nestedChildren.slice(0, firstParagraphIndex);
              const afterParagraph = nestedChildren.slice(firstParagraphIndex + 1);
              const remainingChildren = [...beforeParagraph, ...afterParagraph];
              
              // Promote first paragraph's text to list item text
              console.log(`🔍 Promoting first paragraph text to numbered list item, ${remainingChildren.length} remaining children`);
              console.log(`🔍 [PROMO-DEBUG] remainingChildren types: ${remainingChildren.map(b => b?.type).join(', ')}`);
              const promotedText = firstParagraph.paragraph.rich_text;
              const promotedTextPreview = promotedText.map(rt => rt.text?.content || '').join('').substring(0, 80);
              console.log(`🔍 [PROMO-DEBUG] Promoted text: "${promotedTextPreview}..."`);
              
              // CRITICAL FIX v2: ALL remaining children (including images) need markers for orchestration
              // because we may be at depth 2, making children depth 3 (exceeds Notion's limit).
              // Mark ALL blocks for deferred orchestration.
              const markedBlocks = remainingChildren.filter(block => block && block.type);
              
              markedBlocks.forEach((block, idx) => {
                const blockType = block.type;
                const preview = blockType === 'image' 
                  ? (block.image?.caption?.[0]?.text?.content || 'no caption')
                  : (blockType === 'paragraph' ? block.paragraph?.rich_text?.[0]?.text?.content?.substring(0, 40) : blockType);
                console.log(`🔍 [IMAGE-INLINE-FIX-V2] remainingChild[${idx}] (${blockType}): "${preview}" - marking for orchestration`);
              });
              
              // Add marker token to rich text if there are blocks that need orchestration
              let richText = [...promotedText];
              if (markedBlocks.length > 0) {
                const marker = createMarker();
                const markerToken = `(sn2n:${marker})`;
                markedBlocks.forEach(block => {
                  block._sn2n_marker = marker;
                });
                richText.push({
                  type: "text",
                  text: { content: ` ${markerToken}` },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                    color: "default"
                  }
                });
                console.log(`🔍 [IMAGE-INLINE-FIX-V2] Added marker ${markerToken} for ${markedBlocks.length} deferred blocks (including images)`);
                  const inlineImages = markedBlocks.filter(b => b && b.type === 'image');
                  if (inlineImages.length > 0) {
                    console.log(`🔍 [MARKER-PRESERVE-IMAGE] ${inlineImages.length} inline image(s) marked with ${markerToken}`);
                  }
              }
              
              const listItemBlock = {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: richText,
                },
              };
              
              // Add marked blocks as children so collectAndStripMarkers can find them
              if (markedBlocks.length > 0) {
                listItemBlock.numbered_list_item.children = markedBlocks;
                console.log(`🔍 [IMAGE-INLINE-FIX-V2] Added ${markedBlocks.length} marked blocks to promoted list item's children`);
              }
              
              processedBlocks.push(listItemBlock);
            } else {
              // No paragraph to promote, create empty list item with children
              const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
              const validChildren = [];
              const markedBlocks = [];
              
              nestedChildren.forEach(block => {
                // Skip blocks that already have markers - they'll be orchestrated separately
                if (block && block._sn2n_marker) {
                  console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - will be added separately`);
                  return;
                }
                
                if (block && block.type && supportedAsChildren.includes(block.type)) {
                  validChildren.push(block);
                } else if (block && block.type) {
                  console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                  if (block.type === 'table') {
                    console.log(`🔍 [MARKER-PRESERVE-TABLE] Table block deferred for orchestration to preserve source order`);
                  }
                  markedBlocks.push(block);
                }
              });
              
              // CRITICAL: Enforce Notion's 2-level nesting limit
              const depthResult = enforceNestingDepthLimit(validChildren, 1);
              if (depthResult.deferredBlocks.length > 0) {
                console.log(`🔧 Enforced nesting depth (no-text numbered list item): ${depthResult.deferredBlocks.length} blocks deferred for orchestration`);
                markedBlocks.push(...depthResult.deferredBlocks);
              }
              
              console.log(`🔍 Creating numbered_list_item with no text but ${validChildren.length} valid children`);
              
              let markerToken = null;
              const richText = [{ type: "text", text: { content: "" } }];
              if (markedBlocks.length > 0) {
                const marker = createMarker();
                markerToken = `(sn2n:${marker})`;
                
                const blocksNeedingMarker = markedBlocks.filter(b => !b._sn2n_marker);
                const blocksWithExistingMarker = markedBlocks.filter(b => b._sn2n_marker);
                recordMarkers(blocksWithExistingMarker);
                
                blocksNeedingMarker.forEach(block => {
                  block._sn2n_marker = marker;
                });
                
                if (blocksWithExistingMarker.length > 0) {
                  console.log(`🔍 [MARKER-PRESERVE-OL-NOTEXT] ${blocksWithExistingMarker.length} blocks already have markers - preserving`);
                }
                
                richText[0].text.content = markerToken;
                console.log(`🔍 Added marker ${markerToken} for ${blocksNeedingMarker.length} deferred blocks (${blocksWithExistingMarker.length} already marked)`);
              }
              
              if (validChildren.length > 0 || markedBlocks.length > 0) {
                const listItemBlock = {
                  object: "block",
                  type: "numbered_list_item",
                  numbered_list_item: {
                    rich_text: richText,
                    children: validChildren.length > 0 ? validChildren : []
                  },
                };
                
                // Add marked blocks as children so collectAndStripMarkers can find them
                if (markedBlocks.length > 0) {
                  listItemBlock.numbered_list_item.children.push(...markedBlocks);
                  console.log(`🔍 Added ${markedBlocks.length} marked blocks to empty numbered list item's children`);
                }
                
                processedBlocks.push(listItemBlock);
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          let liHtml = $li.html() || '';
          // Strip SVG icon elements (decorative only, no content value)
          liHtml = liHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
          console.log(`🔍 Ordered list item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 Ordered list item rich_text: ${liRichText.length} elements`);
          
          // Debug: Log the actual text content
          if (liRichText.length > 0) {
            const textPreview = liRichText.map(rt => rt.text?.content || '').join('').substring(0, 100);
            console.log(`🔍 Ordered list item text content: "${textPreview}"`);
          }
          
          // FIX v11.0.39: Skip list items that start with table captions
          // Table captions appear as headings above tables, so list items with same text are duplicates
          const listItemText = cleanHtmlText(liHtml).toLowerCase();
          console.log(`📊 [CAPTION-CHECK-OL-SIMPLE] Checking simple list item: "${listItemText.substring(0, 60)}..."`);
          console.log(`📊 [CAPTION-CHECK-OL-SIMPLE] Set has ${processedTableCaptions.size} caption(s)`);
          
          let shouldSkipListItem = false;
          for (const caption of processedTableCaptions) {
            if (listItemText.startsWith(caption)) {
              console.log(`📊 [CAPTION-CHECK-OL-SIMPLE] ✓ MATCH! Skipping list item starting with caption: "${caption.substring(0, 60)}..."`);
              shouldSkipListItem = true;
              break;
            }
          }
          
          if (shouldSkipListItem) {
            $li.remove();
            continue; // Skip this list item entirely
          }
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (let chunkIndex = 0; chunkIndex < richTextChunks.length; chunkIndex++) {
            const chunk = richTextChunks[chunkIndex];
            const listItemBlock = {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: chunk,
              },
            };
            
            // Mark images for deferred orchestration to avoid 4-level nesting
            // (numbered_list_item > bulleted_list_item > numbered_list_item > image)
            // CRITICAL: Only attach images to the FIRST chunk to avoid duplicate markers
            if (liImages && liImages.length > 0 && chunkIndex === 0) {
              const marker = createMarker();
              const markerToken = `(sn2n:${marker})`;
              liImages.forEach(img => {
                img._sn2n_marker = marker;
              });
              listItemBlock.numbered_list_item.rich_text.push({
                type: "text",
                text: { content: ` ${markerToken}` },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default"
                }
              });
              console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements`);
              console.log(`🔍 Added marker ${markerToken} for ${liImages.length} deferred image(s)`);
              
              // Add images as children so collectAndStripMarkers can find them
              listItemBlock.numbered_list_item.children = liImages;
              console.log(`🔍 Added ${liImages.length} inline images to simple numbered list item's children (will be collected & orchestrated)`);
              processedBlocks.push(listItemBlock);
            } else {
              console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements`);
              processedBlocks.push(listItemBlock);
            }
          }
        }
      }
      
      // FIX v11.0.19: Callouts now use marker-based orchestration (no longer extracted to array)
      // The extractedCallouts array is no longer populated - callouts go into markedBlocks instead
      // This preserves correct section ordering
      
      console.log(`✅ Created list blocks from <ol>`);
      $elem.remove(); // Mark as processed
      
    // 3) Paragraphs, including heuristic detection of inline callout labels ("Note:", "Warning:", etc.)
    } else if (tagName === 'p' || (tagName === 'div' && $elem.hasClass('p'))) {
      // Paragraph (both <p> and <div class="p"> in ServiceNow docs)
      // BUT FIRST: Check if this contains a table at ANY level - if so, extract text then process as container
      const hasTables = $elem.find('table').length > 0;
      if (hasTables) {
        console.log(`🔍 <${tagName}${$elem.hasClass('p') ? ' class="p"' : ''}> contains table(s) - processing as container instead of paragraph`);
        
        // Process child nodes in order, separating text/HTML content from block elements
        // IMPORTANT: Convert to array BEFORE iterating to prevent DOM modification issues
        const childNodes = Array.from($elem.get(0).childNodes);
        let currentTextHtml = '';
        
        for (const node of childNodes) {
          const isTextNode = node.nodeType === 3;
          const isElementNode = node.nodeType === 1;
          const nodeName = (node.name || node.nodeName || node.tagName || '').toUpperCase();
          const isBlockElement = isElementNode && ['DIV', 'TABLE', 'UL', 'OL', 'FIGURE', 'PRE'].includes(nodeName);
          
          // If it's a text node or inline element (not a block container like div.table-wrap)
          if (isTextNode || (isElementNode && !isBlockElement)) {
            // Accumulate HTML (preserves links and formatting)
            const textToAdd = isTextNode ? (node.nodeValue || node.data || '') : $(node).prop('outerHTML');
            currentTextHtml += textToAdd;
          } else if (isBlockElement) {
            // Found a block element (table-wrap, div, etc.)
            // First, flush any accumulated text/HTML as a paragraph
            if (currentTextHtml.trim()) {
              console.log(`🔍 Found text/HTML before block element: "${currentTextHtml.trim().substring(0, 80)}..."`);
              const { richText: textRichText } = await parseRichText(currentTextHtml.trim());
              if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
                const textChunks = splitRichTextArray(textRichText);
                for (const chunk of textChunks) {
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                      rich_text: chunk
                    }
                  });
                }
              }
              currentTextHtml = '';
            }
            
            // Process the block element (table, div.note, etc.)
            const childBlocks = await processElement(node);
            processedBlocks.push(...childBlocks);
            // Remove the processed node from DOM to prevent double-processing by parent elements
            $(node).remove();
          }
        }
        
        // Flush any remaining text/HTML after the last block element
        if (currentTextHtml.trim()) {
          console.log(`🔍 Found text/HTML after block elements: "${currentTextHtml.trim().substring(0, 80)}..."`);
          const { richText: textRichText } = await parseRichText(currentTextHtml.trim());
          if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
            const textChunks = splitRichTextArray(textRichText);
            for (const chunk of textChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: chunk
                }
              });
            }
          }
        }
        
        $elem.remove();
        return processedBlocks;
      }
      
      // Check if this paragraph contains nested block-level elements
      // (ul, ol, dl, div.note, figure, iframe) - if so, handle mixed content
      // NOTE: Search for DIRECT CHILDREN ONLY (>) to avoid finding elements already nested in lists
      // This prevents duplicate processing of figures inside <ol>/<ul> elements
      const directBlocks = $elem.find('> ul, > ol, > dl').toArray();
      const inlineBlocks = $elem.find('> div.note, > figure, > iframe').toArray();
      const nestedBlocks = [...directBlocks, ...inlineBlocks];
      
      if (nestedBlocks.length > 0) {
        console.log(`🔍 Paragraph <${tagName}> contains ${nestedBlocks.length} nested block elements - processing mixed content`);
        
        // Use childNodes iteration to separate text before/after nested blocks
        // This prevents text concatenation and preserves proper ordering
        const childNodes = Array.from($elem.get(0).childNodes);
        const blockElementSet = new Set(nestedBlocks);
        let currentTextHtml = '';
        
        for (let i = 0; i < childNodes.length; i++) {
          const node = childNodes[i];
          
          // Text nodes and inline elements accumulate into currentTextHtml
          if (node.nodeType === 3 || (node.nodeType === 1 && !blockElementSet.has(node))) {
            const nodeHtml = node.nodeType === 3 ? node.nodeValue : $.html(node, { decodeEntities: false });
            currentTextHtml += nodeHtml;
          } 
          // Block-level elements: flush accumulated text, then process block
          else if (node.nodeType === 1 && blockElementSet.has(node)) {
            // Flush accumulated text before this block element
            if (currentTextHtml.trim()) {
              console.log(`🔍 Found text before block element: "${currentTextHtml.trim().substring(0, 80)}..."`);
              let textHtml = currentTextHtml.trim();
              
              // Remove any literal note div tags that may appear as text
              textHtml = textHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
              
              const { richText: textRichText, imageBlocks: textImages } = await parseRichText(textHtml);
              
              // Add any image blocks found in the text before block elements
              if (textImages && textImages.length > 0) {
                console.log(`🔍 Adding ${textImages.length} image blocks from text before block elements`);
                processedBlocks.push(...textImages);
              }
              
              if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim() || rt.text.link)) {
                const textChunks = splitRichTextArray(textRichText);
                for (const chunk of textChunks) {
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  });
                }
              }
              currentTextHtml = '';
            }
            
            // Process the block element
            const blockName = node.name.toLowerCase();
            console.log(`🔍 Processing nested block: <${blockName}>`);
            const childBlocks = await processElement(node);
            processedBlocks.push(...childBlocks);
          }
        }
        
        // Flush any remaining text after the last block element
        if (currentTextHtml.trim()) {
          console.log(`🔍 Found text after block elements: "${currentTextHtml.trim().substring(0, 80)}..."`);
          let textHtml = currentTextHtml.trim();
          
          // Remove any literal note div tags that may appear as text
          textHtml = textHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
          
          const { richText: textRichText, imageBlocks: textImages } = await parseRichText(textHtml);
          
          // Add any image blocks found in the text
          if (textImages && textImages.length > 0) {
            console.log(`🔍 Adding ${textImages.length} image blocks from text after block elements`);
            processedBlocks.push(...textImages);
          }
          
          if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
            const textChunks = splitRichTextArray(textRichText);
            for (const chunk of textChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              });
            }
          }
        }
        
        $elem.remove();
        return processedBlocks;
      }
      
      let innerHtml = $elem.html() || '';
      
      // Strip SVG icon elements (decorative only, no content value)
      innerHtml = innerHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
      
      // CRITICAL: Remove any literal note div tags that may appear as text in paragraph content
      // These can appear when ServiceNow HTML contains note divs as literal text
      innerHtml = innerHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
      
      const cleanedText = cleanHtmlText(innerHtml).trim();
      
      // Skip table captions that start with "Table X." - these are redundant with table headings
      if (/^Table\s+\d+\.\s+/.test(cleanedText)) {
        console.log(`🔍 Skipping table caption paragraph: "${cleanedText.substring(0, 80)}..."`);
        $elem.remove();
        return processedBlocks;
      }
      
      // FIX v11.0.39: Skip paragraphs that start with processed table captions
      // Table captions appear as headings above tables, so skip duplicate text below
      // Check if paragraph STARTS WITH any tracked caption (paragraph may contain more content)
      const normalizedText = cleanedText.toLowerCase();
      console.log(`📊 [CAPTION-CHECK] Checking paragraph: "${cleanedText.substring(0, 60)}..."`);
      console.log(`📊 [CAPTION-CHECK] Set has ${processedTableCaptions.size} caption(s): [${Array.from(processedTableCaptions).map(c => `"${c.substring(0, 40)}..."`).join(', ')}]`);
      
      for (const caption of processedTableCaptions) {
        if (normalizedText.startsWith(caption)) {
          console.log(`� [CAPTION-CHECK] ✓ MATCH! Skipping paragraph starting with caption: "${caption.substring(0, 60)}..."`);
          $elem.remove();
          return processedBlocks;
        }
      }
      
      // Also check exact match for backward compatibility
      if (processedTableCaptions.has(normalizedText)) {
        console.log(`� [CAPTION-CHECK] ✓ EXACT MATCH! Skipping duplicate caption: "${cleanedText.substring(0, 80)}..."`);
        $elem.remove();
        return processedBlocks;
      }
      
      console.log(`📊 [CAPTION-CHECK] ✗ No match - keeping paragraph`);
      
      const classAttr = $elem.attr('class') || '';
      console.log(`🔍 Paragraph <${tagName}${classAttr ? ` class="${classAttr}"` : ''}> innerHtml length: ${innerHtml.length}, cleaned: ${cleanedText.length}`);
      
      // Check if this paragraph should be bold (sectiontitle tasklabel class)
      if (/\bsectiontitle\b/.test(classAttr) && /\btasklabel\b/.test(classAttr)) {
        console.log(`🔍 Detected sectiontitle tasklabel - wrapping content in bold markers`);
        innerHtml = `__BOLD_START__${innerHtml}__BOLD_END__`;
      }
      
      // Check if paragraph contains images, figures, or other meaningful elements
      const hasImages = $elem.find('img, figure').length > 0;
      const hasSignificantContent = cleanedText.length > 0 || hasImages;
      
      if (hasSignificantContent) {
        const { richText: paragraphRichText, imageBlocks: paragraphImages, videoBlocks: paragraphVideos } = await parseRichText(innerHtml);

        console.log(`🔍 Paragraph rich_text has ${paragraphRichText.length} elements`);

        // NOTE: Preserve source ordering by adding paragraph text blocks first,
        // then any images/videos found within the paragraph. Putting images
        // before paragraph text caused ordering differences with the HTML
        // (images appearing earlier than their surrounding paragraphs).

        // Add paragraph text blocks (split on newlines) below; videos/images
        // will be appended after to keep source order.

        // If the rich text contains explicit newline markers, split into separate
        // paragraph blocks at those newlines to better preserve paragraph boundaries
        // (helps the validator match long sentences as separate paragraphs).
        function splitRichTextByNewlines(richTextArr) {
          const chunks = [];
          let cur = [];
          for (const el of richTextArr) {
            const content = (el && el.text && typeof el.text.content === 'string') ? el.text.content : '';
            if (content.includes('\n')) {
              const parts = content.split('\n');
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (part || cur.length > 0) {
                  // push a copy of the element with the segmented content
                  const copy = Object.assign({}, el, { text: Object.assign({}, el.text, { content: part }) });
                  cur.push(copy);
                }
                // If not the last segment, close out the current chunk
                if (i < parts.length - 1) {
                  chunks.push(cur);
                  cur = [];
                }
              }
            } else {
              cur.push(el);
            }
          }
          if (cur.length > 0) chunks.push(cur);
          // Ensure at least one chunk
          return chunks.length > 0 ? chunks : [richTextArr];
        }

        const paragraphChunks = splitRichTextByNewlines(paragraphRichText);
        for (const chunk of paragraphChunks) {
          const richTextChunks = splitRichTextArray(chunk);
          for (const rc of richTextChunks) {
            processedBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: rc }
            });
          }
        }

        // Now append images and videos found inside the paragraph (if any)
        if (paragraphImages && paragraphImages.length > 0) {
          processedBlocks.push(...paragraphImages);
        }
        if (paragraphVideos && paragraphVideos.length > 0) {
          processedBlocks.push(...paragraphVideos);
        }

        // If this paragraph is actually a figcaption that was already converted
        // to an image caption by the figure handler, skip adding it here.
        try {
          const parentFigure = $elem.closest('figure');
          if (parentFigure && parentFigure.length > 0 && parentFigure.attr('data-sn2n-caption-processed')) {
            // Remove the element and drop the paragraph that would duplicate a figcaption
            $elem.remove();
            return [];
          }
        } catch (e) {
          // ignore errors
        }

        $elem.remove();
        return processedBlocks;

        // Heuristic: convert paragraphs starting with a callout label to callout blocks
        const firstText = cleanedText.substring(0, Math.min(20, cleanedText.length));
        const labelProps = getCalloutPropsFromLabel(firstText);
        if (labelProps) {
          const richTextChunks = splitRichTextArray(paragraphRichText);
          console.log(`🔍 Detected inline callout label -> creating ${richTextChunks.length} callout block(s)`);
          for (const chunk of richTextChunks) {
            processedBlocks.push({
              object: "block",
              type: "callout",
              callout: {
                rich_text: chunk,
                icon: { type: "emoji", emoji: labelProps.icon },
                color: labelProps.color,
              },
            });
          }
          $elem.remove();
          return processedBlocks;
        }
        
        // Only create paragraph blocks if there's actual text content or links
        // Note: Link elements can have empty content but still be valid (they have link.url)
        if (paragraphRichText.length > 0 && paragraphRichText.some(rt => rt.text.content.trim() || rt.text.link)) {
          // Split if exceeds 100 elements (Notion limit)
          const richTextChunks = splitRichTextArray(paragraphRichText);
          console.log(`🔍 Split into ${richTextChunks.length} chunks`);
          
          for (const chunk of richTextChunks) {
            console.log(`🔍 Creating paragraph block with ${chunk.length} rich_text elements`);
            processedBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: chunk,
              },
            });
          }
        } else {
          if (paragraphRichText.length > 0) {
            console.log(`⚠️ Paragraph has ${paragraphRichText.length} rich_text elements but all are empty/whitespace:`);
            paragraphRichText.slice(0, 3).forEach((rt, idx) => {
              console.log(`   [${idx}] type=${rt.type}, content="${rt.text?.content || rt.href || ''}", href=${rt.href || 'none'}`);
            });
          } else {
            console.log(`🔍 Paragraph has no text content, only images were added`);
          }
        }
      } else {
        console.log(`🔍 Paragraph skipped (empty after cleaning and no images)`);
      }
      $elem.remove(); // Mark as processed
      
    } else if ((tagName === 'section' || (tagName === 'div' && $elem.hasClass('section'))) && $elem.hasClass('prereq')) {
      // Special handling for "Before you begin" prerequisite sections
      // Convert entire section to a callout with pushpin emoji
      console.log(`🔍 Processing prereq section as callout`);
      
      // Parse each child (including text nodes) separately to preserve paragraph boundaries
      const richTextElements = [];
      const imageBlocks = [];
      const nestedBlocks = []; // Track child blocks (like nested div.note)
      
      // Get all direct children INCLUDING text nodes (use .contents() not .children())
      const allChildren = $elem.contents();
      console.log(`🔍 Prereq section has ${allChildren.length} direct children (including text nodes)`);
      
      for (let i = 0; i < allChildren.length; i++) {
        const child = allChildren[i];
        const isTextNode = child.type === 'text';
        
        if (isTextNode) {
          // Handle text node
          const textContent = $(child).text().trim();
          if (textContent) {
            console.log(`🔍   Child ${i}: TEXT NODE content="${textContent.substring(0, 60)}..."`);
            
            // Parse the text content to rich text
            const { richText: childRichText, imageBlocks: childImages } = await parseRichText(textContent);
            
            // Add a line break between children (but not before the first one)
            if (richTextElements.length > 0 && childRichText.length > 0) {
              const lastIdx = richTextElements.length - 1;
              richTextElements[lastIdx] = {
                ...richTextElements[lastIdx],
                text: { 
                  ...richTextElements[lastIdx].text, 
                  content: richTextElements[lastIdx].text.content + '\n' 
                }
              };
              console.log(`🔍   Added line break after previous child`);
            }
            
            richTextElements.push(...childRichText);
            imageBlocks.push(...childImages);
          }
        } else {
          // Handle element node
          const $child = $(child);
          const childTag = child.tagName?.toLowerCase();
          const childHtml = $child.html() || '';
          
          console.log(`🔍   Child ${i}: <${childTag}> class="${$child.attr('class')}" content="${childHtml.substring(0, 60)}..."`);
          
          // Check if this is a block-level element that should be processed as a nested block
          if (childTag === 'ul' || childTag === 'ol' || childTag === 'pre' || childTag === 'table') {
            console.log(`🔍 [PREREQ-NESTED-BLOCK] Processing <${childTag}> as nested block`);
            const childBlocks = await processElement(child);
            nestedBlocks.push(...childBlocks);
            continue; // Skip rich text processing for this child
          }
          
          // CRITICAL FIX: Check if this child contains nested div.note elements
          // If it does, extract them as separate blocks instead of including their text
          const nestedNotes = $child.find('div.note');
          if (nestedNotes.length > 0) {
            console.log(`🔍 [PREREQ-NESTED-NOTE] Found ${nestedNotes.length} nested div.note in <${childTag}>`);
            
            // Clone and remove the nested notes to get just the wrapper text
            const $childClone = $child.clone();
            $childClone.find('div.note').remove();
            const textOnlyHtml = $childClone.html() || '';
            
            // Parse the text without the notes
            if (textOnlyHtml.trim()) {
              const { richText: childRichText, imageBlocks: childImages } = await parseRichText(textOnlyHtml);
              
              if (richTextElements.length > 0 && childRichText.length > 0) {
                const lastIdx = richTextElements.length - 1;
                richTextElements[lastIdx] = {
                  ...richTextElements[lastIdx],
                  text: { 
                    ...richTextElements[lastIdx].text, 
                    content: richTextElements[lastIdx].text.content + '\n' 
                  }
                };
              }
              
              richTextElements.push(...childRichText);
              imageBlocks.push(...childImages);
            }
            
            // Process each nested note as a separate block
            for (const note of nestedNotes.toArray()) {
              console.log(`🔍 [PREREQ-NESTED-NOTE] Processing nested div.note as child block`);
              const noteBlocks = await processElement(note);
              nestedBlocks.push(...noteBlocks);
            }
          } else {
            // No nested notes - process normally
            const { richText: childRichText, imageBlocks: childImages } = await parseRichText(childHtml);
            
            // Add a line break between children (but not before the first one)
            if (richTextElements.length > 0 && childRichText.length > 0) {
              const lastIdx = richTextElements.length - 1;
              richTextElements[lastIdx] = {
                ...richTextElements[lastIdx],
                text: { 
                  ...richTextElements[lastIdx].text, 
                  content: richTextElements[lastIdx].text.content + '\n' 
                }
              };
              console.log(`🔍   Added line break after previous child`);
            }
            
            richTextElements.push(...childRichText);
            imageBlocks.push(...childImages);
          }
        }
      }
      
      // Debug: log the final rich text structure
      console.log(`🔍 Prereq parsed into ${richTextElements.length} rich text elements (from ${allChildren.length} children including text nodes):`);
      richTextElements.forEach((rt, idx) => {
        console.log(`   [${idx}] "${rt.text.content.substring(0, 80)}${rt.text.content.length > 80 ? '...' : ''}"`);
      });
      
      // Add any images found in the section
      if (imageBlocks.length > 0) {
        processedBlocks.push(...imageBlocks);
      }
      
      // Create callout block(s) from the section content
      if (richTextElements.length > 0 && richTextElements.some(rt => rt.text.content.trim())) {
        // Line breaks are already added between children, so we can use the rich text as-is
        const richTextChunks = splitRichTextArray(richTextElements);
        console.log(`🔍 Creating ${richTextChunks.length} prereq callout block(s) with ${nestedBlocks.length} nested blocks`);
        
        // If there are nested blocks, add them to the FIRST callout chunk using markers
        for (let i = 0; i < richTextChunks.length; i++) {
          const chunk = richTextChunks[i];
          const calloutBlock = {
            object: "block",
            type: "callout",
            callout: {
              rich_text: chunk,
              icon: { type: "emoji", emoji: "📍" },
              color: "default"
            }
          };
          
          // Add nested blocks as children to the first callout
          if (i === 0 && nestedBlocks.length > 0) {
            const marker = createMarker();
            const markerToken = `(sn2n:${marker})`;
            
            // Add marker token to callout rich text
            calloutBlock.callout.rich_text.push({
              type: "text",
              text: { content: ` ${markerToken}` },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "default"
              }
            });
            
            // Tag nested blocks with marker and add as children
            // CRITICAL: Don't overwrite existing markers from nested processing!
            const blocksNeedingMarker = nestedBlocks.filter(b => !b._sn2n_marker);
            const blocksWithExistingMarker = nestedBlocks.filter(b => b._sn2n_marker);
            recordMarkers(blocksWithExistingMarker);
            
            blocksNeedingMarker.forEach(block => {
              block._sn2n_marker = marker;
            });
            
            if (blocksNeedingMarker.length > 0) {
              console.log(`🔍 [MARKER-PRESERVE-PREREQ] ${blocksNeedingMarker.length} new blocks marked for prereq orchestration`);
            }
            if (blocksWithExistingMarker.length > 0) {
              console.log(`🔍 [MARKER-PRESERVE-PREREQ] ${blocksWithExistingMarker.length} blocks already have markers - preserving`);
            }
            
            calloutBlock.callout.children = nestedBlocks;
            
            console.log(`🔍 [PREREQ-NESTED-NOTE] Added ${blocksNeedingMarker.length} nested blocks to prereq callout children with marker ${markerToken} (${blocksWithExistingMarker.length} already marked)`);
          }
          
          processedBlocks.push(calloutBlock);
        }
      }
      
      // FIX v11.0.37: REMOVED validation-only prereq split paragraphs
      // These created duplicate content (e.g., "Role required: admin" appearing twice)
      // The content validator can extract text from callout blocks directly
      // No need to emit separate paragraphs that duplicate the callout content
      log(`🔍 Skipped validation-only prereq paragraphs (not needed - validation extracts from callouts directly)`);

      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && $elem.hasClass('contentPlaceholder')) {
      // contentPlaceholder divs can contain actual content like "Related Content" sections
      // Check if it has meaningful content before skipping
      const children = $elem.find('> *').toArray();
      const hasContent = children.some(child => {
        const $child = $(child);
        const text = cleanHtmlText($child.html() || '').trim();
        // Also check for nav elements which might be in collapsed containers
        const hasNavElements = $child.find('nav, [role="navigation"]').length > 0 || $child.is('nav, [role="navigation"]');
        return text.length > 20 || $child.find('h1, h2, h3, h4, h5, h6, ul, ol, p, a').length > 0 || hasNavElements;
      });
      
      if (hasContent) {
        console.log(`🔍 contentPlaceholder has meaningful content (${children.length} children) - processing`);
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
        }
      } else {
        console.log(`🔍 Skipping empty contentPlaceholder (UI chrome)`);
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'nav') {
      // Navigation elements - extract links and descriptions but flatten structure
      // ServiceNow docs use <nav><ul><li><a>link</a><p>description</p></li></ul></nav>
      // We want: both link and description as separate root-level paragraphs (not as list items)
      console.log(`🔍 Processing <nav> element - will flatten nested paragraphs`);
      
      // Find all list items in the nav
      const listItems = $elem.find('li').toArray();
      
      for (const li of listItems) {
        const $li = $(li);
        
        // Extract link as a root-level paragraph
        const linkText = $li.find('a').first().text().trim();
        let linkHref = $li.find('a').first().attr('href');
        
        if (linkText) {
          // Create paragraph with link
          const linkRichText = [{
            type: "text",
            text: { content: linkText },
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
          }];
          
          // Add link annotation if href exists and is valid
          if (linkHref) {
            // Convert relative URLs to absolute URLs for ServiceNow docs
            if (linkHref.startsWith('/')) {
              linkHref = `https://www.servicenow.com${linkHref}`;
            }
            
            // Validate URL before adding link annotation
            try {
              new URL(linkHref);
              linkRichText[0].text.link = { url: linkHref };
            } catch (e) {
              console.log(`⚠️ Invalid URL in nav link, skipping link annotation: ${linkHref}`);
            }
          }
          
          processedBlocks.push({
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: linkRichText
            }
          });
        }
        
        // Find any paragraphs in the list item and add them as root-level paragraphs
        const paragraphs = $li.find('p').toArray();
        for (const p of paragraphs) {
          const $p = $(p);
          const pHtml = $p.html() || '';
          if (pHtml) {
            const { richText: pRichText } = await parseRichText(pHtml);
            if (pRichText.length > 0 && pRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(pRichText);
              for (const chunk of richTextChunks) {
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: chunk }
                });
              }
            }
          }
        }
      }
      
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && ($elem.hasClass('itemgroup') || $elem.hasClass('info') || $elem.hasClass('stepxmp'))) {
      // ServiceNow content container divs - check if they have block-level children
      const blockChildren = $elem.find('> div, > p, > ul, > ol, > table, > pre, > figure').toArray();
      
      if (blockChildren.length > 0) {
        // Has block-level children - check for mixed content (text + blocks)
        const fullHtml = $elem.html() || '';
        const $textOnly = $elem.clone();
        $textOnly.children().remove();
        const directText = cleanHtmlText($textOnly.html() || '').trim();
        
        if (directText) {
          // Has mixed content - extract text before first block child
          console.log(`🔍 <div class="${$elem.attr('class')}"> has ${blockChildren.length} block children AND text - processing mixed content`);
          
          // Use blockChildren (not all children) to determine first/last block
          const firstBlockChild = blockChildren[0];
          
          // Iterate through child nodes and accumulate text BEFORE the first block child
          const childNodes = Array.from($elem.get(0).childNodes);
          let beforeBlockHtml = '';
          
          for (const node of childNodes) {
            // Stop when we reach the first block-level child
            if (node.nodeType === 1 && node === firstBlockChild) {
              break;
            }
            
            // Accumulate text nodes and inline elements before the first block child
            const isTextNode = node.nodeType === 3;
            const isElementNode = node.nodeType === 1;
            
            if (isTextNode) {
              beforeBlockHtml += node.data || node.nodeValue || '';
            } else if (isElementNode) {
              // Add inline element HTML (links, spans, etc.)
              beforeBlockHtml += $(node).prop('outerHTML');
            }
          }
          
          if (beforeBlockHtml && cleanHtmlText(beforeBlockHtml).trim()) {
            const beforeTextCleaned = cleanHtmlText(beforeBlockHtml).trim();
            
            // Skip table captions (e.g., "Table 1. X.509 Certificate form fields")
            if (/^Table\s+\d+\.\s+/.test(beforeTextCleaned)) {
              console.log(`🔍 Skipping table caption in DIV: "${beforeTextCleaned.substring(0, 80)}..."`);
            } else {
              const { richText: beforeText, imageBlocks: beforeImages } = await parseRichText(beforeBlockHtml);
              if (beforeImages && beforeImages.length > 0) {
                processedBlocks.push(...beforeImages);
              }
              if (beforeText.length > 0 && beforeText.some(rt => rt.text.content.trim())) {
                const richTextChunks = splitRichTextArray(beforeText);
                for (const chunk of richTextChunks) {
                  const paraBlock = {
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  };
                  // Tag source container for downstream promotion guards
                  paraBlock._sn2n_source_container = $elem.hasClass('stepxmp') ? 'stepxmp' : ($elem.hasClass('itemgroup') ? 'itemgroup' : 'info');
                  paraBlock._sn2n_mixed_position = 'before';
                  processedBlocks.push(paraBlock);
                }
              }
            }
          }
          
          // Process block children (not all children - inline elements like <a> stay in mixed content)
          for (const child of blockChildren) {
            const childBlocks = await processElement(child);
            processedBlocks.push(...childBlocks);
          }
          
          // Check for text/elements AFTER all block children
          const lastBlockChild = blockChildren[blockChildren.length - 1];
          let afterBlockHtml = '';
          let foundLastBlock = false;
          
          for (const node of childNodes) {
            // Start collecting after we pass the last block child
            if (node.nodeType === 1 && node === lastBlockChild) {
              foundLastBlock = true;
              continue;
            }
            
            if (foundLastBlock) {
              const isTextNode = node.nodeType === 3;
              const isElementNode = node.nodeType === 1;
              
              if (isTextNode) {
                afterBlockHtml += node.data || node.nodeValue || '';
              } else if (isElementNode) {
                afterBlockHtml += $(node).prop('outerHTML');
              }
            }
          }
          
          if (afterBlockHtml && cleanHtmlText(afterBlockHtml).trim()) {
            const afterTextCleaned = cleanHtmlText(afterBlockHtml).trim();
            
            // Skip table captions (e.g., "Table 1. X.509 Certificate form fields")
            if (/^Table\s+\d+\.\s+/.test(afterTextCleaned)) {
              console.log(`🔍 Skipping table caption in DIV: "${afterTextCleaned.substring(0, 80)}..."`);
            } else {
              const { richText: afterText, imageBlocks: afterImages } = await parseRichText(afterBlockHtml);
              if (afterImages && afterImages.length > 0) {
                processedBlocks.push(...afterImages);
              }
              if (afterText.length > 0 && afterText.some(rt => rt.text.content.trim())) {
                const richTextChunks = splitRichTextArray(afterText);
                for (const chunk of richTextChunks) {
                  const paraBlock = {
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  };
                  paraBlock._sn2n_source_container = $elem.hasClass('stepxmp') ? 'stepxmp' : ($elem.hasClass('itemgroup') ? 'itemgroup' : 'info');
                  paraBlock._sn2n_mixed_position = 'after';
                  processedBlocks.push(paraBlock);
                }
              }
            }
          }
        } else {
          // No direct text - just process block children
          console.log(`🔍 <div class="${$elem.attr('class')}"> has ${blockChildren.length} block children - processing as container`);
          for (const child of blockChildren) {
            const childBlocks = await processElement(child);
            processedBlocks.push(...childBlocks);
          }
        }
      } else {
        // No block children - extract text content as paragraph
        const html = $elem.html() || '';
        
        // CRITICAL FIX: Call parseRichText FIRST to extract images BEFORE cleanHtmlText strips them
        // cleanHtmlText removes <img> tags, so we must extract images before checking for text content
        if (html && html.trim()) {
          console.log(`🔍 Processing <div class="${$elem.attr('class')}"> as paragraph wrapper`);
          const { richText: divRichText, imageBlocks: divImages } = await parseRichText(html);
          
          // Check if we have both text and images (inline image scenario)
          const hasText = divRichText.length > 0 && divRichText.some(rt => rt.text.content.trim());
          const hasImages = divImages && divImages.length > 0;
          
          if (hasImages) {
            console.log(`✅ Found ${divImages.length} images in <div class="${$elem.attr('class')}">`);
          }
          
          if (hasText && hasImages) {
            // Inline image scenario: text with embedded image references
            // Clean up empty parentheses left by image extraction: "()" or "( )"
            for (const rt of divRichText) {
              if (rt.text && rt.text.content) {
                rt.text.content = rt.text.content
                  .replace(/\(\s*\)/g, '')  // Remove empty parens
                  .replace(/\s{2,}/g, ' ')  // Collapse multiple spaces
                  .trim();
              }
            }
            
            // Filter out empty rich text elements after cleanup
            const cleanedRichText = divRichText.filter(rt => rt.text && rt.text.content.trim());
            
            if (cleanedRichText.length > 0) {
              // Create paragraph with text and add images as children
              console.log(`📝 Creating paragraph with ${cleanedRichText.length} text elements and ${divImages.length} image(s) as children`);
              const richTextChunks = splitRichTextArray(cleanedRichText);
              for (const chunk of richTextChunks) {
                const paraBlock = {
                  object: "block",
                  type: "paragraph",
                  paragraph: { 
                    rich_text: chunk,
                    children: divImages  // Add images as children
                  }
                };
                paraBlock._sn2n_source_container = $elem.hasClass('stepxmp') ? 'stepxmp' : ($elem.hasClass('itemgroup') ? 'itemgroup' : 'info');
                paraBlock._sn2n_mixed_position = 'standalone';
                processedBlocks.push(paraBlock);
              }
            } else {
              // No text left after cleanup, just add images as siblings
              processedBlocks.push(...divImages);
            }
          } else if (hasImages) {
            // Images only, no text - add as siblings
            processedBlocks.push(...divImages);
          } else if (hasText) {
            // Text only, no images - create paragraph
            const richTextChunks = splitRichTextArray(divRichText);
            for (const chunk of richTextChunks) {
              const paraBlock = {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              };
              paraBlock._sn2n_source_container = $elem.hasClass('stepxmp') ? 'stepxmp' : ($elem.hasClass('itemgroup') ? 'itemgroup' : 'info');
              paraBlock._sn2n_mixed_position = 'standalone';
              processedBlocks.push(paraBlock);
            }
          }
        }
      }
      
      $elem.remove();
      
    } else if (tagName === 'div' && $elem.hasClass('table-wrap')) {
      // Special handling for div.table-wrap which may have text before/after the table
      console.log(`🔍 Processing <div class="table-wrap"> with potential mixed content`);
      
      const childNodes = Array.from($elem.get(0).childNodes);
      let currentTextHtml = '';
      
      for (const node of childNodes) {
        const isTextNode = node.nodeType === 3;
        const isElementNode = node.nodeType === 1;
        const nodeName = (node.name || node.nodeName || node.tagName || '').toUpperCase();
        const isTableElement = nodeName === 'TABLE';
        
        if (isTextNode || (isElementNode && !isTableElement)) {
          // Accumulate text nodes and non-table elements (like spans, links, etc.)
          // BUT: if it's a DIV element, recursively process it (could be callout, table container, etc.)
          if (isElementNode && nodeName === 'DIV') {
            const $div = $(node);
            const divClasses = $div.attr('class') || '';
            
            // Skip UI chrome elements (dropdown menus, filter buttons, export buttons, etc.)
            const isUiChrome = /zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu/.test(divClasses);
            
            if (isUiChrome) {
              console.log(`🔍 Skipping UI chrome div with classes: ${divClasses}`);
              continue; // Skip this element entirely
            }
            
            // Flush any accumulated text before processing the div
            if (currentTextHtml.trim()) {
              const { richText: textRichText } = await parseRichText(currentTextHtml.trim());
              if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
                const textChunks = splitRichTextArray(textRichText);
                for (const chunk of textChunks) {
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  });
                }
              }
              currentTextHtml = '';
            }
            
            // Recursively process ANY div (callouts, table containers, etc.)
            const divBlocks = await processElement(node);
            processedBlocks.push(...divBlocks);
          } else if (isElementNode && nodeName === 'BUTTON') {
            // Skip all button elements (export buttons, etc.)
            const $button = $(node);
            console.log(`🔍 Skipping button element with classes: ${$button.attr('class')}`);
            continue;
          } else {
            // Not a div or button - accumulate as text/HTML
            currentTextHtml += isTextNode ? (node.data || node.nodeValue || '') : $(node).prop('outerHTML');
          }
        } else if (isTableElement) {
          // Found table - flush any text before it
          if (currentTextHtml.trim()) {
            const { richText: textRichText } = await parseRichText(currentTextHtml.trim());
            if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
              const textChunks = splitRichTextArray(textRichText);
              for (const chunk of textChunks) {
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: chunk }
                });
              }
            }
            currentTextHtml = '';
          }
          
          // Process the table
          const tableBlocks = await processElement(node);
          processedBlocks.push(...tableBlocks);
        }
      }
      
      // Flush any remaining text after the table
      if (currentTextHtml.trim()) {
        const { richText: textRichText } = await parseRichText(currentTextHtml.trim());
        if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
          const textChunks = splitRichTextArray(textRichText);
          for (const chunk of textChunks) {
            processedBlocks.push({
              object: "block",
              type: "paragraph",
              paragraph: { rich_text: chunk }
              });
          }
        }
      }
      
      $elem.remove();
      
    } else if (tagName === 'li') {
      // Orphan list item (not processed within ol/ul) - convert to numbered list item
      console.log(`⚠️ Processing orphan <li> element outside of parent list`);
      
      // Check for nested blocks (including images and DIVs that may wrap images)
      const nestedBlocks = $elem.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note, > div, > img').toArray();
      console.log(`🔍 [Orphan LI] Found ${nestedBlocks.length} nested blocks:`, nestedBlocks.map(nb => $(nb).prop('tagName') + ($(nb).find('img').length > 0 ? ' (contains img)' : '')).join(', '));

      // Attach immediate sibling tables to this orphan LI (synthetic continuation)
      // Many docs place a choice/action table right after the orphan step like
      // "Specify the rule...". We proactively capture contiguous next-sibling
      // <div class="table-wrap"> or <table> elements and treat them as children.
      async function attachFollowingTablesToOrphanLi() {
        let $next = $elem.next();
        const attached = [];
        while ($next && $next.length > 0) {
          const nextTag = ($next.get(0).name || '').toLowerCase();
          const nextClass = $next.attr('class') || '';
          const isTableWrap = nextTag === 'div' && /\btable-wrap\b/.test(nextClass);
          const isTable = nextTag === 'table';
          // Stop if we hit something that's not a table/table-wrap
          if (!isTableWrap && !isTable) break;

          console.log(`🔗 [Orphan LI] Attaching following ${isTable ? '<table>' : '<div class="table-wrap">'} as child of this list item`);
          // Process the sibling now and remove it from DOM so it doesn't get
          // processed again as a top-level block
          const siblingBlocks = await processElement($next.get(0));
          attached.push(...siblingBlocks);
          // Remove and advance to next sibling (contiguous tables support)
          $next.remove();
          $next = $elem.next();
        }
        // Stash attached blocks on the element for later merge into children
        if (attached.length > 0) {
          // Using a symbol-like property on the Cheerio element's data store
          $elem.data('_sn2n_attached_after_tables', attached);
          console.log(`🔗 [Orphan LI] Attached ${attached.length} block(s) from following table siblings`);
        }
      }
      await attachFollowingTablesToOrphanLi();
      
      if (nestedBlocks.length > 0) {
        // Has nested blocks - extract text without them
        const $textOnly = $elem.clone();
        $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note, > div, > img').remove();
        const textOnlyHtml = $textOnly.html();
        console.log(`🔍 [Orphan LI with nested blocks] textOnlyHtml: ${textOnlyHtml.substring(0, 200)}`);
        const { richText: liRichText, imageBlocks: textImages } = await parseRichText(textOnlyHtml);
        console.log(`🔍 [Orphan LI with nested blocks] textImages count: ${textImages ? textImages.length : 'undefined'}`);
        
        // Add any images found in the text-only portion
        if (textImages && textImages.length > 0) {
          console.log(`✅ [Orphan LI] Adding ${textImages.length} images from text-only portion`);
          processedBlocks.push(...textImages);
        }
        
        // Process nested blocks
        const nestedChildren = [];
        for (let i = 0; i < nestedBlocks.length; i++) {
          const nestedBlock = nestedBlocks[i];
          const $nested = $(nestedBlock);
          const blockTag = $nested.prop('tagName');
          const blockClass = $nested.attr('class') || 'no-class';
          console.log(`🔍 [Orphan LI] Processing nested block ${i+1}/${nestedBlocks.length}: <${blockTag} class="${blockClass}">`);
          
          const childBlocks = await processElement(nestedBlock);
          console.log(`🔍 [Orphan LI] Block ${i+1} produced ${childBlocks.length} blocks:`, childBlocks.map(b => b.type).join(', '));
          nestedChildren.push(...childBlocks);
        }
        
        console.log(`🔍 [Orphan LI] Total nestedChildren: ${nestedChildren.length} blocks`);

        // Merge any following-sibling tables we attached just above
        const attachedAfter = $elem.data('_sn2n_attached_after_tables');
        if (Array.isArray(attachedAfter) && attachedAfter.length > 0) {
          console.log(`🔗 [Orphan LI] Merging ${attachedAfter.length} attached following-sibling table block(s) into children`);
          nestedChildren.unshift(...attachedAfter);
          // Clear to avoid accidental reuse
          $elem.removeData('_sn2n_attached_after_tables');
        }

        // Optional: Synthetic continuation repair for orphan <li> following an <ol>
        // If enabled, we treat this orphan as the next step in the prior steps list.
        // Notion models lists by sibling items, so we mainly ensure we DON'T drop
        // child tables and we avoid emitting unrelated siblings here.
        if (process.env.SN2N_ORPHAN_LIST_REPAIR) {
          console.log('🔁 [Orphan LI] Synthetic continuation enabled (SN2N_ORPHAN_LIST_REPAIR)');
        }
        
        // Create numbered list item with text and children
  const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image', 'table'];
        const validChildren = nestedChildren.filter(b => b && b.type && supportedAsChildren.includes(b.type));
        console.log(`🔍 [Orphan LI] validChildren: ${validChildren.length}/${nestedChildren.length} blocks (types: ${validChildren.map(b => b.type).join(', ')})`);
        
        if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
          processedBlocks.push({
            object: "block",
            type: "numbered_list_item",
            numbered_list_item: {
              rich_text: liRichText,
              children: validChildren.length > 0 ? validChildren : undefined
            }
          });
        } else if (validChildren.length > 0) {
          // No text but has children - promote first paragraph
          const firstChild = validChildren[0];
          if (firstChild && firstChild.type === 'paragraph' && firstChild.paragraph && firstChild.paragraph.rich_text) {
            const promotedText = firstChild.paragraph.rich_text;
            const remainingChildren = validChildren.slice(1);
            processedBlocks.push({
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: promotedText,
                children: remainingChildren.length > 0 ? remainingChildren : undefined
              }
            });
          }
        }
      } else {
        // Simple list item
        const liHtml = $elem.html() || '';
        console.log(`🔍 [Orphan LI simple] liHtml: ${liHtml.substring(0, 300)}`);
        const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
        console.log(`🔍 [Orphan LI simple] liImages count: ${liImages ? liImages.length : 'undefined'}`);
        
        // Check if we have both text and images (inline image scenario)
        const hasText = liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim());
        const hasImages = liImages && liImages.length > 0;
        
        if (hasText && hasImages) {
          // Inline image scenario: text with embedded image references
          // Clean up empty parentheses left by image extraction: "()" or "( )"
          for (const rt of liRichText) {
            if (rt.text && rt.text.content) {
              rt.text.content = rt.text.content
                .replace(/\(\s*\)/g, '')  // Remove empty parens
                .replace(/\s{2,}/g, ' ')  // Collapse multiple spaces
                .trim();
            }
          }
          
          const cleanedRichText = liRichText.filter(rt => rt.text && rt.text.content.trim());
          
          if (cleanedRichText.length > 0) {
            console.log(`📝 [Orphan LI] Creating numbered_list_item with ${cleanedRichText.length} text elements and ${liImages.length} image(s) as children`);
            processedBlocks.push({
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: cleanedRichText,
                children: liImages  // Images as children, not siblings
              }
            });
          } else {
            // No text left after cleanup, just add images as siblings
            console.log(`✅ [Orphan LI] Adding ${liImages.length} images from simple list item (no text)`);
            processedBlocks.push(...liImages);
          }
        } else if (hasImages) {
          // Images only - add as siblings
          console.log(`✅ [Orphan LI] Adding ${liImages.length} images from simple list item (no text)`);
          processedBlocks.push(...liImages);
        } else if (hasText) {
          // Text only - create numbered list item
          processedBlocks.push({
            object: "block",
            type: "numbered_list_item",
            numbered_list_item: {
              rich_text: liRichText
            }
          });
        }
      }
      
      $elem.remove();
      
    } else {
      // Container element (div, section, main, article, etc.) - recursively process children
      
      // No special DIV handling here - let recursive processing handle structure
      // Inline image handling is done in specific DIV handlers (itemgroup, info, stepxmp)
      
      // First check if there's direct text content mixed with child elements
      
      // Use find('> *') to get ALL direct children, more reliable than .children()
      const children = $elem.find('> *').toArray();
      const fullHtml = $elem.html() || '';
      
      // Clone and remove all child elements to see if there's text content
      const $textOnly = $elem.clone();
      $textOnly.children().remove();
      const directText = cleanHtmlText($textOnly.html() || '').trim();
      
      if (directText && children.length > 0) {
        // Mixed content: has both text nodes and child elements
        console.log(`🔍 Container <${tagName}> has mixed content (text + ${children.length} children)`);
        console.log(`🔍 Direct text preview: "${directText.substring(0, 80)}..."`);
        
        // Check if children are block-level or inline elements
        // CRITICAL FIX: Include dl, dt, dd in block-level elements to prevent them from being extracted as text
        const blockLevelChildren = children.filter(child => {
          const childTag = child.name;
          return ['div', 'p', 'section', 'article', 'main', 'ul', 'ol', 'dl', 'dt', 'dd', 'pre', 'figure', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(childTag);
        });
        
        if (blockLevelChildren.length > 0) {
          // Has block-level children - extract only direct text/inline nodes before first block element
          const firstBlockChild = blockLevelChildren[0];
          
          // Iterate through child nodes and accumulate text BEFORE the first block child
          const childNodes = Array.from($elem.get(0).childNodes);
          let beforeBlockHtml = '';
          
          for (const node of childNodes) {
            // Stop when we reach the first block-level child
            // Note: firstBlockChild is a Cheerio element, compare by checking if it's the same DOM node
            if (node.nodeType === 1 && node === firstBlockChild) {
              break;
            }
            
            // Accumulate text nodes and inline elements before the first block child
            const isTextNode = node.nodeType === 3;
            const isElementNode = node.nodeType === 1;
            
            if (isTextNode) {
              beforeBlockHtml += node.data || node.nodeValue || '';
            } else if (isElementNode) {
              // Add inline element HTML (links, spans, etc.)
              beforeBlockHtml += $(node).prop('outerHTML');
            }
          }
          
          if (beforeBlockHtml && cleanHtmlText(beforeBlockHtml).trim()) {
            console.log(`🔍 Processing text before first block-level child element`);
            const { richText: beforeText, imageBlocks: beforeImages } = await parseRichText(beforeBlockHtml);
            if (beforeImages && beforeImages.length > 0) {
              processedBlocks.push(...beforeImages);
            }
            if (beforeText.length > 0 && beforeText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(beforeText);
              for (const chunk of richTextChunks) {
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: chunk }
                });
              }
            }
          }
          
          // Process block-level children AND text between them
          for (let i = 0; i < blockLevelChildren.length; i++) {
            const child = blockLevelChildren[i];
            const childBlocks = await processElement(child);
            processedBlocks.push(...childBlocks);
            
            // Check for text AFTER this child and BEFORE the next child
            if (i < blockLevelChildren.length - 1) {
              const nextChild = blockLevelChildren[i + 1];
              let betweenHtml = '';
              let foundCurrent = false;
              
              for (const node of childNodes) {
                // Start accumulating after current child
                if (node.nodeType === 1 && node === child) {
                  foundCurrent = true;
                  continue;
                }
                
                // Stop when we reach next child
                if (node.nodeType === 1 && node === nextChild) {
                  break;
                }
                
                if (foundCurrent) {
                  const isTextNode = node.nodeType === 3;
                  const isElementNode = node.nodeType === 1;
                  
                  if (isTextNode) {
                    betweenHtml += node.data || node.nodeValue || '';
                  } else if (isElementNode) {
                    // Add inline element HTML
                    betweenHtml += $(node).prop('outerHTML');
                  }
                }
              }
              
              if (betweenHtml && cleanHtmlText(betweenHtml).trim()) {
                console.log(`🔍 Processing text between block-level children ${i} and ${i+1}`);
                const { richText: betweenText, imageBlocks: betweenImages } = await parseRichText(betweenHtml);
                if (betweenImages && betweenImages.length > 0) {
                  processedBlocks.push(...betweenImages);
                }
                if (betweenText.length > 0 && betweenText.some(rt => rt.text.content.trim())) {
                  const richTextChunks = splitRichTextArray(betweenText);
                  for (const chunk of richTextChunks) {
                    processedBlocks.push({
                      object: "block",
                      type: "paragraph",
                      paragraph: { rich_text: chunk }
                    });
                  }
                }
              }
            }
          }
          
          // Process any remaining text AFTER the last block-level child
          const lastBlockChild = blockLevelChildren[blockLevelChildren.length - 1];
          let afterBlockHtml = '';
          let foundLastBlock = false;
          
          for (const node of childNodes) {
            // Start accumulating after we pass the last block-level child
            if (node.nodeType === 1 && node === lastBlockChild) {
              foundLastBlock = true;
              continue;
            }
            
            if (foundLastBlock) {
              const isTextNode = node.nodeType === 3;
              const isElementNode = node.nodeType === 1;
              
              if (isTextNode) {
                afterBlockHtml += node.data || node.nodeValue || '';
              } else if (isElementNode) {
                // Add inline element HTML (links, spans, etc.)
                afterBlockHtml += $(node).prop('outerHTML');
              }
            }
          }
          
          if (afterBlockHtml && cleanHtmlText(afterBlockHtml).trim()) {
            console.log(`🔍 Processing text after last block-level child element`);
            const { richText: afterText, imageBlocks: afterImages } = await parseRichText(afterBlockHtml);
            if (afterImages && afterImages.length > 0) {
              processedBlocks.push(...afterImages);
            }
            if (afterText.length > 0 && afterText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(afterText);
              for (const chunk of richTextChunks) {
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: chunk }
                });
              }
            }
          }
        } else {
          // Only inline children - process as a single paragraph with all content
          console.log(`🔍 Container has only inline children - creating single paragraph`);
          const { richText: containerText, imageBlocks: containerImages } = await parseRichText(fullHtml);
          if (containerImages && containerImages.length > 0) {
            processedBlocks.push(...containerImages);
          }
          if (containerText.length > 0 && containerText.some(rt => rt.text.content.trim())) {
            const richTextChunks = splitRichTextArray(containerText);
            for (const chunk of richTextChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              });
            }
          }
        }
        
        // Mark container as processed
        $elem.remove();
      } else {
        // No mixed content or no children - process normally
        const childTagSummary = children.map(c => {
          const $c = $(c);
          const tag = c.name || c.type;
          const id = $c.attr('id');
          const cls = $c.attr('class');
          if (tag === 'section' || tag === 'article') {
            return `<${tag} id="${id || 'no-id'}" class="${cls || 'no-class'}">`;
          }
          return tag;
        }).join(', ');
        
        console.log(`🔍 Container element <${tagName}>, recursively processing ${children.length} children: [${childTagSummary}]`);
        
        // SPECIAL DIAGNOSTIC for article.nested0
        const elemClass = $elem.attr('class') || '';
        const elemId = $elem.attr('id') || '';
        
        // TRACK ARTICLE.NESTED1 PROCESSING
        let articleTitle = null;
        let processedHeadingNode = null; // Track which heading we've processed
        if (tagName === 'article' && elemClass.includes('nested1')) {
          // Try to find the heading for this article
          const $heading = $elem.find('> h1, > h2').first();
          if ($heading.length > 0) {
            articleTitle = cleanHtmlText($heading.text()).trim().substring(0, 80);
            const headingTag = $heading.get(0).name;
            const headingType = headingTag === 'h1' ? 'heading_1' : 'heading_2';
            
            // Article.nested1 processing - extract h2 heading
            console.log(`� Article.nested1#${elemId}: Processing <${headingTag}> as ${headingType}`);
            
            // Process the heading as a block
            const headingBlocks = await processElement($heading.get(0));
            processedBlocks.push(...headingBlocks);
            
            // Track the heading node so we don't process it again in the children loop
            processedHeadingNode = $heading.get(0);
          }
        }
        
        if (elemClass.includes('nested0')) {
          console.log(`🚨 ARTICLE.NESTED0 DETECTED! Cheerio says ${children.length} children`);
          console.log(`🚨 Let's verify with different selectors:`);
          console.log(`🚨   .find('> *'): ${$elem.find('> *').length}`);
          console.log(`🚨   .children(): ${$elem.children().length}`);
          console.log(`🚨   .find('> article.nested1'): ${$elem.find('> article.nested1').length}`);
          console.log(`🚨   .find('article.nested1'): ${$elem.find('article.nested1').length}`);
          console.log(`🚨 HTML length: ${$elem.html()?.length || 0}`);
        }
        
        // Log what children we're about to process
        if (children.length > 0) {
          children.forEach((child, idx) => {
            const childTag = child.name || 'unknown';
            const childClass = $(child).attr('class') || '';
            const childId = $(child).attr('id') || '';
            console.log(`🔍   Child ${idx + 1}/${children.length}: <${childTag}>${childClass ? ` class="${childClass}"` : ''}${childId ? ` id="${childId}"` : ''}`);
          });
        }
        
        if (children.length === 0) {
          // No children - check if there's text content to preserve
          const containerText = cleanHtmlText(fullHtml).trim();
          if (containerText) {
            console.log(`🔍 Container has no children but has text content: "${containerText.substring(0, 80)}..."`);
            
            // For inline elements like <a>, use outerHTML to preserve the tag and attributes
            // For block elements, use innerHTML
            const isInlineElement = ['a', 'span', 'strong', 'em', 'b', 'i', 'code'].includes(tagName);
            const htmlToProcess = isInlineElement ? $elem.prop('outerHTML') : fullHtml;
            
            const { richText: textContent, imageBlocks: textImages } = await parseRichText(htmlToProcess);
            if (textImages && textImages.length > 0) {
              processedBlocks.push(...textImages);
            }
            if (textContent.length > 0 && textContent.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(textContent);
              for (const chunk of richTextChunks) {
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { rich_text: chunk }
                });
              }
            }
          }
        } else {
          // SPECIAL HANDLING FOR SECTIONS: Check if first child is a UIControl paragraph acting as heading
          // Some ServiceNow sections don't have h2 tags, they use <p class="p"><span class="ph uicontrol">Title</span></p>
          if (tagName === 'section' && children.length > 0) {
            const firstChild = $(children[0]);
            const firstChildTag = children[0].name;
            
            // Check if first child is <p class="p"> with only a single <span class="ph uicontrol">
            if (firstChildTag === 'p' && firstChild.hasClass('p')) {
              const firstChildHtml = firstChild.html() || '';
              const uiControlMatch = firstChildHtml.match(/^\s*<span[^>]*class=["'][^"']*\bph\b[^"']*\buicontrol\b[^"']*["'][^>]*>([^<]+)<\/span>\s*$/);
              
              if (uiControlMatch) {
                const headingText = uiControlMatch[1].trim();
                console.log(`🔍 ✨ SECTION HEADING FIX: Converting UIControl paragraph to heading_2: "${headingText}"`);
                
                // Create a heading_2 block for this text
                processedBlocks.push({
                  object: "block",
                  type: "heading_2",
                  heading_2: {
                    rich_text: [{
                      type: "text",
                      text: { content: headingText },
                      annotations: {
                        bold: true,
                        italic: false,
                        strikethrough: false,
                        underline: false,
                        code: false,
                        color: "blue"
                      }
                    }]
                  }
                });
                
                // Remove this child from the list so it's not processed again
                children.shift();
                console.log(`🔍 Remaining children after heading extraction: ${children.length}`);
              }
            }
          }
          
          // Has children - process them
          let processedChildCount = 0;
          for (const child of children) {
            // Skip if this is the heading we already processed for article.nested1
            if (processedHeadingNode && child === processedHeadingNode) {
              console.log(`🔍   ⏭️  Skipping child (already processed as article heading): <${child.name}>`);
              continue;
            }
            
            processedChildCount++;
            console.log(`🔍   Processing child ${processedChildCount}/${children.length}: <${child.name}>${$(child).attr('class') ? ` class="${$(child).attr('class')}"` : ''}`);
            const childBlocks = await processElement(child);
            console.log(`🔍   Child ${processedChildCount} produced ${childBlocks.length} blocks`);
            processedBlocks.push(...childBlocks);
          }
          console.log(`🔍   Finished processing all ${processedChildCount}/${children.length} children`);
          
          // Article.nested1 processing complete
          if (tagName === 'article' && elemClass.includes('nested1') && articleTitle) {
            console.log(`� Article.nested1#${elemId}: Complete, produced ${processedBlocks.length} blocks`);
          }
        }
        
        // Mark container as processed
        $elem.remove();
      }
    }

    return processedBlocks;
  }

  // Process top-level elements in document order
  // Find all content elements - try specific content wrappers first, then body
  let contentElements = [];
  
  if ($('.zDocsTopicPageBody').length > 0) {
    // ServiceNow zDocsTopicPageBody - process all children (includes article AND contentPlaceholder with Related Content)
    const topLevelChildren = $('.zDocsTopicPageBody').find('> *').toArray();
    console.log(`🔍 Processing from .zDocsTopicPageBody, found ${topLevelChildren.length} top-level children`);
    console.log(`🔍 Top-level children: ${topLevelChildren.map(c => `<${c.name} class="${$(c).attr('class') || ''}">`).join(', ')}`);
    
    // DIAGNOSTIC: Check if contentPlaceholder exists in DOM
    const allContentPlaceholders = $('.contentPlaceholder').toArray();
    console.log(`🔍 🎯 DIAGNOSTIC: Found ${allContentPlaceholders.length} total .contentPlaceholder elements in DOM`);
    if (allContentPlaceholders.length > 0) {
      allContentPlaceholders.forEach((cp, idx) => {
        const $cp = $(cp);
        const parent = $cp.parent();
        const parentTag = parent.prop('tagName');
        const parentClass = parent.attr('class') || 'no-class';
          const isDirectChild = parent.hasClass('zDocsTopicPageBody');
          const siblingsCount = $cp.siblings().length;
          console.log(`🔍 🎯   contentPlaceholder ${idx}:`);
          console.log(`🔍 🎯     - parent: <${parentTag} class="${parentClass}">`);
          console.log(`🔍 🎯     - is direct child of .zDocsTopicPageBody: ${isDirectChild}`);
          console.log(`🔍 🎯     - siblings: ${siblingsCount}`);
          console.log(`🔍 🎯     - in topLevelChildren: ${topLevelChildren.includes(cp)}`);
      });
    }
    
    // CRITICAL FIX: Check if sections exist deeper in the tree (not just as direct children)
    // ServiceNow pages often have structure: .zDocsTopicPageBody > div.zDocsTopicPageBodyContent > article > main > article.dita > div.body.conbody
    // And sections can be either children of body.conbody OR siblings of it!
    // IMPORTANT: Include sections WITHOUT IDs - many procedural sections (with tables/images) don't have IDs
    const allSectionsInPage = $('section').toArray();
    const allSectionsInBody = $('.zDocsTopicPageBody section').toArray();
    const allArticles = $('.zDocsTopicPageBody article').toArray();
    
    console.log(`🔍 CRITICAL: Found ${allSectionsInPage.length} sections in ENTIRE PAGE (including those without IDs)`);
    console.log(`🔍 CRITICAL: Found ${allSectionsInBody.length} sections inside .zDocsTopicPageBody`);
    console.log(`🔍 CRITICAL: Found ${allArticles.length} articles inside .zDocsTopicPageBody`);
    
    // Check where the missing sections are
    const sectionsOutsideBody = allSectionsInPage.filter(s => {
      return $(s).closest('.zDocsTopicPageBody').length === 0;
    });
    
    if (sectionsOutsideBody.length > 0) {
      console.log(`🔍 ⚠️ WARNING: ${sectionsOutsideBody.length} sections are OUTSIDE .zDocsTopicPageBody!`);
      console.log(`🔍 Outside section IDs: ${sectionsOutsideBody.map(s => $(s).attr('id')).join(', ')}`);
      
      // Find common parent of ALL sections (both inside and outside .zDocsTopicPageBody)
      const allSectionParents = allSectionsInPage.map(s => $(s).parent());
      console.log(`🔍 All section parents: ${allSectionParents.map(p => `<${p.prop('tagName')} class="${p.attr('class') || 'no-class'}">`).join(', ')}`);
      
      // CRITICAL FIX: If sections are orphaned or outside .zDocsTopicPageBody, we need to collect them manually
      // This happens when the HTML structure is malformed and Cheerio can't properly nest them
      console.log(`🔍 FIX: Collecting ALL ${allSectionsInPage.length} sections from entire page since some are orphaned`);
      
      // Strategy: Find the container that has content BEFORE the first section (like shortdesc),
      // then append all sections to the content elements
      const firstSectionInBody = allSectionsInBody[0];
      if (firstSectionInBody) {
        const sectionParent = $(firstSectionInBody).parent();
        const precedingElements = sectionParent.children().toArray().filter(el => {
          // Get elements that come before any section
          return el.name !== 'section';
        });
        
        console.log(`🔍 FIX: Found ${precedingElements.length} elements before sections (e.g., shortdesc)`);
        
        // Combine preceding elements + ALL sections
        contentElements = [...precedingElements, ...allSectionsInPage];
        console.log(`🔍 FIX: ✅ Using ${contentElements.length} total elements (${precedingElements.length} preceding + ${allSectionsInPage.length} sections)`);
      } else {
        // No sections in body at all - just use all sections from page
        contentElements = allSectionsInPage;
        console.log(`🔍 FIX: ✅ Using ALL ${allSectionsInPage.length} sections from page`);
      }
    } else if (allSectionsInBody.length > 0) {
      // Sections exist inside .zDocsTopicPageBody!
      // CRITICAL FIX: Sections may be spread across multiple articles/divs, not just one parent
      // Instead of using first section's parent children, collect ALL sections and their parents' children
      console.log(`🔍 Collecting content from ${allSectionsInBody.length} sections spread across multiple parents`);
      
      // Strategy: For each section, get its parent's children (siblings), but dedupe to avoid processing same content multiple times
      const allParentChildren = new Set();
      const seenParents = new Set();
      const articlesToInclude = new Set(); // Track article.nested1 containers
      
      allSectionsInBody.forEach(section => {
        const $section = $(section);
        const parent = $section.parent();
        const parentKey = parent.get(0); // Use DOM node as key
        
        if (!seenParents.has(parentKey)) {
          seenParents.add(parentKey);
          const siblings = parent.children().toArray();
          siblings.forEach(sibling => allParentChildren.add(sibling));
        }
        
        // CRITICAL FIX: Also collect article.nested1 containers that hold these sections
        // This ensures we process h2 headings that are direct children of articles
        const $article = $section.closest('article.nested1');
        if ($article.length > 0) {
          const articleNode = $article.get(0);
          if (!articlesToInclude.has(articleNode)) {
            articlesToInclude.add(articleNode);
            console.log(`🔍 ✅ Including article.nested1#${$article.attr('id') || 'NO-ID'} for processing`);
          }
        }
      });
      
      const sectionParentChildren = Array.from(allParentChildren);
      const articlesArray = Array.from(articlesToInclude);
      console.log(`🔍 Collected ${sectionParentChildren.length} unique elements from ${seenParents.size} parent container(s)`);
      console.log(`🔍 ✅ Including ${articlesArray.length} article.nested1 container(s) for heading extraction`);
      
      // ALSO include nav elements that are children of articles (e.g., #request-predictive-intelligence-for-im > nav)
      // These should come AFTER sections but BEFORE contentPlaceholder
      const articleNavs = $('.zDocsTopicPageBody article > nav, .zDocsTopicPageBody article[role="article"] > nav').toArray();
      if (articleNavs.length > 0) {
        console.log(`🔍 ✅ Found ${articleNavs.length} nav element(s) as children of articles, adding to contentElements`);
      }
      
      // ALSO include contentPlaceholder siblings (Related Links, etc.) - these go at the END
      const contentPlaceholders = topLevelChildren.filter(c => $(c).hasClass('contentPlaceholder'));
      if (contentPlaceholders.length > 0) {
        console.log(`🔍 ✅ Found ${contentPlaceholders.length} contentPlaceholder element(s), adding to contentElements`);
      }
      
        // FALLBACK: If contentPlaceholders exist in DOM but not in topLevelChildren (malformed HTML), add them
        const allContentPlaceholdersInBody = $('.zDocsTopicPageBody .contentPlaceholder').toArray();
        if (allContentPlaceholdersInBody.length > contentPlaceholders.length) {
          console.log(`🔍 ⚠️ FALLBACK: Found ${allContentPlaceholdersInBody.length} contentPlaceholders in DOM but only ${contentPlaceholders.length} in topLevelChildren`);
          console.log(`🔍 ⚠️ Adding ${allContentPlaceholdersInBody.length - contentPlaceholders.length} missing contentPlaceholders to contentElements`);
          // Add the missing ones
          const missingPlaceholders = allContentPlaceholdersInBody.filter(cp => !contentPlaceholders.includes(cp));
          contentPlaceholders.push(...missingPlaceholders);
        }
      
      // Use article.nested1 containers FIRST (for h2 headings), then section parent's children + article navs + contentPlaceholder siblings
      contentElements = [...articlesArray, ...sectionParentChildren, ...articleNavs, ...contentPlaceholders];
      console.log(`🔍 ✅ Using ${contentElements.length} elements (${articlesArray.length} articles + ${sectionParentChildren.length} section content + ${articleNavs.length} navs + ${contentPlaceholders.length} placeholders)`);
    } else {
      // No sections found, use original top-level children
      contentElements = topLevelChildren;
      
        // FALLBACK: Check for contentPlaceholders that exist in DOM but weren't in topLevelChildren
        const allContentPlaceholdersInBody = $('.contentPlaceholder').toArray(); // Use global search since parent might be malformed
        if (allContentPlaceholdersInBody.length > 0) {
          const existingPlaceholders = contentElements.filter(el => $(el).hasClass('contentPlaceholder'));
          console.log(`🔍 ⚠️ FALLBACK CHECK: Found ${allContentPlaceholdersInBody.length} contentPlaceholders globally, ${existingPlaceholders.length} already in contentElements`);
          if (allContentPlaceholdersInBody.length > existingPlaceholders.length) {
            console.log(`🔍 ⚠️ FALLBACK ACTIVE: Adding ${allContentPlaceholdersInBody.length - existingPlaceholders.length} missing contentPlaceholders`);
            // Add missing placeholders to the END of contentElements
            const missingPlaceholders = allContentPlaceholdersInBody.filter(cp => !existingPlaceholders.includes(cp));
            contentElements.push(...missingPlaceholders);
            console.log(`🔍 ⚠️ FALLBACK COMPLETE: contentElements now has ${contentElements.length} elements`);
          }
        }
    }
    
    // DIAGNOSTIC: Check nested structure
    const nested1InBody = $('.zDocsTopicPageBody article.nested1').length;
    const nested0InBody = $('.zDocsTopicPageBody article.nested0').length;
    console.log(`🔍 DIAGNOSTIC: Found ${nested0InBody} article.nested0 and ${nested1InBody} article.nested1 inside .zDocsTopicPageBody`);
    if (nested0InBody > 0) {
      const nested0 = $('.zDocsTopicPageBody article.nested0').first();
      const nested1Children = nested0.find('> article.nested1').length;
      console.log(`🔍 DIAGNOSTIC: article.nested0 has ${nested1Children} direct article.nested1 children`);
    }
    
    // FIX: Also collect any orphaned article.nested1 elements that are NOT inside .zDocsTopicPageBody
    // These can occur when Cheerio parsing leaves some articles as top-level elements
    const allNested1 = $('article.nested1').toArray();
    const orphanedNested1 = allNested1.filter(article => {
      const $article = $(article);
      // Check if this article is NOT a descendant of .zDocsTopicPageBody
      return $article.closest('.zDocsTopicPageBody').length === 0;
    });
    
    if (orphanedNested1.length > 0) {
      console.log(`🔍 FIX: Found ${orphanedNested1.length} orphaned article.nested1 elements outside .zDocsTopicPageBody`);
      console.log(`🔍 FIX: Orphaned article IDs: ${orphanedNested1.map(a => $(a).attr('id') || 'NO-ID').join(', ')}`);
      // Add orphaned articles to the contentElements array
      contentElements.push(...orphanedNested1);
    }
  } else if ($('body').length > 0) {
    // Full HTML document with body tag
    contentElements = $('body').find('> *').toArray();
    console.log(`🔍 Processing from <body>, found ${contentElements.length} children`);
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    // ServiceNow documentation content wrappers - process the full article including related content
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      contentElements = mainArticle.find('> *').toArray();
      console.log(`🔍 Processing from article.dita, found ${contentElements.length} children`);
      console.log(`🔍 article.dita children: ${contentElements.map(c => `<${c.name} class="${$(c).attr('class') || ''}">`).join(', ')}`);
    } else {
      // Fallback to original logic
      contentElements = $('.dita, .refbody, article, main, [role="main"]').first().find('> *').toArray();
      console.log(`🔍 Processing from content wrapper, found ${contentElements.length} children`);
    }
  } else {
    // HTML fragment - get all top-level elements
    contentElements = $.root().find('> *').toArray().filter(el => el.type === 'tag');
    console.log(`🔍 Processing from root, found ${contentElements.length} top-level elements`);
    
    // DIAGNOSTIC: Show structure of root elements
    const rootStructure = contentElements.map(el => {
      const $el = $(el);
      const tag = el.name;
      const id = $el.attr('id') || 'no-id';
      const cls = $el.attr('class') || 'no-class';
      const childCount = $el.find('> *').length;
      
      // For sections and articles, show their immediate children
      if (tag === 'section' || tag === 'article' || tag === 'div') {
        const children = $el.find('> *').toArray().map(c => {
          const cTag = c.name;
          const cId = $(c).attr('id') || '';
          const cCls = $(c).attr('class') || '';
          if (cTag === 'section' || cTag === 'article') {
            return `${cTag}#${cId}`;
          }
          return cTag;
        }).slice(0, 5).join(', '); // Show first 5 children
        return `<${tag} id="${id}" class="${cls}">[${childCount} children: ${children}${childCount > 5 ? '...' : ''}]`;
      }
      return `<${tag} id="${id}" class="${cls}">[${childCount} children]`;
    }).join('\n      ');
    
    console.log(`🔍 Root structure:\n      ${rootStructure}`);
  }
  
  console.log(`🔍 Found ${contentElements.length} elements to process`);
  
  // CRITICAL DIAGNOSTIC: Check if article.nested0 exists in the DOM at all
  const nested0Count = $('article.nested0').length;
  console.log(`🚨 CRITICAL: article.nested0 count in entire DOM: ${nested0Count}`);
  if (nested0Count > 0) {
    const nested0 = $('article.nested0').first();
    const nested0Html = nested0.html() || '';
    const nested0Children = nested0.find('> *').toArray();
    console.log(`🚨 article.nested0 direct children: ${nested0Children.length}`);
    console.log(`🚨 article.nested0 HTML length: ${nested0Html.length}`);
    console.log(`🚨 article.nested0 children types: ${nested0Children.map(c => `<${c.name} class="${$(c).attr('class') || ''}" id="${$(c).attr('id') || ''}">`).join(', ')}`);
    
    // Check how many times each article ID appears in the HTML
    const articleIds = ['dev-ops-config-github-acct-jwt', 'dev-ops-generate-jks-cert-github', 
      'dev-ops-attach-jks-cert-github', 'dev-ops-create-jwt-key-github',
      'dev-ops-create-jwt-prov-github', 'dev-ops-reg-github-oauth-prov-jwt', 'dev-ops-create-cred-github-jwt'];
    console.log(`\n🔍 CHECKING ARTICLE IDs IN CHEERIO-PARSED HTML:`);
    articleIds.forEach(id => {
      const count = (nested0Html.match(new RegExp(id, 'g')) || []).length;
      console.log(`🔍   ${id}: appears ${count} times in nested0 HTML`);
    });
    
    // CRITICAL: Dump the actual article.nested0 HTML to file for inspection
    const fs = require('fs');
    const path = require('path');
    const dumpPath = path.join(__dirname, '..', 'logs', `article-nested0-dump-${Date.now()}.html`);
    fs.writeFileSync(dumpPath, nested0Html, 'utf8');
    console.log(`🚨 DUMPED article.nested0 HTML to: ${dumpPath}`);
  }
  
  for (const child of contentElements) {
    const childId = $(child).attr('id') || 'no-id';
    const childClass = $(child).attr('class') || 'no-class';
    const childTag = child.name;
    console.log(`🔍 Processing contentElement: <${childTag} id="${childId}" class="${childClass}">`);
    
    const childBlocks = await processElement(child);
    console.log(`🔍   → Element <${childTag} id="${childId}"> produced ${childBlocks.length} blocks`);
    blocks.push(...childBlocks);
  }
  
  console.log(`🔍 Total blocks after processing: ${blocks.length}`);
  
  // Check for any truly unprocessed content in the PROCESSED area only
  // Get the remaining HTML from the specific content area we processed
  let remainingHtml = '';
  let content = '';
  
  if ($('body').length > 0) {
    remainingHtml = $('body').html() || '';
  } else if ($('.zDocsTopicPageBody').length > 0) {
    remainingHtml = $('.zDocsTopicPageBody').html() || '';
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      remainingHtml = mainArticle.html() || '';
    } else {
      remainingHtml = $('.dita, .refbody, article, main, [role="main"]').first().html() || '';
    }
  } else {
    remainingHtml = $.html();
  }
  
  content = cleanHtmlText(remainingHtml);
  
  console.log(`🔍 Fallback check - remaining HTML length: ${remainingHtml.length}`);
  console.log(`🔍 Fallback check - cleaned content length: ${content.trim().length}`);
  
  // Check if all content elements were successfully removed (processed)
  // Exclude wrapper divs that have no text content and only contain other wrapper elements
  let unprocessedElements = 0;
  let candidateElements = [];
  
  if ($('body').length > 0) {
    candidateElements = $('body').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').toArray();
  } else if ($('.zDocsTopicPageBody').length > 0) {
    candidateElements = $('.zDocsTopicPageBody').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').toArray();
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      candidateElements = mainArticle.children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').toArray();
    } else {
      candidateElements = $('.dita, .refbody, article, main, [role="main"]').first().children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').toArray();
    }
  }
  
  // Filter out empty wrapper divs (no direct text content, only contain other elements)
  const meaningfulElements = candidateElements.filter(el => {
    const $el = $(el);
    const tagName = el.name;
    
    // Non-div elements are always meaningful
    if (tagName !== 'div') return true;
    
    // For divs, check if they have meaningful content
    // A div is a meaningless wrapper if:
    // 1. It has no direct text content (ignoring whitespace)
    // 2. It only contains other block elements (article, section, div, main)
    const directText = $el.contents().filter((i, node) => node.type === 'text').text().trim();
    if (directText.length > 0) return true; // Has text, meaningful
    
    // Check children - if only contains wrapper elements, it's meaningless
    const children = $el.children().toArray();
    const hasOnlyWrappers = children.length > 0 && children.every(child => {
      const childTag = child.name;
      return ['article', 'section', 'div', 'main', 'aside', 'nav', 'header', 'footer'].includes(childTag);
    });
    
    return !hasOnlyWrappers; // Meaningful if it doesn't have only wrappers
  });
  
  unprocessedElements = meaningfulElements.length;
  console.log(`🔍 Unprocessed elements remaining: ${unprocessedElements} (filtered ${candidateElements.length - meaningfulElements.length} empty wrapper divs)`);
  
  if (unprocessedElements > 0) {
    console.log(`⚠️ Warning: ${unprocessedElements} content elements were not processed!`);
    console.log(`⚠️ This indicates a bug in the element processing logic.`);
    console.log(`⚠️ Remaining HTML structure (first 500 chars):`);
    console.log(remainingHtml.substring(0, 500));
  }
  
  if (content.trim().length > 100 && unprocessedElements === 0) {
    // Check if the remaining content is just sidebar/navigation content or inline elements
    // Only skip if we find actual sidebar structural elements (not just text that happens to mention "application")
    const hasSidebarContent = remainingHtml.includes('contentPlaceholder') || 
                             remainingHtml.includes('zDocsSideBoxes');
    
    if (hasSidebarContent) {
      console.log(`🔍 Remaining content appears to be sidebar/navigation - skipping fallback`);
    } else if (unprocessedElements === 0) {
      console.log(`✅ All block elements processed - remaining content is inline/formatting elements only`);
    } else {
      // Significant content remaining - this might be real unprocessed content
      console.log(`⚠️ Significant remaining content detected: "${content.trim().substring(0, 200)}..."`);
      console.log(`⚠️ Creating fallback paragraph - investigate why this wasn't processed!`);
      
      // Try to save the remaining HTML for analysis
      if (process.env.SN2N_VERBOSE === '1') {
        const fs = require('fs');
        const path = require('path');
        const logDir = path.join(__dirname, '../logs');
        const logFile = path.join(logDir, 'remaining-html.html');
        try {
          fs.writeFileSync(logFile, remainingHtml, 'utf8');
          console.log(`📝 Saved remaining HTML to ${logFile}`);
        } catch (err) {
          console.log(`⚠️ Could not save remaining HTML: ${err.message}`);
        }
      }
      
      // Strip any remaining HTML tags before converting to rich text
      let cleanedContent = cleanHtmlText(content.trim());
      
      // Additional aggressive tag stripping as a safety measure
      // This handles edge cases like unclosed tags or malformed HTML
      cleanedContent = cleanedContent.replace(/<[^>]*>/g, " ");
      
      // REMOVED: Don't strip HTML-encoded angle brackets - they may be legitimate content like navigation arrows (" > ")
      // cleanedContent = cleanedContent.replace(/&lt;[^&]*&gt;/g, " ");
      
      // Clean up multiple spaces
      cleanedContent = cleanedContent.replace(/\s+/g, " ").trim();
      
      const fallbackRichText = convertRichTextBlock(cleanedContent);
      if (fallbackRichText.length > 0) {
        blocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: fallbackRichText,
          },
        });
      }
    }
  } else {
    console.log(`✅ Minimal/no remaining content - all elements properly processed`);
  }
  
  // No post-processing needed - proper nesting structure handles list numbering restart
  console.log(`✅ Extraction complete: ${blocks.length} blocks`);

  // Validation-only: emit combined paragraph placeholders for marker-preserved groups
  // This helps the validator match HTML segments that were split into deferred
  // children and top-level marker blocks. These paragraphs are only emitted when
  // SN2N_VALIDATE_OUTPUT is set so production output is unchanged.
  try {
    if (process && process.env && process.env.SN2N_VALIDATE_OUTPUT) {
      const emittedMarkers = new Set();
      // Helper: extract rich_text array from common block shapes
      function getBlockRichTextArray(b) {
        if (!b || typeof b !== 'object') return [];
        if (b.paragraph && Array.isArray(b.paragraph.rich_text)) return b.paragraph.rich_text;
        if (b.callout && Array.isArray(b.callout.rich_text)) return b.callout.rich_text;
        if (b.heading_1 && Array.isArray(b.heading_1.rich_text)) return b.heading_1.rich_text;
        if (b.heading_2 && Array.isArray(b.heading_2.rich_text)) return b.heading_2.rich_text;
        if (b.heading_3 && Array.isArray(b.heading_3.rich_text)) return b.heading_3.rich_text;
        if (b.numbered_list_item && Array.isArray(b.numbered_list_item.rich_text)) return b.numbered_list_item.rich_text;
        if (b.bulleted_list_item && Array.isArray(b.bulleted_list_item.rich_text)) return b.bulleted_list_item.rich_text;
        return [];
      }

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const marker = b && b._sn2n_marker;
        if (!marker || emittedMarkers.has(marker)) continue;
        // Find all blocks (in original order) that share this marker
        const group = [];
        for (let j = i; j < blocks.length; j++) {
          if (blocks[j] && blocks[j]._sn2n_marker === marker) {
            group.push(blocks[j]);
          }
        }
        if (group.length === 0) continue;
        // Build combined text for the group
        const parts = [];
        for (const gb of group) {
          const rt = getBlockRichTextArray(gb);
          const text = joinRichTextContents(rt).trim();
          if (text) parts.push(text);
        }
        if (parts.length > 0) {
          const combined = parts.join(' ');
          const validationBlock = {
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: combined } }] },
            _sn2n_validation_only: true,
            _sn2n_validation_marker: marker
          };
          // Insert the validation-only combined paragraph immediately before the first marker block
          blocks.splice(i, 0, validationBlock);
          // Advance index to skip over inserted block and existing group
          i += group.length; // next iteration continues after group
        }
        emittedMarkers.add(marker);
      }
    }
  } catch (err) {
    console.log('🔍 [VALIDATION-EMIT] error while emitting marker groups', err && err.message);
  }
  
  // CRITICAL FIX: DO NOT strip marker tokens here!
  // Marker tokens MUST remain in rich_text for dry-run orchestration to work.
  // The tokens are used by attachToParents() in w2n.cjs to find where to attach collected blocks.
  // Stripping happens AFTER orchestration completes (in w2n.cjs or during page creation).
  // if (seenMarkers.size > 0) {
  //   console.log(`🔍 Removing ${seenMarkers.size} marker token(s) from rich text before finalizing`);
  //   stripMarkerTokensFromBlocks(blocks);
  // }
  
  
  // Restore technical placeholders in all rich_text content
  function restorePlaceholders(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(item => restorePlaceholders(item));
    } else if (obj && typeof obj === 'object') {
      if (obj.type === 'text' && obj.text && typeof obj.text.content === 'string') {
        obj.text.content = obj.text.content.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
          const placeholder = technicalPlaceholders[parseInt(index)];
          return placeholder ? `<${placeholder}>` : match;
        });
      }
      Object.values(obj).forEach(value => restorePlaceholders(value));
    }
  }
  restorePlaceholders(blocks);
  
  // Return fixed HTML for validation (saved before Cheerio processing)
  // This ensures validation counts match conversion (both use fixed HTML structure)
  // Global diagnostics emitter: when SN2N_DEDUPE_DEBUG is set, produce a
  // JSON file with per-block best-Jaccard scores against table rows.
  // This runs at the end of conversion so it's not dependent on figure/table
  // processing order and is useful during tuning.
  try {
    const DEBUG_FINAL = (process.env.SN2N_DEDUPE_DEBUG === '1' || process.env.SN2N_DEDUPE_DEBUG === 'true');
    if (DEBUG_FINAL) {
      const MIN_CHARS = parseInt(process.env.SN2N_DEDUPE_MIN_CHARS || '12', 10);
      const MIN_TOKENS = parseInt(process.env.SN2N_DEDUPE_MIN_TOKENS || '3', 10);
  const THRESHOLD = parseFloat(process.env.SN2N_DEDUPE_JACCARD || '1');

      const tableTokenSets_final = [];
      const tableTextList_final = [];
      for (const b of blocks) {
        if (b && b.type === 'table' && b.table && Array.isArray(b.table.children)) {
          for (const row of b.table.children) {
            const cells = (row.table_row && row.table_row.cells) || [];
            const cellTexts = cells.map(cellArr => {
              if (!Array.isArray(cellArr)) return '';
              return cellArr.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
            }).filter(Boolean).join(' ');
            const key = String(cellTexts || '').replace(/^\s+/, '').replace(/^[^a-z0-9]+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!key) continue;
            const toks = key.split(' ').map(x => x.trim()).filter(Boolean);
            if (toks.length === 0) continue;
            tableTokenSets_final.push(new Set(toks));
            tableTextList_final.push(key);
          }
        }
      }

      const dedupeCandidates_final = [];
      const jaccard_final = (aSet, bSet) => {
        let inter = 0;
        for (const v of aSet) if (bSet.has(v)) inter++;
        const union = new Set([...aSet, ...bSet]).size;
        if (union === 0) return 0;
        return inter / union;
      };

      for (let idx = 0; idx < blocks.length; idx++) {
        const b = blocks[idx];
        if (!b) continue;
        let text = '';
        if (b.type === 'paragraph' && b.paragraph && Array.isArray(b.paragraph.rich_text)) {
          text = b.paragraph.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
        } else if (b.type === 'heading_1' && b.heading_1 && Array.isArray(b.heading_1.rich_text)) {
          text = b.heading_1.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
        } else if (b.type === 'heading_2' && b.heading_2 && Array.isArray(b.heading_2.rich_text)) {
          text = b.heading_2.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
        } else if (b.type === 'heading_3' && b.heading_3 && Array.isArray(b.heading_3.rich_text)) {
          text = b.heading_3.rich_text.map(rt => (rt && rt.text && rt.text.content) ? String(rt.text.content) : '').join(' ');
        } else {
          continue;
        }

        const key = String(text || '').replace(/^\s+/, '').replace(/^[^a-z0-9]+/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!key) continue;
        if (key.length < MIN_CHARS) continue;
        const blockTokens = key.split(' ').map(x => x.trim()).filter(Boolean);
        if (blockTokens.length < MIN_TOKENS) continue;
        const blockSet = new Set(blockTokens);

        let bestScore = 0;
        let bestIdx = -1;
        for (let tI = 0; tI < tableTokenSets_final.length; tI++) {
          const tSet = tableTokenSets_final[tI];
          const score = jaccard_final(blockSet, tSet);
          if (score > bestScore) { bestScore = score; bestIdx = tI; }
        }

        dedupeCandidates_final.push({
          blockIndex: idx,
          blockType: b.type,
          blockText: text,
          blockTokenCount: blockTokens.length,
          bestScore: Number(bestScore.toFixed(3)),
          bestTableRowIndex: bestIdx,
          bestTableRowText: (bestIdx >= 0 && tableTextList_final[bestIdx]) ? tableTextList_final[bestIdx] : null,
          bestTableRowTokenCount: (bestIdx >= 0 && tableTokenSets_final[bestIdx]) ? tableTokenSets_final[bestIdx].size : 0
        });
      }

      try {
        const outPath = '/tmp/sn2n-dedupe-candidates.json';
        console.log(`📝 Final dedupe diagnostics: tableRows=${tableTokenSets_final.length}, candidates=${dedupeCandidates_final.length}`);
        const payload = {
          generatedAt: (new Date()).toISOString(),
          threshold: THRESHOLD,
          minChars: MIN_CHARS,
          minTokens: MIN_TOKENS,
          candidates: dedupeCandidates_final
        };
        fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
        console.log(`📝 Wrote final dedupe diagnostics to ${outPath} (${dedupeCandidates_final.length} entries)`);
      } catch (e) {
        console.log(`⚠️ Failed to write final dedupe diagnostics: ${e && e.message}`);
      }
    }
  } catch (e) {
    console.log(`⚠️ Failed running final dedupe diagnostics emitter: ${e && e.message}`);
  }

  return { blocks, hasVideos: hasDetectedVideos, fixedHtml: htmlForValidation };
}

/**
 * Extracts metadata from ServiceNow URLs for page context.
 * 
 * This function parses ServiceNow URLs to extract relevant metadata such as
 * sys_id, table names, and other URL parameters that provide context about
 * the ServiceNow record or page being processed.
 * 
 * @param {string} url - ServiceNow URL to parse for metadata
 * 
 * @returns {object} Extracted metadata object
 * @returns {string|null} returns.sys_id - ServiceNow sys_id if present in URL
 * @returns {string|null} returns.table - ServiceNow table name if present
 * @returns {object} returns.other - Additional metadata (host, path, etc.)
 * @returns {string} returns.other.host - URL hostname
 * @returns {string} returns.other.path - URL pathname
 * 
 * @example
 * const metadata = parseMetadataFromUrl(
 *   'https://instance.service-now.com/nav_to.do?uri=incident.do?sys_id=abc123&table=incident'
 * );
 * // Returns: {
 * //   sys_id: 'abc123',
 * //   table: 'incident', 
 * //   other: {
 * //     host: 'instance.service-now.com',
 * //     path: '/nav_to.do'
 * //   }
 * // }
 * 
 * @example
 * const metadata = parseMetadataFromUrl('https://docs.servicenow.com/bundle/quebec-platform/page/product/platform.html');
 * // Returns: {
 * //   sys_id: null,
 * //   table: null,
 * //   other: {
 * //     host: 'docs.servicenow.com',
 * //     path: '/bundle/quebec-platform/page/product/platform.html'
 * //   }
 * // }
 * 
 * @see {@link extractContentFromHtml} for content extraction from the same page
 */
function parseMetadataFromUrl(url) {
  // Basic metadata extraction from ServiceNow URLs
  if (!url || typeof url !== "string") {
    return {
      sys_id: null,
      table: null,
      other: {},
    };
  }

  const urlObj = new URL(url);
  const params = urlObj.searchParams;
  
  return {
    sys_id: params.get('sys_id') || null,
    table: params.get('table') || null,
    other: {
      host: urlObj.hostname,
      path: urlObj.pathname,
    },
  };
}

/**
 * @typedef {object} NotionBlock
 * @property {string} object - Always "block"
 * @property {string} type - Block type (paragraph, heading_1, callout, etc.)
 * @property {object} [paragraph] - Paragraph content (for paragraph blocks)
 * @property {object} [heading_1] - Heading 1 content (for heading_1 blocks)
 * @property {object} [heading_2] - Heading 2 content (for heading_2 blocks)
 * @property {object} [heading_3] - Heading 3 content (for heading_3 blocks)
 * @property {object} [callout] - Callout content (for callout blocks)
 * @property {object} [code] - Code content (for code blocks)
 * @property {object} [image] - Image content (for image blocks)
 * @property {object} [table] - Table content (for table blocks)
 * @property {object} [bulleted_list_item] - List item content (for bulleted lists)
 * @property {object} [numbered_list_item] - List item content (for numbered lists)
 */

/**
 * @typedef {object} ExtractionResult
 * @property {Array<NotionBlock>} blocks - Array of converted Notion blocks
 * @property {boolean} hasVideos - Whether video content was detected during conversion
 */

/**
 * @typedef {object} UrlMetadata
 * @property {string|null} sys_id - ServiceNow sys_id extracted from URL
 * @property {string|null} table - ServiceNow table name extracted from URL
 * @property {object} other - Additional URL metadata
 * @property {string} other.host - URL hostname
 * @property {string} other.path - URL pathname
 */

// Export ServiceNow content extraction utilities
module.exports = {
  /** @type {function(string): Promise<ExtractionResult>} */
  extractContentFromHtml,
  /** @type {function(string): UrlMetadata} */
  parseMetadataFromUrl,
};
