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

const { generateMarker } = require('../orchestration/marker-management.cjs');

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
  
  // CRITICAL FILE-BASED DIAGNOSTIC: Write to file so we can verify execution
  const fs = require('fs');
  const path = require('path');
  const logFile = path.join(__dirname, '../logs', 'entry-diagnostic.log');
  const timestamp = new Date().toISOString();
  
  try {
    fs.appendFileSync(logFile, `\n=== ${timestamp} ===\n`);
    fs.appendFileSync(logFile, `HTML length at function entry: ${html ? html.length : 'NULL'}\n`);
    
    if (html && html.includes('devops-software-quality-sub-category__ol_bpk_gfk_xpb')) {
      const olMatch = html.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
      if (olMatch) {
        fs.appendFileSync(logFile, `Target OL at entry: ${olMatch[0].length} chars, ${(olMatch[0].match(/<li/g) || []).length} <li> tags\n`);
        fs.appendFileSync(logFile, `Contains Submit at entry: ${olMatch[0].includes('<span class="ph uicontrol">Submit</span>')}\n`);
      } else {
        fs.appendFileSync(logFile, `OL ID found but regex extraction failed\n`);
      }
    } else {
      fs.appendFileSync(logFile, `Target OL ID NOT FOUND in HTML at entry\n`);
    }
  } catch (err) {
    console.error('Failed to write entry diagnostic:', err);
  }
  
  console.log('🚨🚨🚨 SERVICENOW.CJS FUNCTION START - MODULE LOADED 🚨🚨🚨');
  console.log(`🔬🔬🔬 [ENTRY] HTML length at function entry: ${html ? html.length : 'NULL'}`);
  
  // 🔧 WORKAROUND: DISABLED - This was causing issues with OL preservation
  // The workaround tried to preserve specific OLs but was actually corrupting content
  // Let Cheerio handle all HTML parsing without pre-processing interference
  /*
  const targetOlIds = [
    'devops-software-quality-sub-category__ol_bpk_gfk_xpb',
    'dev-ops-software-quality-summary__ol_sk4_k4b_wpb'
  ];
  */
  
  const preservedOls = []; // Keep empty array so restoration loop doesn't error
  
  /* DISABLED - This workaround was corrupting OLs
  for (const olId of targetOlIds) {
    if (html && html.includes(olId)) {
      const olMatch = html.match(new RegExp(`<ol[^>]*id="${olId}"[^>]*>[\\s\\S]*?<\\/ol>`, 'i'));
      if (olMatch) {
        const preservedOl = olMatch[0];
        // Use a div placeholder that won't be stripped during preprocessing
        const uniqueId = `sn2n_preserved_ol_${Date.now()}_${olId}`;
        const placeholder = `<div data-sn2n-preserved-ol="${uniqueId}"></div>`;
        // Replace the OL in the HTML with a placeholder
        html = html.replace(olMatch[0], placeholder);
        
        preservedOls.push({ olId, preservedOl, placeholder });
        
        console.log(`🔧 [OL-WORKAROUND] Preserved OL "${olId}" (${preservedOl.length} chars, ${(preservedOl.match(/<li/g) || []).length} LI tags)`);
        console.log(`🔧 [OL-WORKAROUND] Placeholder: ${placeholder}`);
        try {
          fs.appendFileSync(logFile, `\n🔧 WORKAROUND: Preserved OL "${olId}" before preprocessing\n`);
          fs.appendFileSync(logFile, `Preserved OL length: ${preservedOl.length} chars\n`);
          fs.appendFileSync(logFile, `Preserved OL LI count: ${(preservedOl.match(/<li/g) || []).length}\n`);
          fs.appendFileSync(logFile, `Placeholder: ${placeholder}\n`);
        } catch (err) {
          console.error('Failed to log workaround:', err);
        }
      }
    }
  }
  */
  
  // Array to collect warnings during extraction for later logging
  const warnings = [];
  
  // cleanHtmlText already imported at top of file
  if (!html || typeof html !== "string") {
    return { blocks: [], hasVideos: false, warnings: [] };
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
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML before UI element removal: ${html.length}`);
  html = html.replace(/<div[^>]*class="[^\"]*zDocsCodeExplanationContainer[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After zDocsCodeExplanationContainer: ${html.length}`);
  html = html.replace(/<button[^>]*class="[^\"]*zDocsAiActionsButton[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After zDocsAiActionsButton: ${html.length}`);
  html = html.replace(/<div[^>]*class="(?![^\"]*code-toolbar)[^\"]*\btoolbar\b[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After toolbar: ${html.length}`);
  html = html.replace(/<button[^>]*class="[^\"]*copy-to-clipboard-button[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After copy-to-clipboard: ${html.length}`);
  
  // UNWRAP filter divs instead of removing them completely - keep content, remove wrapper only
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML length before zDocsFilterTableDiv unwrap: ${html.length}`);
  // Just remove the opening tag - the content stays, orphaned closing </div> will be handled by Cheerio
  html = html.replace(/<div[^>]*class="[^\"]*zDocsFilterTableDiv[^\"]*"[^>]*>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML length after zDocsFilterTableDiv unwrap: ${html.length}`);
  
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML length before smartTable unwrap: ${html.length}`);
  // Unwrap smartTable divs - remove opening tag only, keep content
  html = html.replace(/<div[^>]*class="[^\"]*smartTable[^\"]*"[^>]*>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML length after smartTable unwrap: ${html.length}`);
  
  console.log(`🔬 [REGEX-DIAGNOSTIC] Before button removal: ${html.length}`);
  // COMMENT OUT button removal temporarily to preserve all content
  // html = html.replace(/<button[^>]*class="[^\"]*(?:zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu|dropdown-item)[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After button removal: ${html.length}`);
  
  // DataTables wrapper divs - these should be empty wrappers, but keep for now to preserve content
  console.log(`🔬 [REGEX-DIAGNOSTIC] Before DataTables removal: ${html.length}`);
  // COMMENTED OUT to preserve all content
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_wrapper[^\"]*"[^>]*>/gi, "");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_filter[^\"]*"[^>]*>/gi, "");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_length[^\"]*"[^>]*>/gi, "");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_info[^\"]*"[^>]*>/gi, "");
  // html = html.replace(/<div[^>]*class="[^\"]*dataTables_paginate[^\"]*"[^>]*>/gi, "");
  console.log(`🔬 [REGEX-DIAGNOSTIC] After DataTables removal: ${html.length}`);

  // DEDUPLICATE: Remove standalone articles that are also nested inside other articles
  // ServiceNow pages sometimes include both standalone articles AND the same articles nested in a wrapper
  // We need to keep only the properly nested structure to avoid duplicate content
  
  console.log(`🔬 [REGEX-DIAGNOSTIC] HTML length BEFORE dedupe Cheerio load: ${html.length}`);
  
  // DIAGNOSTIC: Check main steps OL BEFORE dedupe Cheerio load
  const mainStepsBeforeLoad = html.match(/<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>[\s\S]*?<\/ol>/);
  if (mainStepsBeforeLoad) {
    const liCount = (mainStepsBeforeLoad[0].match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
    console.log(`🔬 [DEDUPE-DIAGNOSTIC] Main steps OL BEFORE $dedupe.load(): ${liCount} direct LI children`);
  }
  
  const $dedupe = cheerio.load(html, { decodeEntities: false, xmlMode: false });
  
  // Find all article elements with IDs
  const articlesWithIds = {};
  $dedupe('article[id]').each((i, elem) => {
    const id = $dedupe(elem).attr('id');
    if (!articlesWithIds[id]) {
      articlesWithIds[id] = [];
    }
    articlesWithIds[id].push(elem);
  });
  
  // For each ID that appears multiple times, remove the standalone one (keep the nested one)
  Object.keys(articlesWithIds).forEach(id => {
    if (articlesWithIds[id].length > 1) {
      console.log(`🔍 [DEDUPE] Found ${articlesWithIds[id].length} articles with id="${id}"`);
      // Find which one is standalone (has no article ancestors) vs nested
      articlesWithIds[id].forEach(elem => {
        const $elem = $dedupe(elem);
        const articleAncestors = $elem.parents('article').length;
        if (articleAncestors === 0) {
          console.log(`🗑️ [DEDUPE] Removing standalone article with id="${id}" (will use nested version)`);
          $elem.remove();
        }
      });
    }
  });
  
  // DIAGNOSTIC: Check main steps OL BEFORE extracting HTML from dedupe Cheerio
  const mainStepsBeforeDedupe = $dedupe.html().match(/<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>[\s\S]*?<\/ol>/);
  if (mainStepsBeforeDedupe) {
    const liCount = (mainStepsBeforeDedupe[0].match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
    console.log(`🔬 [DEDUPE-DIAGNOSTIC] Main steps OL in $dedupe BEFORE .html(): ${liCount} direct LI children`);
  }
  
  html = $dedupe.html();
  
  // DIAGNOSTIC: Check main steps OL AFTER extracting HTML
  const mainStepsAfterDedupe = html.match(/<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>[\s\S]*?<\/ol>/);
  if (mainStepsAfterDedupe) {
    const liCount = (mainStepsAfterDedupe[0].match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
    console.log(`🔬 [DEDUPE-DIAGNOSTIC] Main steps OL AFTER .html(): ${liCount} direct LI children`);
  }

  // DIAGNOSTIC: Check HTML length AFTER initial cleanup
  const sectionsAfterCleanup = (html.match(/<section[^>]*id="[^"]*"/g) || []).length;
  console.log(`🔥🔥🔥 AFTER INITIAL CLEANUP: HTML length: ${html.length} chars, sections: ${sectionsAfterCleanup}`);

  // Block array for collecting converted Notion blocks
  const blocks = [];

  // Advanced rich text parser with full formatting support (migrated from sn2n-proxy.cjs)
  // Returns object with { richText: [], imageBlocks: [] }
  async function parseRichText(html) {
    if (!html) return { richText: [{ type: "text", text: { content: "" } }], imageBlocks: [], videoBlocks: [] };

    const richText = [];
    const imageBlocks = [];
    const videoBlocks = [];
    let text = html;

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
    
    // CRITICAL: Convert <br> and <br/> tags to markers BEFORE any other processing
    // Use marker to distinguish intentional breaks from HTML formatting whitespace
    const beforeBrConversion = text;
    text = text.replace(/<br\s*\/?>/gi, '__BR_NEWLINE__');
    if (beforeBrConversion !== text) {
      console.log(`🔍 [BR-CONVERSION] Converted <br> tags to __BR_NEWLINE__ markers in parseRichText`);
      const adminIndex = text.indexOf('admin');
      if (adminIndex !== -1) {
        const snippet = text.substring(adminIndex, adminIndex + 80);
        console.log(`   Text around "admin": "${snippet}"`);
      }
      console.log(`   Before: "${beforeBrConversion.substring(0, 150)}"`);
      console.log(`   After: "${text.substring(0, 150)}"`);
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

    // CRITICAL: Extract links FIRST (before placeholder protection)
    // This prevents <a> tags from being misidentified as placeholders
    const links = [];
    text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, content) => {
      const linkIndex = links.length;
      // Don't clean content yet - it will be cleaned later in the rich_text processing
      links.push({ href, content });
      return `__LINK_${linkIndex}__`;
    });

    console.log(`🔍 [parseRichText] After link extraction (${links.length} links):`, text.substring(0, 300));

    // CRITICAL: Protect technical placeholders like <plugin name>, <instance-name>, etc.
    // These are NOT HTML tags and should be preserved in the output
    const technicalPlaceholders = [];
    text = text.replace(/<([^>]+)>/g, (match, content) => {
      // Check if this looks like an HTML tag or a placeholder
      // HTML tag: starts with tag name, optionally followed by end or attributes like: <div>, <span class="x">
      // Placeholder: anything else like <plugin name>, <instance-name>, <Tool ID>, <file.txt>
      const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*\s*($|>|\/|[a-z]+=)/i.test(content.trim());
      if (!isHtmlTag) {
        const marker = `__TECH_PLACEHOLDER_${technicalPlaceholders.length}__`;
        technicalPlaceholders.push(content);
        console.log(`🔒 [parseRichText] Protected placeholder: "<${content}>"`);
        return marker;
      }
      return match; // Leave HTML tags for normal processing
    });

    console.log(`🔍 [parseRichText] After placeholder protection (${technicalPlaceholders.length} placeholders):`, text.substring(0, 300));

    // Restore kbd placeholders with appropriate markers BEFORE HTML cleanup
    // Use shared utility for intelligent detection (technical → code, UI labels → bold)
    kbdPlaceholders.forEach((content, index) => {
      const placeholder = `__KBD_PLACEHOLDER_${index}__`;
      const formatted = processKbdContent(content);
      text = text.replace(placeholder, formatted);
      console.log(`🔍 [parseRichText] Restored <kbd>: "${content}" → ${formatted.includes('CODE') ? 'code' : 'bold'}`);
    });

    // CRITICAL: Protect angle brackets inside CODE markers from being mistaken for HTML tags
    // The span stripping regex uses [^>]* which stops at first >, breaking placeholders like <project_sys_id>
    // Replace < and > with safe placeholders inside CODE blocks, then restore after span stripping
    text = text.replace(/__CODE_START__([\s\S]*?)__CODE_END__/g, (match, codeContent) => {
      const protectedContent = codeContent
        .replace(/</g, '__LT__')
        .replace(/>/g, '__GT__');
      return `__CODE_START__${protectedContent}__CODE_END__`;
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

    // CRITICAL FIX: Strip ALL div tags (not just note divs) - they're structural containers
    // that should have been processed at element level, not appearing in rich text
    text = text.replace(/<\/?div[^>]*>/gi, ' ');  // Remove ALL div tags (opening and closing)
    text = text.replace(/<\/?section[^>]*>/gi, ' ');
    text = text.replace(/<\/?article[^>]*>/gi, ' ');
    
    // CRITICAL FIX: Strip list tags - they're block elements that should be processed separately
    // These sometimes leak through when nested lists aren't properly extracted
    text = text.replace(/<\/?ol[^>]*>/gi, ' ');
    text = text.replace(/<\/?ul[^>]*>/gi, ' ');
    text = text.replace(/<\/?li[^>]*>/gi, ' ');
    
    // CRITICAL FIX: Strip <p> tags - they cause unwanted line breaks in callouts and inline text
    // Replace with space to preserve word boundaries
    text = text.replace(/<\/?p[^>]*>/gi, ' ');
    
    // Safety: Remove any incomplete HTML tags that might have been truncated during chunking
    // Pattern: < followed by tag name followed by anything (but not closing >)
    // This catches cases where content was chunked mid-tag like "...text <div class=\"note"
    text = text.replace(/<\/?[a-z][a-z0-9]*[^>]*$/gi, ' ');  // Incomplete tag at end
    // FIXED: Only match incomplete closing tags at beginning (e.g., "class='foo'>"), not standalone ">"
    // The pattern now requires at least one non-< character before the > to avoid matching standalone >
    text = text.replace(/^[^<]+?(?:class|id|style|href|src)=[^>]*>/gi, ' ');  // Incomplete tag at beginning
    
    // Clean up extra whitespace from tag removal
    // CRITICAL: Preserve newlines while normalizing other whitespace
    // Replace multiple non-newline whitespace with single space
    text = text.replace(/[^\S\n]+/g, ' ');
    // Clean up multiple consecutive newlines (keep max 1)
    text = text.replace(/\n+/g, '\n');
    // Trim spaces (not newlines) from start and end
    text = text.replace(/^[ \t]+|[ \t]+$/g, '');
    
    // CRITICAL: Restore protected angle brackets inside CODE markers
    // These were temporarily replaced to prevent span stripping regex from breaking on them
    text = text.replace(/__CODE_START__([\s\S]*?)__CODE_END__/g, (match, codeContent) => {
      const restoredContent = codeContent
        .replace(/__LT__/g, '<')
        .replace(/__GT__/g, '>');
      return `__CODE_START__${restoredContent}__CODE_END__`;
    });

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
    }

    // Handle bold/strong tags by replacing with markers
    text = text.replace(/<(b|strong)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
      return `__BOLD_START__${content}__BOLD_END__`;
    });

    // Handle italic/em tags
    text = text.replace(/<(i|em)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
      return `__ITALIC_START__${content}__ITALIC_END__`;
    });

    // Handle inline code tags
    text = text.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (match, attrs, content) => {
      // If content already has CODE markers (from URL restoration), don't double-wrap
      if (content.includes('__CODE_START__')) {
        return content;
      }
      console.log(`🔧 [CODE-TAG] Wrapping <code> tag content: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
      return `__CODE_START__${content}__CODE_END__`;
    });

    // Handle <samp> tags (sample output/system output) - treat same as inline code
    text = text.replace(/<samp([^>]*)>([\s\S]*?)<\/samp>/gi, (match, attrs, content) => {
      console.log(`💾 [SAMP TAG in parseRichText] Converting <samp> to inline code: "${content.substring(0, 100)}"`);
      // If content already has CODE markers, don't double-wrap
      if (content.includes('__CODE_START__')) {
        return content;
      }
      return `__CODE_START__${content}__CODE_END__`;
    });

    // NOTE: Link extraction already happened earlier (before placeholder protection)
    // The links array was created and <a> tags converted to __LINK_n__ markers

    // Handle spans with technical identifier classes (keyword, parmname, codeph, etc.)
    // Note: Generic "ph" class removed - only specific technical classes get formatting
    text = text.replace(/<span[^>]*class=["'][^"']*(?:\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      console.log(`🏷️ [SPAN] Found span with technical class: class="${match.match(/class=["']([^"']*)["']/)?.[1]}", content="${content}"`);
      
      // Use shared processing utility (no activeBlocks needed in parseRichText context)
      const result = processTechnicalSpan(content);
      
      console.log(`🏷️ [SPAN] Result: ${result.includes('__CODE_START__') ? 'CODE' : 'PLAIN'}`);
      
      // If unchanged (returned as-is), return original match to preserve HTML
      if (result === content || result === content.trim()) {
        return match;
      }
      
      return result;
    });

    // Handle raw technical identifiers in parentheses/brackets as inline code
    // Must contain at least one dot or underscore to be considered a technical identifier
    // Remove the brackets/parentheses from the output (treat same as parentheses around code)
    text = text.replace(/([\(\[])[ \t\n\r]*([a-zA-Z][-a-zA-Z0-9_]*(?:[_.][-a-zA-Z0-9_]+)+)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => {
      return `__CODE_START__${code.trim()}__CODE_END__`;
    });

    // Handle role names after "Role required:" as inline code
    // Examples: "Role required: admin", "Role required: sn_devops.admin, asset", "Role required: sn_devops.admin or sn_devops.tool_owner"
    // Roles can contain underscores and dots (e.g., sn_devops.admin)
    // CRITICAL: Process text in segments split by __BR_NEWLINE__ to avoid matching across line breaks
    const textBeforeSplit = text;
    const textSegments = text.split(/(__BR_NEWLINE__|__[A-Z_]+__)/);
    if (textBeforeSplit.includes('Role required:')) {
      console.log(`🔍 [ROLE-SPLIT-SN] Split into ${textSegments.length} segments around markers`);
      textSegments.forEach((seg, idx) => {
        if (seg.includes('Role required:') || seg.includes('admin') || seg.includes('__BR_NEWLINE__')) {
          console.log(`🔍 [ROLE-SPLIT-SN]   [${idx}] "${seg.substring(0, 80)}"`);
        }
      });
    }
    text = textSegments.map((segment, idx) => {
      // Skip markers - don't process them
      if (segment.startsWith('__') && segment.endsWith('__')) {
        return segment;
      }
      // Process this segment for role patterns
      return segment.replace(/\b(Role required:)\s+([a-z_][a-z0-9_.]*(?:\s+or\s+[a-z_][a-z0-9_.]*)*(?:,\s*[a-z_][a-z0-9_.]*)*)/gi, (match, label, roles) => {
        console.log(`🔍 [ROLE] Matched in segment [${idx}] "Role required:" with roles: "${roles}"`);
        // Split roles by comma or "or", wrap each in code markers
        const roleList = roles.split(/(?:,\s*|\s+or\s+)/i).map(role => {
          const trimmed = role.trim();
          console.log(`🔍 [ROLE] Wrapping role: "${trimmed}"`);
          return `__CODE_START__${trimmed}__CODE_END__`;
        }).join(' or ');
        const result = `${label} ${roleList}`;
        console.log(`🔍 [ROLE] Result: "${result}"`);
        return result;
      });
    }).join('');

    // Handle standalone multi-word identifiers connected by _ or . (no spaces) as inline code
    // Each segment can start with a letter, can contain letters, numbers, hyphens, and underscores
    // Examples: com.snc.incident.mim.ml_solution, sys_user_table, sn_devops.admin, package.class.method, com.glide.service-portal
    // Must have at least 2 segments separated by . or _ and no brackets/parentheses
    text = text.replace(/\b([a-zA-Z][-a-zA-Z0-9_]*(?:[_.][a-zA-Z][-a-zA-Z0-9_]*)+)\b/g, (match, identifier, offset) => {
      // Skip if already wrapped or if it's part of a URL
      if (match.includes('__CODE_START__') || match.includes('http')) {
        return match;
      }
      // Skip if this contains formatting markers (like __BOLD_END__, __BOLD_BLUE_END__)
      if (match.includes('__BOLD') || match.includes('__ITALIC') || match.includes('__LINK') || match.includes('_START__') || match.includes('_END__')) {
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
      console.log(`🔧 [TECH-ID] Wrapping standalone identifier: "${identifier}"`);
      return `__CODE_START__${identifier}__CODE_END__`;
    });

    // Handle role identifiers that appear in comma-separated lists after a colon
    // Common pattern: "For X: admin, contract_manager" or "Role required: admin"
    // Match lowercase identifiers that START WITH A LETTER (with optional underscores)
    text = text.replace(/:\s*([a-z][a-z_]*(?:\s*,\s*[a-z][a-z_]*)*)/g, (match, roleList, offset) => {
      // Skip if already wrapped or inside a URL
      if (match.includes('__CODE_START__') || match.includes('http')) {
        return match;
      }
      // Check context - should be after words like "workspace", "required", "UI", etc.
      const before = text.substring(Math.max(0, offset - 30), offset);
      if (!/(?:workspace|required|ui)\s*$/i.test(before)) {
        return match; // Not in role context
      }
      
      // Wrap each role identifier in code markers, keeping spaces/commas completely outside
      // Split on commas to process each identifier separately
      const identifiers = roleList.split(/\s*,\s*/);
      console.log(`🔧 [ROLE-ID] Split roleList into ${identifiers.length} identifiers:`, identifiers.map(r => `"${r}"`));
      const wrappedRoles = identifiers.map((role, idx) => {
        const originalRole = role;
        role = role.trim(); // Remove any leading/trailing spaces from identifier
        // Skip if already wrapped or if it's a common word
        if (!role || role.includes('__CODE_START__') || ['and', 'or', 'the', 'a', 'an', 'for', 'to', 'of'].includes(role)) {
          console.log(`🔧 [ROLE-ID] Skipping: "${originalRole}" (trimmed: "${role}")`);
          return role;
        }
        console.log(`🔧 [ROLE-ID] Wrapping role identifier: "${role}" (original: "${originalRole}")`);
        return `__CODE_START__${role}__CODE_END__`;
      }).join(', '); // Rejoin with consistent comma-space separator
      console.log(`🔧 [ROLE-ID] Final wrapped: "${wrappedRoles}"`);
      return ': ' + wrappedRoles;
    });

    // CRITICAL: Move leading/trailing spaces outside of code blocks
    // This ensures spaces and punctuation stay as plain text, not inside code formatting
    text = text.replace(/__CODE_START__(\s*)(.*?)(\s*)__CODE_END__/g, (match, leadingSpaces, content, trailingSpaces) => {
      const trimmedContent = content.trim();
      if (!trimmedContent) {
        // If content is only whitespace, don't wrap it
        return leadingSpaces + content + trailingSpaces;
      }
      return `${leadingSpaces}__CODE_START__${trimmedContent}__CODE_END__${trailingSpaces}`;
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

    // Normalize any broken marker tokens (with spaces) BEFORE splitting
    text = text
      .replace(/__\s+CODE\s+START__/g, '__CODE_START__')
      .replace(/__\s+CODE\s+END__/g, '__CODE_END__')
      .replace(/__\s+BOLD\s+START__/g, '__BOLD_START__')
      .replace(/__\s+BOLD\s+END__/g, '__BOLD_END__')
      .replace(/__\s+BOLD\s+BLUE\s+START__/g, '__BOLD_BLUE_START__')
      .replace(/__\s+BOLD\s+BLUE\s+END__/g, '__BOLD_BLUE_END__')
      .replace(/__\s+ITALIC\s+START__/g, '__ITALIC_START__')
      .replace(/__\s+ITALIC\s+END__/g, '__ITALIC_END__');

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
        if (linkInfo) {
          // Clean the link content (strip HTML tags, restore placeholders)
          let cleanedContent = cleanHtmlText(linkInfo.content);
          // Restore technical placeholders in link text
          cleanedContent = cleanedContent.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
            const placeholder = technicalPlaceholders[parseInt(index)];
            return `<${placeholder}>`;
          });
          
          if (cleanedContent.trim()) {
            let url = convertServiceNowUrl(linkInfo.href);
            if (url && isValidNotionUrl(url)) {
              richText.push({
                type: "text",
                text: { content: cleanedContent.trim(), link: { url } },
                annotations: normalizeAnnotations(currentAnnotations),
              });
            } else {
              richText.push({
                type: "text",
                text: { content: cleanedContent.trim() },
                annotations: normalizeAnnotations(currentAnnotations),
              });
            }
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

    // DEBUG: Log richText array before spacing logic
    if (text.includes('Role required') && text.includes('admin')) {
      console.log(`🔍 [PRE-SPACING] richText array has ${richText.length} elements:`);
      richText.forEach((rt, idx) => {
        console.log(`  [${idx}] content="${rt.text.content.substring(0, 50)}" code=${rt.annotations?.code} charCode=${rt.text.content.charCodeAt(0)}`);
      });
    }

    // Ensure proper spacing between rich text elements
    for (let i = 0; i < richText.length - 1; i++) {
      const current = richText[i];
      const next = richText[i + 1];

      // DEBUG: Log spacing decisions for code blocks
      if (current.annotations?.code || next.text.content === "\n") {
        console.log(`🔍 [SPACING] Element ${i}: "${current.text.content}" (code=${current.annotations?.code}) -> Element ${i+1}: "${next.text.content}"`);
      }

      // If current text doesn't end with space and next text doesn't start with space
      // BUT: Don't add space if next element is a newline OR if current element is a newline (preserve line breaks)
      if (current.text.content && next.text.content && 
          !current.text.content.endsWith(" ") && 
          !next.text.content.startsWith(" ") &&
          current.text.content !== "\n" &&
          next.text.content !== "\n") {
        console.log(`🔍 [SPACING] Adding space after "${current.text.content}"`);
        current.text.content += " ";
      }
    }

    // CRITICAL: Restore protected technical placeholders at the very end
    // Convert markers back to angle bracket format: __TECH_PLACEHOLDER_0__ -> <plugin name>
    richText.forEach(element => {
      if (element.text && element.text.content) {
        element.text.content = element.text.content.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
          const placeholder = technicalPlaceholders[parseInt(index)];
          console.log(`🔓 [parseRichText] Restored placeholder: "__TECH_PLACEHOLDER_${index}__" -> "<${placeholder}>"`);
          return `<${placeholder}>`;
        });
      }
    });

    // CRITICAL: Global cleanup for code-annotated elements
    // Trim leading/trailing spaces from code blocks and ensure spaces appear as plain text between elements
    const cleanedRichText = [];
    for (let i = 0; i < richText.length; i++) {
      const rt = richText[i];
      
      if (rt.annotations?.code && rt.text?.content) {
        const originalContent = rt.text.content;
        const leadingSpaces = originalContent.match(/^(\s*)/)[1];
        const trailingSpaces = originalContent.match(/(\s*)$/)[1];
        const trimmedContent = originalContent.trim();
        
        // Add leading spaces as plain text if they exist
        if (leadingSpaces && cleanedRichText.length > 0) {
          cleanedRichText.push({
            type: "text",
            text: { content: leadingSpaces },
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
          });
        }
        
        // Add the trimmed code block (only if there's actual content)
        if (trimmedContent) {
          cleanedRichText.push({
            ...rt,
            text: { ...rt.text, content: trimmedContent }
          });
        }
        
        // Add trailing spaces as plain text if they exist AND there's a next element
        if (trailingSpaces && i < richText.length - 1) {
          cleanedRichText.push({
            type: "text",
            text: { content: trailingSpaces },
            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
          });
        }
      } else {
        // Not a code block, keep as-is
        cleanedRichText.push(rt);
      }
    }
    
    // Replace richText array contents with cleaned version
    richText.length = 0;
    richText.push(...cleanedRichText);

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
    if (splitElements.length <= MAX_RICH_TEXT_ELEMENTS) {
      return [splitElements];
    }
    
    const chunks = [];
    for (let i = 0; i < splitElements.length; i += MAX_RICH_TEXT_ELEMENTS) {
      chunks.push(splitElements.slice(i, i + MAX_RICH_TEXT_ELEMENTS));
    }
    
    return chunks;
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
        };
      } else {
        // Fallback to external URL if upload fails
        log(`⚠️ Image upload failed, falling back to external URL: ${src.substring(0, 80)}...`);
        
        // Collect warning for later logging (after page creation when we have pageId)
        warnings.push({
          type: 'IMAGE_UPLOAD_FAILED',
          data: {
            imageUrl: src,
            errorMessage: 'Upload returned null/undefined'
          }
        });
        
        return {
          object: "block",
          type: "image",
          image: {
            type: "external",
            external: { url: src },
            caption: alt ? [{ type: "text", text: { content: alt } }] : [],
          },
        };
      }
    } catch (error) {
      log(`❌ Error processing image ${src}: ${error.message}`);
      
      // Collect warning for later logging (after page creation when we have pageId)
      warnings.push({
        type: 'IMAGE_UPLOAD_FAILED',
        data: {
          imageUrl: src,
          errorMessage: error.message
        }
      });
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
  // Pattern: <div class="p"><div class="table-wrap"></div><div class="zDocs..."></div><table>...</table></div></div></div>
  // This has 1 opening <div class="p"> but 3 closing </div> tags (2 are for nested divs, 1 extra)
  // Cheerio treats the extra </div> tags as closing parent elements, making siblings become children
  console.log('🔍 HTML FIX: Checking for extra closing div tags after tables...');
  
  let fixedHtml = html;
  let totalFixed = 0;
  
  // Strategy: Find pattern </table></div></div></div> and replace with </table></div>
  // The table-wrap and zDocsFilterTableDiv are self-closing, so we only need ONE </div> for the parent div.p
  const extraDivPattern = /<\/table><\/div><\/div><\/div>/g;
  const matches = fixedHtml.match(extraDivPattern);
  
  if (matches && matches.length > 0) {
    console.log(`🔍 HTML FIX: Found ${matches.length} instances of triple closing divs after </table>`);
    fixedHtml = fixedHtml.replace(extraDivPattern, '</table></div>');
    totalFixed = matches.length;
    console.log(`✅ HTML FIX COMPLETE: Removed ${totalFixed * 2} extra </div> tag(s) after tables`);
    html = fixedHtml;
    console.log(`🔥🔥🔥 AFTER HTML FIX: HTML length is now ${html.length} characters`);
  } else {
    console.log(`✅ HTML FIX: No extra closing div tags found after tables`);
  }
  
  // DIAGNOSTIC: Check if sections have their h2 elements in raw HTML
  for (const sectionId of rawSectionIds) {
    const sectionMatch = html.match(new RegExp(`<section[^>]*id="${sectionId}"[^>]*>([\\s\\S]{0,500})`));
    if (sectionMatch) {
      const sectionStart = sectionMatch[1];
      const hasH2 = /<h2[^>]*>/.test(sectionStart);
      console.log(`🔥 Section ${sectionId} in RAW HTML: ${hasH2 ? '✅ HAS h2' : '❌ NO h2'} - Preview: ${sectionStart.substring(0, 150).replace(/\s+/g, ' ')}`);
    }
  }
  
  // 🔧 WORKAROUND: Restore all preserved OLs before Cheerio processing
  for (const { olId, preservedOl, placeholder } of preservedOls) {
    if (html.includes(placeholder)) {
      html = html.replace(placeholder, preservedOl);
      console.log(`🔧 [OL-WORKAROUND] ✅ Restored OL "${olId}" (${preservedOl.length} chars) before Cheerio`);
      try {
        fs.appendFileSync(logFile, `🔧 ✅ Restored OL "${olId}" before Cheerio\n`);
      } catch (err) {
        console.error('Failed to log restoration:', err);
      }
    } else {
      console.error(`🔧 [OL-WORKAROUND] ❌ PLACEHOLDER NOT FOUND for "${olId}"! Placeholder was stripped during preprocessing.`);
      console.error(`🔧 [OL-WORKAROUND] Looking for: ${placeholder}`);
      try {
        fs.appendFileSync(logFile, `🔧 ❌ ERROR: Placeholder not found for "${olId}" before Cheerio!\n`);
        fs.appendFileSync(logFile, `Missing placeholder: ${placeholder}\n`);
      } catch (err) {
        console.error('Failed to log error:', err);
      }
    }
  }

  // Use cheerio to parse HTML and process elements in document order
  let $;
  let elementOrderMap = new Map(); // Declare at function scope so it's accessible throughout
  
  try {
    // FILE-BASED DIAGNOSTIC: Check HTML BEFORE Cheerio
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, '../logs', 'entry-diagnostic.log');
    
    fs.appendFileSync(logFile, `\n--- CHEERIO LOAD ---\n`);
    fs.appendFileSync(logFile, `HTML length BEFORE Cheerio.load(): ${html.length}\n`);
    
    // Check main steps OL BEFORE Cheerio
    const mainStepsOlRegexBefore = /<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>/;
    const mainStepsMatchBefore = html.match(mainStepsOlRegexBefore);
    if (mainStepsMatchBefore) {
      const olStartIdxBefore = html.indexOf(mainStepsMatchBefore[0]);
      // Find closing tag by counting nested OLs
      let openCountBefore = 1;
      let searchIdxBefore = olStartIdxBefore + mainStepsMatchBefore[0].length;
      while (openCountBefore > 0 && searchIdxBefore < html.length) {
        const nextOpen = html.indexOf('<ol', searchIdxBefore);
        const nextClose = html.indexOf('</ol>', searchIdxBefore);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          openCountBefore++;
          searchIdxBefore = nextOpen + 3;
        } else {
          openCountBefore--;
          searchIdxBefore = nextClose + 5;
        }
      }
      const mainStepsOlHtmlBefore = html.substring(olStartIdxBefore, searchIdxBefore);
      const mainStepsLiCountBefore = (mainStepsOlHtmlBefore.match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
      console.log(`🔬 [CHEERIO-DIAGNOSTIC] BEFORE load: Main steps OL has ${mainStepsLiCountBefore} direct LI children in raw HTML`);
      fs.appendFileSync(logFile, `Main steps OL BEFORE Cheerio: ${mainStepsLiCountBefore} direct <li class="...li step..."> tags\n`);
    }
    
    const targetOlBefore = html.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
    if (targetOlBefore) {
      fs.appendFileSync(logFile, `Target OL BEFORE Cheerio: ${targetOlBefore[0].length} chars, ${(targetOlBefore[0].match(/<li/g) || []).length} <li> tags\n`);
      fs.appendFileSync(logFile, `Contains Submit BEFORE Cheerio: ${targetOlBefore[0].includes('<span class="ph uicontrol">Submit</span>')}\n`);
    }
    
    $ = cheerio.load(html, { 
      decodeEntities: false,
      _useHtmlParser2: true 
    });
    
    // FILE-BASED DIAGNOSTIC: Check HTML AFTER Cheerio
    const htmlAfter = $.html();
    fs.appendFileSync(logFile, `HTML length AFTER Cheerio.load(): ${htmlAfter.length}\n`);
    
    // CRITICAL DIAGNOSTIC: Check if main steps OL has all LIs AFTER Cheerio
    const mainStepsOlRegex = /<ol[^>]*class="[^"]*ol steps[^"]*"[^>]*>/;
    const mainStepsMatch = htmlAfter.match(mainStepsOlRegex);
    if (mainStepsMatch) {
      const olStartIdx = htmlAfter.indexOf(mainStepsMatch[0]);
      // Find closing tag by counting nested OLs
      let openCount = 1;
      let searchIdx = olStartIdx + mainStepsMatch[0].length;
      while (openCount > 0 && searchIdx < htmlAfter.length) {
        const nextOpen = htmlAfter.indexOf('<ol', searchIdx);
        const nextClose = htmlAfter.indexOf('</ol>', searchIdx);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          openCount++;
          searchIdx = nextOpen + 3;
        } else {
          openCount--;
          searchIdx = nextClose + 5;
        }
      }
      const mainStepsOlHtml = htmlAfter.substring(olStartIdx, searchIdx);
      const mainStepsLiCount = (mainStepsOlHtml.match(/<li[^>]*class="[^"]*li step[^"]*"[^>]*>/g) || []).length;
      console.log(`🔬 [CHEERIO-DIAGNOSTIC] After load: Main steps OL has ${mainStepsLiCount} direct LI children (should be 6)`);
      fs.appendFileSync(logFile, `Main steps OL after Cheerio: ${mainStepsLiCount} direct <li class="...li step..."> tags\n`);
    }
    
    const targetOlAfter = htmlAfter.match(/<ol[^>]*id="devops-software-quality-sub-category__ol_bpk_gfk_xpb"[^>]*>[\s\S]*?<\/ol>/);
    if (targetOlAfter) {
      fs.appendFileSync(logFile, `Target OL AFTER Cheerio: ${targetOlAfter[0].length} chars, ${(targetOlAfter[0].match(/<li/g) || []).length} <li> tags\n`);
      fs.appendFileSync(logFile, `Contains Submit AFTER Cheerio: ${targetOlAfter[0].includes('<span class="ph uicontrol">Submit</span>')}\n`);
    } else {
      fs.appendFileSync(logFile, `Target OL NOT FOUND after Cheerio.load()!\n`);
    }
    
    console.log(`🔬 [CHEERIO-LOAD] HTML length BEFORE load: ${html.length}`);
    console.log(`🔬 [CHEERIO-LOAD] HTML length AFTER load: ${htmlAfter.length}`);
    
    // Build DOM order map to preserve original element positions
    // This is critical for keeping orphan elements (e.g., stray <li>) in correct order
    let orderCounter = 0;
    $.root().find('*').each((_, el) => {
      if (el && !elementOrderMap.has(el)) {
        elementOrderMap.set(el, orderCounter++);
      }
    });
    console.log(`🗺️ Built element order map with ${elementOrderMap.size} indexed elements`);
    
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
      
      // Collect warning for later logging (after page creation when we have pageId)
      warnings.push({
        type: 'CHEERIO_PARSING_ISSUE',
        data: {
          lostSections,
          lostArticles,
          lostSectionIds,
          lostArticleIds
        }
      });
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
    
    // DEBUG: Log ALL paragraphs to trace missing text
    if ((tagName === 'p' || (tagName === 'div' && elemClass.includes('p')))) {
      const elemTextPreview = $elem.text().trim().substring(0, 80).replace(/\s+/g, ' ');
      console.log(`🔎 [ELEMENT-TRACE] Processing <${tagName}${elemClass !== 'none' ? ` class="${elemClass}"` : ''}>`);
      console.log(`🔎 [ELEMENT-TRACE]   Text preview: "${elemTextPreview}..."`);
      
      // Check if this paragraph contains nested <ol>
      const hasNestedOl = $elem.find('> ol').length > 0;
      if (hasNestedOl) {
        console.log(`🔎 [ELEMENT-TRACE]   ⚠️ This paragraph contains nested <ol> - should trigger mixed content processing`);
        
        // DEBUG: Check if this is the "Software Quality Sub Categories" paragraph
        const paraHtml = $elem.html();
        if (paraHtml && (paraHtml.includes('Software Quality Sub Categories') || paraHtml.includes('Integrations'))) {
          console.log(`🚨 [PARA-WITH-OL] Found target paragraph with <ol>!`);
          console.log(`🚨 [PARA-WITH-OL] HTML contains "Click Submit": ${paraHtml.includes('Click Submit')}`);
          console.log(`🚨 [PARA-WITH-OL] HTML contains "successfully created": ${paraHtml.includes('successfully created')}`);
          console.log(`🚨 [PARA-WITH-OL] Number of <li> tags in HTML: ${(paraHtml.match(/<li/g) || []).length}`);
        }
      }
    }
    
    // DEBUG: Check if this element contains "Role required"
    const elemHtml = $elem.html() || '';
    if (elemHtml.includes('Role required')) {
      console.log(`🔍 [ELEMENT-ROLE-DEBUG] Found "Role required" in <${tagName} class="${elemClass}">`);
      console.log(`🔍 [ELEMENT-ROLE-DEBUG] Full HTML: ${elemHtml.substring(0, 300)}...`);
    }
    
    // SKIP UI CHROME ELEMENTS (dropdown menus, export buttons, filter divs, etc.)
    // Check this FIRST before any other processing
    if (tagName === 'button') {
      console.log(`🔍 Skipping button element (UI chrome)`);
      return []; // Return empty array - don't process buttons
    }
    
    if (tagName === 'div' && elemClass !== 'none') {
      const isUiChrome = /zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu/.test(elemClass);
      if (isUiChrome) {
        console.log(`🔍 Skipping UI chrome div with classes: ${elemClass}`);
        return []; // Return empty array - don't process UI chrome divs
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
    function getCalloutPropsFromClasses(classes = "") {
      const cls = String(classes || "");
      let color = "blue_background"; // default to info-ish note
      let icon = "ℹ️";
      if (/\b(important|critical)\b/.test(cls)) {
        color = "red_background";
        icon = "⚠️";
      } else if (/\bwarning\b/.test(cls)) {
        color = "orange_background";
        icon = "⚠️";
      } else if (/\bcaution\b/.test(cls)) {
        color = "yellow_background";
        icon = "⚠️";
      } else if (/\btip\b/.test(cls)) {
        color = "green_background";
        icon = "💡";
      } else if (/\b(info|note)\b/.test(cls)) {
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

      // Check if this callout contains "Role required"
      if (($elem.html() || '').includes('Role required')) {
        console.log(`🔍 [CALLOUT-ROLE-DEBUG] Found "Role required" in callout element!`);
        console.log(`🔍 [CALLOUT-ROLE-DEBUG] Full callout HTML: ${$elem.html()}`);
      }

      // Callout/Note
      const classAttr = $elem.attr('class') || '';
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);

      // Check if callout contains nested block elements (ul, ol, figure, table, pre, etc.)
      // NOTE: <p> tags should NOT be treated as nested blocks - they're part of callout rich_text
      // IMPORTANT: div.p is a ServiceNow wrapper that often contains mixed content (text + blocks)
      // For div.p with nested blocks: process the ENTIRE div.p as a child block (it will handle mixed content)
      
      // CRITICAL FIX: Unwrap itemgroup/info wrappers BEFORE finding nested blocks
      // This allows nested callouts (div.note inside div.itemgroup) to be detected as direct children
      const itemgroupWrappers = $elem.find('> div.itemgroup, > div.info');
      if (itemgroupWrappers.length > 0) {
        console.log(`🔍 [NESTED-CALLOUT] Unwrapping ${itemgroupWrappers.length} itemgroup/info wrappers in callout`);
        itemgroupWrappers.each((i, wrapper) => {
          const $wrapper = $(wrapper);
          console.log(`🔍 [NESTED-CALLOUT] Unwrapping <div class="${$wrapper.attr('class')}"> - inner HTML: ${($wrapper.html() || '').substring(0, 100)}...`);
          $wrapper.replaceWith($wrapper.html());
        });
      }
      
      // Find nested blocks that are direct children (excluding div.p which needs special handling)
      // Include > img so standalone images inside callouts are processed as child blocks
      // Note: Now div.note will be found directly if it was inside an itemgroup wrapper
      const directNestedBlocks = $elem.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.warning, > div.important, > div.tip, > div.caution, > img');
      console.log(`🔍 [NESTED-CALLOUT] After unwrapping, found ${directNestedBlocks.length} direct nested blocks`);
      
      // Check if any div.p elements contain nested blocks - if so, treat the entire div.p as a nested block
      const divPWithBlocks = $elem.find('> div.p').filter((i, divP) => {
        return $(divP).find('> ul, > ol, > figure, > table, > pre').length > 0;
      });
      
      const allNestedBlocks = $([...directNestedBlocks.toArray(), ...divPWithBlocks.toArray()]);
      
      console.log(`🔍 Callout nested blocks check: found ${directNestedBlocks.length} direct + ${divPWithBlocks.length} div.p with blocks = ${allNestedBlocks.length} total`);
      
      if (allNestedBlocks.length > 0) {
        console.log(`🔍 Callout contains ${allNestedBlocks.length} nested block elements - processing with children`);
        
        // Clone and remove nested blocks to get just the text content
        // Remove direct nested blocks AND any div.p that contains nested blocks
        // Note: itemgroup/info already unwrapped, so no need to remove them
        const $clone = $elem.clone();
        $clone.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.warning, > div.important, > div.tip, > div.caution, > img').remove();
        
        // Remove div.p elements that contain nested blocks (these are processed as child blocks)
        $clone.find('> div.p').each((i, divP) => {
          const $divP = $(divP);
          const hasNestedBlocks = $divP.find('> ul, > ol, > figure, > table, > pre').length > 0;
          if (hasNestedBlocks) {
            console.log(`🔍 Removing div.p with nested blocks from callout text (will be processed as child block)`);
            $divP.remove();
          }
        });
        
        // CRITICAL FIX: Use outerHTML then extract inner content properly
        let textOnlyHtml = '';
        const cloneOuterHtml = $.html($clone);
        const cloneOpeningTagMatch = cloneOuterHtml.match(/^<[^>]+>/);
        const cloneClosingTagMatch = cloneOuterHtml.match(/<\/[^>]+>$/);
        
        if (cloneOpeningTagMatch && cloneClosingTagMatch) {
          textOnlyHtml = cloneOuterHtml.substring(
            cloneOpeningTagMatch[0].length,
            cloneOuterHtml.length - cloneClosingTagMatch[0].length
          );
        } else {
          textOnlyHtml = $clone.html() || '';
        }
        
        console.log(`🔍 Callout textOnlyHtml (before title removal): "${textOnlyHtml.substring(0, 200)}${textOnlyHtml.length > 200 ? '...' : ''}"`);
        
        // Remove note title span (it already has a colon like "Note:")
        textOnlyHtml = textOnlyHtml.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
        
        console.log(`🔍 Callout textOnlyHtml (after title removal): "${textOnlyHtml.substring(0, 200)}${textOnlyHtml.length > 200 ? '...' : ''}"`);
        
        // Check for samp/plugin activation patterns for debugging
        if (textOnlyHtml.includes('samp') || textOnlyHtml.includes('Plugin Activation') || textOnlyHtml.includes('&lt;')) {
          console.log(`💾 [SAMP DEBUG] Callout contains samp/plugin text or escaped HTML:`);
          console.log(`   Full HTML: "${textOnlyHtml}"`);
        }
        
        // Parse HTML directly to preserve formatting (links, bold, etc.)
        const { richText: calloutRichText } = await parseRichText(textOnlyHtml);
        
        // Process nested blocks as children - these will be appended after page creation
        // CRITICAL: Flatten nested callouts (Notion doesn't support nested callouts)
        const childBlocks = [];
        const nestedCalloutTexts = []; // Collect text from nested callouts to add to parent
        
        for (const nestedBlock of allNestedBlocks.toArray()) {
          const $nestedBlock = $(nestedBlock);
          const blockTag = nestedBlock.name;
          const blockClass = $nestedBlock.attr('class') || '';
          
          // Check if this is a nested callout (div.note, div.info, div.warning, etc.)
          const isNestedCallout = blockTag === 'div' && 
            /\b(note|info|warning|important|tip|caution)\b/.test(blockClass) &&
            !/\bitemgroup\b/.test(blockClass);
          
          console.log(`🔍 [NESTED-CALLOUT] Checking nested block: <${blockTag} class="${blockClass}"> - isNestedCallout: ${isNestedCallout}`);
          
          if (isNestedCallout) {
            console.log(`🔍 [NESTED-CALLOUT] ✅ Flattening nested callout: <${blockTag} class="${blockClass}"> (Notion doesn't support nested callouts)`);
            // Extract text from nested callout and add to parent callout's text
            const nestedCalloutHtml = $nestedBlock.html() || '';
            // Remove the title span from nested callout
            const cleanedHtml = nestedCalloutHtml.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1');
            const { richText: nestedText } = await parseRichText(cleanedHtml);
            nestedCalloutTexts.push(nestedText);
            console.log(`🔍   Extracted ${nestedText.length} rich_text elements from nested callout`);
          } else {
            console.log(`🔍 Processing callout nested block: <${blockTag}${blockClass ? ` class="${blockClass}"` : ''}>`);
            const nestedProcessed = await processElement(nestedBlock);
            console.log(`🔍   Returned ${nestedProcessed.length} blocks: ${nestedProcessed.map(b => b.type).join(', ')}`);
            childBlocks.push(...nestedProcessed);
          }
        }
        
        // Combine parent callout text with flattened nested callout texts
        let finalCalloutRichText = calloutRichText;
        if (nestedCalloutTexts.length > 0) {
          console.log(`🔍 Combining parent callout with ${nestedCalloutTexts.length} flattened nested callout(s)`);
          // Add newlines between sections
          for (const nestedText of nestedCalloutTexts) {
            if (finalCalloutRichText.length > 0) {
              finalCalloutRichText.push({
                type: 'text',
                text: { content: '\n' },
                annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
              });
            }
            finalCalloutRichText.push(...nestedText);
          }
        }
        
        // Check if callout has actual content or is just empty/whitespace/title-only
        const calloutContent = finalCalloutRichText.map(rt => rt.text.content).join('').trim();
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
          console.log(`🔍 Creating callout with ${finalCalloutRichText.length} rich_text elements and ${childBlocks.length} deferred children`);
          
          const calloutBlock = {
            object: "block",
            type: "callout",
            callout: {
              rich_text: finalCalloutRichText.length > 0 ? finalCalloutRichText : [{ type: "text", text: { content: "" } }],
              icon: { type: "emoji", emoji: calloutIcon },
              color: calloutColor
            }
          };
          
          // Add marker for orchestrator to append children after creation
          if (childBlocks.length > 0) {
            const marker = generateMarker();
            
            // Tag each child block with the marker for orchestration
            childBlocks.forEach(block => {
              block._sn2n_marker = marker;
            });
            
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
          }
          
          processedBlocks.push(calloutBlock);
          
          // Add child blocks to processedBlocks so they get collected by orchestrator
          if (childBlocks.length > 0) {
            processedBlocks.push(...childBlocks);
          }
        }
      } else {
        // No nested blocks - process as simple callout with just rich_text
        // CRITICAL FIX: Use outerHTML then extract inner content properly
        console.log(`🔍 [CALLOUT-FIX-DEBUG] Processing simple callout, original $elem.html() length: ${($elem.html() || '').length}`);
        let cleanedContent = '';
        const outerHtml = $.html($elem);
        const openingTagMatch = outerHtml.match(/^<[^>]+>/);
        const closingTagMatch = outerHtml.match(/<\/[^>]+>$/);
        
        if (openingTagMatch && closingTagMatch) {
          cleanedContent = outerHtml.substring(
            openingTagMatch[0].length,
            outerHtml.length - closingTagMatch[0].length
          );
          console.log(`🔍 [CALLOUT-FIX-DEBUG] Successfully extracted inner HTML, length: ${cleanedContent.length}`);
        } else {
          cleanedContent = $elem.html() || '';
          console.log(`🔍 [CALLOUT-FIX-DEBUG] Fallback to original method, length: ${cleanedContent.length}`);
        }
        
        // Remove note title span (it already has a colon like "Note:")
        cleanedContent = cleanedContent.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
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
    } else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /\b(info|note|warning|important|tip|caution)\b/.test($elem.attr('class') || ''))) {
      const classAttr = $elem.attr('class') || '';
      console.log(`� [CALLOUT] Processing <${tagName}> with class="${classAttr}"`);
      
      // CRITICAL FIX: Use outerHTML then extract inner content properly
      // This prevents attribute values from bleeding into content
      let inner = '';
      const outerHtml = $.html($elem);
      const openingTagMatch = outerHtml.match(/^<[^>]+>/);
      const closingTagMatch = outerHtml.match(/<\/[^>]+>$/);
      
      if (openingTagMatch && closingTagMatch) {
        inner = outerHtml.substring(
          openingTagMatch[0].length,
          outerHtml.length - closingTagMatch[0].length
        );
        console.log(`🔍 [CALLOUT-FIX-DEBUG] Successfully extracted callout HTML, length: ${inner.length}`);
      } else {
        inner = $elem.html() || '';
        console.log(`🔍 [CALLOUT-FIX-DEBUG] Fallback to original method, length: ${inner.length}`);
      }
      
      console.log(`📋 [CALLOUT] Inner HTML (first 300 chars): ${inner.substring(0, 300)}`);
      console.log(`📋 [CALLOUT] Contains <img> tags: ${inner.includes('<img') ? 'YES' : 'NO'}`);
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);
      const { richText: calloutRichText, imageBlocks: calloutImages } = await parseRichText(inner);
      console.log(`📋 [CALLOUT] parseRichText returned ${calloutImages?.length || 0} image blocks`);
      
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
      
      try {
        // Replace figures in table HTML with placeholder text BEFORE conversion
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
          processedBlocks.push(...tableBlocks);
          
          // Extract images from original table HTML (before placeholder replacement)
          // and add as separate blocks after the table
          const figuresWithImages = $(tableHtml).find('figure');
          
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
                processedBlocks.push(imageBlock);
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
      const closestTable = $elem.closest('table');
      console.log(`🔍 Closest table count: ${closestTable.length}`);
      const isInTable = closestTable.length > 0;
      console.log(`🔍 isInTable: ${isInTable}`);
      
      if (isInTable) {
        console.log(`🔍 Figure is inside a table - skipping (will be handled by table converter)`);
        // Don't process or remove - let the table converter handle it
        // IMPORTANT: Don't call $elem.remove() here!
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
        
        console.log(`🔍 Figure: img src="${src?.substring(0, 50)}", caption="${captionText?.substring(0, 50)}"`);
        
        if (src && isValidImageUrl(src)) {
          const imageBlock = await createImageBlock(src, captionText);
          if (imageBlock) {
            console.log(`✅ Created image block with caption from figcaption`);
            console.log(`📋 Image block structure:`, JSON.stringify(imageBlock, null, 2));
            processedBlocks.push(imageBlock);
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
      const src = $elem.attr('src');
      const imgId = $elem.attr('id');
      const imgClass = $elem.attr('class');
      console.log(`🖼️ [STANDALONE IMG] id="${imgId}", class="${imgClass}", src="${src?.substring(0, 80)}"`);
      if (src && isValidImageUrl(src)) {
        console.log(`🖼️ [STANDALONE IMG] ✅ Valid image URL, creating block`);
        const imageBlock = await createImageBlock(src, $elem.attr('alt') || '');
        if (imageBlock) {
          console.log(`🖼️ [STANDALONE IMG] ✅ Image block created`);
          processedBlocks.push(imageBlock);
        } else {
          console.log(`🖼️ [STANDALONE IMG] ❌ Image block creation failed`);
        }
      } else {
        console.log(`🖼️ [STANDALONE IMG] ❌ Invalid or missing image URL`);
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
      console.log(`🔍 Processing <dd> (definition description)`);
      const children = $elem.find('> *').toArray();
      
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
      
    } else if (tagName === 'ul') {
      // Unordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ul> with ${listItems.length} list items`);
      
      for (let li of listItems) {
        const $li = $(li);
        
        // Check if list item contains nested block elements (pre, ul, ol, div.note, p, etc.)
        // Note: We search for div.p wrappers which may contain div.note elements
        // IMPORTANT: div.itemgroup and div.info are NOT block elements - they're just wrappers
        // We need to look INSIDE them for actual block elements (div.note, pre, ul, etc.)
        // CRITICAL FIX: Unwrap div.itemgroup and div.info to expose nested callouts
        // Use jQuery's .unwrap() method which is more reliable than .replaceWith()
        // IMPORTANT: Must unwrap from innermost to outermost to avoid DOM reference issues
        
        // First pass: find all wrappers and collect them
        const wrappers = $li.find('> div.itemgroup, > div.info').toArray();
        
        // Unwrap each wrapper by replacing it with its children
        wrappers.forEach((wrapper) => {
          const $wrapper = $(wrapper);
          const children = $wrapper.contents();
          
          // Replace wrapper with its children
          $wrapper.replaceWith(children);
        });
        
        // After unwrapping, re-query to find all nested blocks including newly-exposed callouts
        const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note, > div.warning, > div.important, > div.tip, > div.caution').toArray();
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 List item contains ${nestedBlocks.length} nested block elements`);
          
          // CRITICAL FIX: Extract text BETWEEN and AFTER nested blocks, not just before them
          // IMPORTANT: Use Cheerio's .contents() to get ALL nodes (elements + text) after unwrapping itemgroup/info
          const allChildren = $li.contents().toArray();
          const textSegments = []; // Collect all text segments
          const nestedChildren = []; // Collect processed nested blocks
          
          for (let i = 0; i < allChildren.length; i++) {
            const child = allChildren[i];
            
            // Check if this child is a block element we need to process
            // CRITICAL: Must match the exact selector used to find nestedBlocks above
            const nodeName = child.nodeName || child.name || child.tagName || 'UNKNOWN';
            const $child = $(child);
            const classAttr = $child.attr('class') || '';
            const classes = classAttr.split(/\s+/).filter(c => c.length > 0);
            
            // CRITICAL FIX: Cheerio nodes use .name property, not .nodeName
            const elementTag = (child.name || child.nodeName || child.tagName || '').toUpperCase();
            
            const isBlockElement = child.nodeType === 1 && ( // Element node
              ['PRE', 'UL', 'OL', 'FIGURE', 'TABLE', 'P'].includes(elementTag) ||
              (elementTag === 'DIV' && (() => {
                // Check if element has one of the specific block classes
                // Use exact class matching, not word boundary regex (avoids matching note__title, etc.)
                return classes.includes('table-wrap') || 
                       classes.includes('p') || 
                       classes.includes('stepxmp') ||
                       classes.includes('note') ||
                       classes.includes('info') ||
                       classes.includes('warning') ||
                       classes.includes('important') ||
                       classes.includes('tip') ||
                       classes.includes('caution');
              })())
            );
            
            if (isBlockElement) {
              console.log(`🔍 Processing nested block in list item: <${(child.nodeName || 'unknown').toLowerCase()}>`);
              const childBlocks = await processElement(child);
              nestedChildren.push(...childBlocks);
            } else {
              // Text node or inline element - accumulate as text segment
              if (child.nodeType === 3) { // Text node
                const text = child.textContent || '';
                if (text.trim()) {
                  textSegments.push(text);
                }
              } else if (child.nodeType === 1) { // Inline element
                textSegments.push($(child).prop('outerHTML'));
              }
            }
          }
          
          // Combine all text segments into one HTML string
          const textOnlyHtml = textSegments.join('');
          console.log(`🔍 [UL-TEXT-EXTRACTION] Extracted ${textSegments.length} text segments from list item with ${nestedBlocks.length} nested blocks`);
          
          // Create the list item with text content AND nested blocks as children
          if (textOnlyHtml && cleanHtmlText(textOnlyHtml).trim()) {
            const { richText: liRichText, imageBlocks: liImages } = await parseRichText(textOnlyHtml);
            
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
            
            nestedChildren.forEach(block => {
              // Check if block already has a marker from nested processing
              // IMPORTANT: Callouts with markers have their own nested content that should be orchestrated to them, not to the list item
              // Only add the callout itself, not its children (which share the same marker)
              if (block && block._sn2n_marker) {
                // Check if this is a callout with a marker token (meaning it has nested content)
                const isCalloutWithMarker = block.type === 'callout' && 
                  block.callout?.rich_text?.some(rt => rt.text?.content?.includes('(sn2n:'));
                
                if (isCalloutWithMarker) {
                  // Callout with marker token - add it, but its children will be orchestrated to the callout separately
                  console.log(`🔍 Block type "callout" has marker ${block._sn2n_marker} and marker token - adding to marked blocks (children orchestrated separately)`);
                  markedBlocks.push(block);
                  return;
                }
                
                // For other blocks with markers, check if they're children of a callout (same marker ID)
                // If so, skip them - they'll be orchestrated as children of the callout
                const parentCalloutMarker = markedBlocks.find(b => 
                  b.type === 'callout' && 
                  b.callout?.rich_text?.some(rt => rt.text?.content?.includes(`(sn2n:${block._sn2n_marker})`))
                );
                
                if (parentCalloutMarker) {
                  console.log(`🔍 Block type "${block.type}" has marker ${block._sn2n_marker} - skipping (child of callout with same marker)`);
                  return; // Skip - this block will be orchestrated as a child of the callout
                }
                
                console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - adding to marked blocks for this list item`);
                markedBlocks.push(block);
                return; // Skip further processing for this block
              }
              
              if (block && block.type === 'paragraph') {
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
                // Images can be immediate children
                immediateChildren.push(block);
              } else if (block && block.type) {
                // Tables, headings, callouts, etc. need markers
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
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
            // EXCEPTION: Do NOT defer list items (bulleted_list_item, numbered_list_item) - they should remain as immediate children
            // even when there are container blocks, otherwise they get flattened incorrectly.
            const hasContainerBlocks = markedBlocks.some(b => 
              b && (b.type === 'callout' || b.type === 'table' || b.type === 'heading_3')
            );
            
            let allChildren;
            if (hasContainerBlocks && immediateChildren.length > 0) {
              // Separate list items from other immediate children
              const listItems = immediateChildren.filter(b => 
                b && (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item')
              );
              const nonListChildren = immediateChildren.filter(b => 
                !b || (b.type !== 'bulleted_list_item' && b.type !== 'numbered_list_item')
              );
              
              if (nonListChildren.length > 0) {
                console.log(`🔄 Deferring ${nonListChildren.length} non-list immediate children for orchestration to maintain correct order with container blocks`);
                // Move non-list immediate children to marked blocks - they'll be orchestrated together
                markedBlocks.push(...nonListChildren);
              }
              
              // Keep list items as immediate children - they maintain correct nesting
              if (listItems.length > 0) {
                console.log(`✅ Keeping ${listItems.length} list items as immediate children (proper nesting)`);
              }
              
              allChildren = [...listItems];
            } else {
              // Use only immediateChildren - images are now handled separately with markers
              allChildren = [...immediateChildren];
            }
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
              for (const chunk of richTextChunks) {
                console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements and ${allChildren.length} children`);
                
                // If there are marked blocks, generate a marker and add token to rich text
                let markerToken = null;
                if (markedBlocks.length > 0) {
                  const marker = generateMarker();
                  markerToken = `(sn2n:${marker})`;
                  // Tag each marked block with the marker for orchestration
                  // CRITICAL: Don't overwrite existing markers (blocks may already have markers from nested processing)
                  markedBlocks.forEach(block => {
                    if (!block._sn2n_marker) {
                      block._sn2n_marker = marker;
                    }
                  });
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
                
                // Add marked blocks to processedBlocks so they get collected by orchestrator
                // These will be removed from initial payload and appended via API after page creation
                if (markedBlocks.length > 0) {
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
              if (blocksWithExistingMarkers.length > 0) {
                console.log(`🔍 Adding ${blocksWithExistingMarkers.length} blocks with existing markers from nested processing (bulleted)`);
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
            
            if (firstParagraphIndex !== -1) {
              const firstParagraph = nestedChildren[firstParagraphIndex];
              const beforeParagraph = nestedChildren.slice(0, firstParagraphIndex);
              const afterParagraph = nestedChildren.slice(firstParagraphIndex + 1);
              const remainingChildren = [...beforeParagraph, ...afterParagraph];
              
              // Promote first paragraph's text to list item text
              console.log(`🔍 Promoting first paragraph text to bulleted list item, ${remainingChildren.length} remaining children`);
              const promotedText = firstParagraph.paragraph.rich_text;
              
              // When promoting paragraphs, mark ALL remaining children for deferred orchestration
              // to avoid creating 4+ levels of nesting
              const markedBlocks = remainingChildren.filter(block => block && block.type);
              
              // Add marker if there are remaining children
              let richText = [...promotedText];
              if (markedBlocks.length > 0) {
                const marker = generateMarker();
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
                console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks (promoted paragraph children)`);
              }
              
              processedBlocks.push({
                object: "block",
                type: "bulleted_list_item",
                bulleted_list_item: {
                  rich_text: richText,
                  children: undefined  // No direct children - all deferred
                },
              });
              
              if (markedBlocks.length > 0) {
                processedBlocks.push(...markedBlocks);
              }
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
                const marker = generateMarker();
                markerToken = `(sn2n:${marker})`;
                markedBlocks.forEach(block => {
                  block._sn2n_marker = marker;
                });
                richText[0].text.content = markerToken;
                console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks`);
              }
              
              if (validChildren.length > 0 || markedBlocks.length > 0) {
                processedBlocks.push({
                  object: "block",
                  type: "bulleted_list_item",
                  bulleted_list_item: {
                    rich_text: richText,
                    children: validChildren.length > 0 ? validChildren : undefined
                  },
                });
                
                if (markedBlocks.length > 0) {
                  processedBlocks.push(...markedBlocks);
                }
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          // CRITICAL FIX: Use outerHTML then extract inner content properly
          console.log(`🔍 [LIST-FIX-DEBUG] Processing list item, original $li.html() length: ${($li.html() || '').length}`);
          let liHtml = '';
          const liOuterHtml = $.html($li);
          const liOpeningTagMatch = liOuterHtml.match(/^<[^>]+>/);
          const liClosingTagMatch = liOuterHtml.match(/<\/[^>]+>$/);
          
          if (liOpeningTagMatch && liClosingTagMatch) {
            liHtml = liOuterHtml.substring(
              liOpeningTagMatch[0].length,
              liOuterHtml.length - liClosingTagMatch[0].length
            );
            console.log(`🔍 [LIST-FIX-DEBUG] Successfully extracted list item HTML, length: ${liHtml.length}`);
          } else {
            liHtml = $li.html() || '';
            console.log(`🔍 [LIST-FIX-DEBUG] Fallback to original method, length: ${liHtml.length}`);
          }
          
          // Strip SVG icon elements (decorative only, no content value)
          liHtml = liHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
          console.log(`🔍 List item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 List item rich_text: ${liRichText.length} elements`);
          
          // Debug: Log the actual text content
          if (liRichText.length > 0) {
            const textPreview = liRichText.map(rt => rt.text?.content || '').join('').substring(0, 100);
            console.log(`🔍 List item text content: "${textPreview}"`);
          }
          
          const richTextChunks = splitRichTextArray(liRichText);
          const hasImages = liImages && liImages.length > 0;
          const imageMarker = hasImages ? generateMarker() : null;
          const imageMarkerToken = imageMarker ? `(sn2n:${imageMarker})` : null;
          if (imageMarker) {
            liImages.forEach(img => {
              img._sn2n_marker = imageMarker;
            });
          }
          richTextChunks.forEach((chunk, index) => {
            const chunkRichText = chunk.slice();
            const isLastChunk = index === richTextChunks.length - 1;
            if (imageMarkerToken && isLastChunk) {
              chunkRichText.push({
                type: "text",
                text: { content: ` ${imageMarkerToken}` },
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default"
                }
              });
            }
            const listItemBlock = {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: chunkRichText,
              },
            };
            processedBlocks.push(listItemBlock);
          });
          if (hasImages) {
            processedBlocks.push(...liImages);
          }
        }
      }
      console.log(`✅ Created list blocks from <ul>`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'ol') {
      // Ordered list
      // CRITICAL: Snapshot list items BEFORE processing to prevent DOM corruption
      // When nested elements call $elem.remove(), they can affect the parent's childNodes
      
      // DEBUG: Log raw HTML before Cheerio queries
      const rawOlHtml = $elem.html();
      const firstChars = rawOlHtml.substring(0, 200).replace(/\s+/g, ' ');
      console.log(`🔍 [OL-DEBUG] Raw <ol> HTML (first 200 chars): "${firstChars}..."`);
      console.log(`🔍 [OL-DEBUG] Raw HTML contains '<span class="ph uicontrol">Submit</span>': ${rawOlHtml.includes('<span class="ph uicontrol">Submit</span>')}`);
      console.log(`🔍 [OL-DEBUG] Raw HTML contains "successfully created": ${rawOlHtml.includes('successfully created')}`);
      console.log(`🔍 [OL-DEBUG] Raw HTML length: ${rawOlHtml.length} characters`);
      
      // Count total <li> tags (including nested)
      const totalLiTags = (rawOlHtml.match(/<li/g) || []).length;
      console.log(`🔍 [OL-DEBUG] Total <li> tags in raw HTML: ${totalLiTags}`);
      
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 [OL-DEBUG] Cheerio found ${listItems.length} DIRECT <li> children`);
      
      // Debug: Log each list item's text preview to verify we have them all
      listItems.forEach((li, idx) => {
        const $li = $(li);
        const preview = $li.text().trim().substring(0, 60).replace(/\s+/g, ' ');
        console.log(`🔍   [${idx + 1}/${listItems.length}] "${preview}..."`);
      });
      
      // CRITICAL: Snapshot nested blocks for ALL list items BEFORE processing any of them
      // This prevents DOM corruption when nested blocks call .remove() during processing
      // Issue: Processing list item N's nested blocks can corrupt list item N+1's DOM,
      // causing nested blocks to be "lost" when checking for them, then "found" in the wrong list item
      const listItemNestedBlocks = new Map();
      for (let li of listItems) {
        const $li = $(li);
        const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').toArray();
        listItemNestedBlocks.set(li, nestedBlocks);
      }
      console.log(`🔧 [OL-DOM-FIX] Snapshotted nested blocks for ${listItems.length} list items before processing`);
      
      for (let li of listItems) {
        const $li = $(li);
        
        // CRITICAL FIX: Don't unwrap div.itemgroup and div.info - Cheerio's replaceWith loses text nodes
        // Instead, find nested blocks INSIDE wrappers and treat wrappers as transparent containers
        // This preserves text nodes that appear between block elements inside the wrapper
        const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note, > div.warning, > div.important, > div.tip, > div.caution, > div.itemgroup > *, > div.info > *').toArray();
        
        // Filter to only actual block elements (remove inline spans, text wrappers, etc.)
        const actualBlocks = nestedBlocks.filter(block => {
          const $block = $(block);
          const nodeName = (block.nodeName || block.name || '').toLowerCase();
          const classes = ($block.attr('class') || '').split(/\s+/);
          
          // Allow block elements
          if (['pre', 'ul', 'ol', 'figure', 'table', 'p', 'div'].includes(nodeName)) {
            // For divs, check they have block classes
            if (nodeName === 'div') {
              return classes.includes('table-wrap') || classes.includes('p') || 
                     classes.includes('stepxmp') || classes.includes('note') || 
                     classes.includes('warning') || classes.includes('important') || 
                     classes.includes('tip') || classes.includes('caution');
            }
            return true;
          }
          return false;
        });
        
        if (actualBlocks.length > 0) {
          console.log(`🔍 Ordered list item contains ${actualBlocks.length} nested block elements`);
          
          // Log what nested blocks we found
          actualBlocks.forEach((block, idx) => {
            const $block = $(block);
            const blockTag = block.name;
            const blockClass = $block.attr('class') || '';
            const blockPreview = $block.text().trim().substring(0, 80);
            console.log(`🔍   [${idx}] <${blockTag}${blockClass ? ` class="${blockClass}"` : ''}> - "${blockPreview}..."`);
          });
          
          // CRITICAL FIX: Extract text BETWEEN and AFTER nested blocks, not just before them
          // IMPORTANT: Since we're NOT unwrapping itemgroup/info (to preserve text nodes), 
          // we need to flatten them during iteration to get their contents
          const allChildren = [];
          $li.contents().toArray().forEach(child => {
            const $child = $(child);
            const nodeName = (child.nodeName || child.name || '').toLowerCase();
            const classes = ($child.attr('class') || '').split(/\s+/);
            
            // If this is an itemgroup or info wrapper, add its children instead
            if (nodeName === 'div' && (classes.includes('itemgroup') || classes.includes('info'))) {
              console.log(`🔍 [OL-FLATTEN] Flattening ${classes.join('.')} wrapper - adding ${$child.contents().length} children`);
              $child.contents().toArray().forEach(wrapperChild => allChildren.push(wrapperChild));
            } else {
              allChildren.push(child);
            }
          });
          console.log(`🔍 [OL-CHILDREN] After flattening wrappers, <li> has ${allChildren.length} direct children`);
          allChildren.forEach((child, idx) => {
            const nodeType = child.nodeType === 3 ? 'TEXT' : (child.nodeType === 1 ? 'ELEMENT' : `TYPE-${child.nodeType}`);
            // For text nodes, show both .data and .textContent and their lengths
            let preview = '';
            if (child.nodeType === 3) {
              const data = child.data || '';
              const textContent = child.textContent || '';
              preview = `data(${data.length})="${data.substring(0, 50)}" textContent(${textContent.length})="${textContent.substring(0, 50)}"`;
            } else {
              preview = `<${child.name || 'unknown'}>`;
            }
            console.log(`🔍 [OL-CHILDREN]   [${idx}] ${nodeType} = ${preview}`);
          });
          const textSegments = []; // Collect text segments BEFORE first block element
          const nestedChildren = []; // Collect processed nested blocks
          let foundFirstBlock = false; // Track when we encounter the first block element
          const textAfterBlocks = []; // Collect text segments AFTER block elements
          
          for (let i = 0; i < allChildren.length; i++) {
            const child = allChildren[i];
            
            // Check if this child is a block element we need to process
            // CRITICAL: Must match the exact selector used to find nestedBlocks above
            // NOTE: itemgroup and info are NOT block elements - they're wrappers that get unwrapped above
            const elementTag = (child.name || child.nodeName || child.tagName || '').toUpperCase();
            const isBlockElement = child.nodeType === 1 && ( // Element node
              ['PRE', 'UL', 'OL', 'FIGURE', 'TABLE', 'P'].includes(elementTag) ||
              (elementTag === 'DIV' && (() => {
                const $child = $(child);
                const classes = ($child.attr('class') || '').split(/\s+/);
                // Check if element has one of the specific block classes
                // Use exact class matching, not word boundary regex (avoids matching note__title, etc.)
                return classes.includes('table-wrap') || 
                       classes.includes('p') || 
                       classes.includes('stepxmp') ||
                       classes.includes('note') || 
                       classes.includes('warning') || 
                       classes.includes('important') || 
                       classes.includes('tip') || 
                       classes.includes('caution');
              })())
            );
            
            if (isBlockElement) {
              foundFirstBlock = true; // Mark that we've encountered a block element
              const $child = $(child);
              const childClass = $child.attr('class') || '';
              const nodeName = (child && child.nodeName) ? child.nodeName.toLowerCase() : 'unknown';
              console.log(`🔍 [OL-BLOCK] Processing nested block in ordered list item: <${nodeName} class="${childClass}">`);
              const childBlocks = await processElement(child);
              nestedChildren.push(...childBlocks);
            } else {
              // Text node or inline element - accumulate as text segment
              // IMPORTANT: Add to textAfterBlocks if we've already seen a block element
              const targetArray = foundFirstBlock ? textAfterBlocks : textSegments;
              
              if (child.nodeType === 3) { // Text node
                // CRITICAL: Use .data property for text nodes, not .textContent (which may be empty)
                const text = child.data || child.textContent || '';
                // Only add text nodes that have non-whitespace content
                // This filters out indentation/formatting whitespace from the source HTML
                const trimmed = text.trim();
                if (trimmed) {
                  const location = foundFirstBlock ? 'AFTER blocks' : 'BEFORE blocks';
                  console.log(`🔍 [OL-TEXT] Adding text node (${location}) to segments: "${trimmed.substring(0, 50)}..."`);
                  // Use the original text (not trimmed) to preserve intentional spaces
                  targetArray.push(text);
                }
              } else if (child.nodeType === 1) { // Inline element
                const $child = $(child);
                const html = $child.prop('outerHTML');
                const nodeName = (child && child.nodeName) ? child.nodeName.toLowerCase() : 'unknown';
                const location = foundFirstBlock ? 'AFTER blocks' : 'BEFORE blocks';
                console.log(`🔍 [OL-INLINE] Adding inline element (${location}) to segments: <${nodeName} class="${$child.attr('class') || ''}"> html length: ${html.length}`);
                targetArray.push(html);
              }
            }
          }          // Combine all text segments into one HTML string
          // Add space between segments to prevent concatenation like "process.You"
          const textOnlyHtml = textSegments.join(' ');
          console.log(`🔍 [OL-TEXT-EXTRACTION] Extracted ${textSegments.length} text segments BEFORE blocks from ordered list item with ${actualBlocks.length} nested blocks`);
          
          // CRITICAL: If there are text segments AFTER block elements, create a paragraph block for them
          if (textAfterBlocks.length > 0) {
            const textAfterHtml = textAfterBlocks.join(' ');
            console.log(`🔍 [OL-TEXT-AFTER] Found ${textAfterBlocks.length} text segments AFTER blocks, creating paragraph`);
            const afterParsed = await parseRichText(textAfterHtml);
            if (afterParsed.richText.length > 0) {
              const afterParagraph = {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                  rich_text: afterParsed.richText,
                  color: 'default'
                }
              };
              // Add this paragraph to nestedChildren (it will be processed as a child/marker)
              nestedChildren.push(afterParagraph);
              console.log(`✅ [OL-TEXT-AFTER] Created paragraph with ${afterParsed.richText.length} rich_text elements for text after blocks`);
            }
          }
          
          // CRITICAL: If the first nested block is a paragraph, promote its text to be the list item's text
          // This handles cases like: <li><div class="p">Text here<ul>...</ul></div></li>
          // where the text should be the list item's text, not a separate paragraph child
          let promotedText = null;
          let remainingNestedChildren = nestedChildren;
          
          if (nestedChildren.length > 0 && nestedChildren[0]?.type === 'paragraph') {
            const firstParagraph = nestedChildren[0];
            if (firstParagraph.paragraph?.rich_text?.length > 0) {
              promotedText = firstParagraph.paragraph.rich_text;
              remainingNestedChildren = nestedChildren.slice(1);
              console.log(`🔄 [LIST-ITEM-TEXT-PROMOTION] Promoting first paragraph to list item text: "${promotedText.map(rt => rt.text.content).join('').substring(0, 80)}..."`);
              console.log(`🔄 [LIST-ITEM-TEXT-PROMOTION] Remaining ${remainingNestedChildren.length} nested children will be processed as children/markers`);
            }
          }
          
          // Create the list item with text content AND nested blocks as children
          if ((textOnlyHtml && cleanHtmlText(textOnlyHtml).trim()) || promotedText) {
            // CRITICAL FIX: Combine direct text with promoted paragraph text
            // Case: <li>Click Submit.<p>You have successfully created...</p></li>
            // Need: "Click Submit. You have successfully created..."
            let liRichText, liImages;
            if (promotedText) {
              // Check if there's also direct text content (before the nested paragraph)
              if (textOnlyHtml && cleanHtmlText(textOnlyHtml).trim()) {
                // Parse the direct text
                const directParsed = await parseRichText(textOnlyHtml);
                // Combine: direct text + newline + promoted paragraph text
                // The <p> tag creates a visual line break, so we need to preserve that
                const newlineElement = {
                  type: 'text',
                  text: { content: '\n' },
                  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                };
                liRichText = [...directParsed.richText, newlineElement, ...promotedText];
                liImages = directParsed.imageBlocks;
                console.log(`🔄 [LIST-ITEM-TEXT-PROMOTION] Combined direct text with promoted paragraph text (with newline)`);
              } else {
                // No direct text, just use promoted text
                liRichText = promotedText;
                liImages = [];
                console.log(`🔄 [LIST-ITEM-TEXT-PROMOTION] Using promoted text as list item text`);
              }
            } else {
              const parsed = await parseRichText(textOnlyHtml);
              liRichText = parsed.richText;
              liImages = parsed.imageBlocks;
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
            
            // IMPORTANT: Use remainingNestedChildren (after promoting first paragraph to text)
            remainingNestedChildren.forEach(block => {
              // Check if block already has a marker from nested processing
              // IMPORTANT: Callouts with markers have their own nested content that should be orchestrated to them, not to the list item
              // Only add the callout itself, not its children (which share the same marker)
              if (block && block._sn2n_marker) {
                // Check if this is a callout with a marker token (meaning it has nested content)
                const isCalloutWithMarker = block.type === 'callout' && 
                  block.callout?.rich_text?.some(rt => rt.text?.content?.includes('(sn2n:'));
                
                if (isCalloutWithMarker) {
                  // Callout with marker token - add it, but its children will be orchestrated to the callout separately
                  console.log(`🔍 Block type "callout" has marker ${block._sn2n_marker} and marker token - adding to marked blocks (children orchestrated separately)`);
                  markedBlocks.push(block);
                  return;
                }
                
                // For other blocks with markers, check if they're children of a callout (same marker ID)
                // If so, skip them - they'll be orchestrated as children of the callout
                const parentCalloutMarker = markedBlocks.find(b => 
                  b.type === 'callout' && 
                  b.callout?.rich_text?.some(rt => rt.text?.content?.includes(`(sn2n:${block._sn2n_marker})`))
                );
                
                if (parentCalloutMarker) {
                  console.log(`🔍 Block type "${block.type}" has marker ${block._sn2n_marker} - skipping (child of callout with same marker)`);
                  return; // Skip - this block will be orchestrated as a child of the callout
                }
                
                console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - adding to marked blocks for this list item`);
                markedBlocks.push(block);
                return; // Skip further processing for this block
              }
              
              // Callouts can be children of list items - mark them for deferred orchestration
              // This preserves the callout formatting while keeping proper parent-child relationship
              if (block && block.type === 'callout') {
                console.log(`� Callout inside <li> needs marker for deferred append to numbered_list_item`);
                markedBlocks.push(block);
                return;
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
                // Images can be immediate children
                immediateChildren.push(block);
              } else if (block && block.type) {
                // Tables, headings, callouts, etc. need markers
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
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
            // EXCEPTION: Do NOT defer list items (bulleted_list_item, numbered_list_item) - they should remain as immediate children
            // even when there are container blocks, otherwise they get flattened incorrectly.
            const hasContainerBlocks = markedBlocks.some(b => 
              b && (b.type === 'callout' || b.type === 'table' || b.type === 'heading_3')
            );
            
            let allChildren;
            if (hasContainerBlocks && immediateChildren.length > 0) {
              // Separate list items from other immediate children
              const listItems = immediateChildren.filter(b => 
                b && (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item')
              );
              const nonListChildren = immediateChildren.filter(b => 
                !b || (b.type !== 'bulleted_list_item' && b.type !== 'numbered_list_item')
              );
              
              if (nonListChildren.length > 0) {
                console.log(`🔄 Deferring ${nonListChildren.length} non-list immediate children for orchestration to maintain correct order with container blocks`);
                // Move non-list immediate children to marked blocks - they'll be orchestrated together
                markedBlocks.push(...nonListChildren);
              }
              
              // Keep list items as immediate children - they maintain correct nesting
              if (listItems.length > 0) {
                console.log(`✅ Keeping ${listItems.length} list items as immediate children (proper nesting)`);
              }
              
              allChildren = [...listItems];
            } else {
              // Use only immediateChildren - images are now handled separately with markers
              allChildren = [...immediateChildren];
            }
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
              console.log(`🔍 List item text: "${liRichText.map(rt => rt.text.content).join('').substring(0, 80)}..."`);
              console.log(`🔍 List item has ${allChildren.length} children: ${allChildren.map(c => c.type).join(', ')}`);
              const hasMarkedBlocks = markedBlocks.length > 0;
              const marker = hasMarkedBlocks ? generateMarker() : null;
              const markerToken = marker ? `(sn2n:${marker})` : null;
              if (marker) {
                markedBlocks.forEach(block => {
                  if (!block._sn2n_marker) {
                    block._sn2n_marker = marker;
                  }
                });
              }
              richTextChunks.forEach((chunk, index) => {
                const chunkRichText = chunk.slice();
                const isLastChunk = index === richTextChunks.length - 1;
                console.log(`🔍 Creating numbered_list_item with ${chunkRichText.length} rich_text elements and ${allChildren.length} children`);
                if (markerToken && isLastChunk) {
                  chunkRichText.push({
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
                const listItemBlock = {
                  object: "block",
                  type: "numbered_list_item",
                  numbered_list_item: {
                    rich_text: chunkRichText,
                  },
                };
                if (allChildren.length > 0 && index === 0) {
                  listItemBlock.numbered_list_item.children = allChildren;
                  console.log(`🔍 Added ${allChildren.length} nested blocks as children of ordered list item`);
                }
                processedBlocks.push(listItemBlock);
              });
              if (hasMarkedBlocks) {
                processedBlocks.push(...markedBlocks);
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
            
            if (firstParagraphIndex !== -1) {
              const firstParagraph = nestedChildren[firstParagraphIndex];
              const beforeParagraph = nestedChildren.slice(0, firstParagraphIndex);
              const afterParagraph = nestedChildren.slice(firstParagraphIndex + 1);
              const remainingChildren = [...beforeParagraph, ...afterParagraph];
              
              // Promote first paragraph's text to list item text
              console.log(`🔍 Promoting first paragraph text to numbered list item, ${remainingChildren.length} remaining children`);
              const promotedText = firstParagraph.paragraph.rich_text;
              
              // When promoting paragraphs, mark ALL remaining children for deferred orchestration
              // to avoid creating 4+ levels of nesting (numbered > bulleted > numbered > paragraph/image)
              const markedBlocks = remainingChildren.filter(block => block && block.type);
              
              // Add marker if there are remaining children
              let richText = [...promotedText];
              if (markedBlocks.length > 0) {
                const marker = generateMarker();
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
                console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks (promoted paragraph children)`);
              }
              
              processedBlocks.push({
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: {
                  rich_text: richText,
                  children: undefined  // No direct children - all deferred
                },
              });
              
              if (markedBlocks.length > 0) {
                processedBlocks.push(...markedBlocks);
              }
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
                console.log(`🔧 Enforced nesting depth (no-text numbered list item): ${depthResult.deferredBlocks.length} blocks deferred for orchestration`);
                markedBlocks.push(...depthResult.deferredBlocks);
              }
              
              console.log(`🔍 Creating numbered_list_item with no text but ${validChildren.length} valid children`);
              
              let markerToken = null;
              const richText = [{ type: "text", text: { content: "" } }];
              if (markedBlocks.length > 0) {
                const marker = generateMarker();
                markerToken = `(sn2n:${marker})`;
                markedBlocks.forEach(block => {
                  block._sn2n_marker = marker;
                });
                richText[0].text.content = markerToken;
                console.log(`🔍 Added marker ${markerToken} for ${markedBlocks.length} deferred blocks`);
              }
              
              if (validChildren.length > 0 || markedBlocks.length > 0) {
                processedBlocks.push({
                  object: "block",
                  type: "numbered_list_item",
                  numbered_list_item: {
                    rich_text: richText,
                    children: validChildren.length > 0 ? validChildren : undefined
                  },
                });
                
                if (markedBlocks.length > 0) {
                  processedBlocks.push(...markedBlocks);
                }
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          // CRITICAL FIX: Use outerHTML then extract inner content properly
          let liHtml = '';
          const liOuterHtml = $.html($li);
          const liOpeningTagMatch = liOuterHtml.match(/^<[^>]+>/);
          const liClosingTagMatch = liOuterHtml.match(/<\/[^>]+>$/);
          
          if (liOpeningTagMatch && liClosingTagMatch) {
            liHtml = liOuterHtml.substring(
              liOpeningTagMatch[0].length,
              liOuterHtml.length - liClosingTagMatch[0].length
            );
          } else {
            liHtml = $li.html() || '';
          }
          
          // Strip SVG icon elements (decorative only, no content value)
          liHtml = liHtml.replace(/<svg[\s\S]*?<\/svg>/gi, '');
          console.log(`🔍 Ordered list item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 Ordered list item rich_text: ${liRichText.length} elements`);
          
          // Remove leading/trailing whitespace-only elements (including newlines)
          // This prevents empty lines at the start/end of list items
          while (liRichText.length > 0 && (!liRichText[0].text?.content || /^\s*$/.test(liRichText[0].text.content))) {
            liRichText.shift();
          }
          while (liRichText.length > 0 && (!liRichText[liRichText.length - 1].text?.content || /^\s*$/.test(liRichText[liRichText.length - 1].text.content))) {
            liRichText.pop();
          }
          
          // Debug: Log the actual text content
          if (liRichText.length > 0) {
            const textPreview = liRichText.map(rt => rt.text?.content || '').join('').substring(0, 100);
            console.log(`🔍 Ordered list item text content: "${textPreview}"`);
          }
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (const chunk of richTextChunks) {
            const listItemBlock = {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: chunk,
              },
            };
            
            // Mark images for deferred orchestration to avoid 4-level nesting
            // (numbered_list_item > bulleted_list_item > numbered_list_item > image)
            if (liImages && liImages.length > 0) {
              const marker = generateMarker();
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
              processedBlocks.push(listItemBlock);
              processedBlocks.push(...liImages);
            } else {
              console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements`);
              processedBlocks.push(listItemBlock);
            }
          }
        }
      }
      // After processing the <ol>, check for an immediate sibling paragraph-like element
      // that likely continues the list (e.g., a 4th step rendered outside the <ol> by ServiceNow).
      // If found, convert it into an extra numbered_list_item so it stays contiguous with this list.
      try {
        const $olParent = $elem.parent();
        const olClasses = $elem.attr('class') || '';
        const parentClasses = $olParent.attr('class') || '';
        console.log(`🔎 [LIST-CONTINUATION-TRACE] Starting sibling scan after <ol class="${olClasses}"> (parent: <${$olParent.get(0)?.tagName?.toLowerCase() || 'unknown'} class="${parentClasses}">)`);
        console.log(`🔎 [LIST-CONTINUATION-TRACE] Will look ahead up to 5 siblings`);
        let foundContinuation = false;

        // First, check raw DOM siblings for TEXT nodes immediately after the <ol>
        try {
          let raw = $elem.get(0)?.nextSibling || null;
          let textChecked = 0;
          console.log(`🔎 [LIST-CONTINUATION-TRACE] Checking for TEXT NODE siblings (raw DOM traversal)`);
          while (raw && textChecked < 2) {
            const isText = raw.type === 'text' || raw.nodeType === 3;
            console.log(`🔎 [LIST-CONTINUATION-TRACE] Raw sibling ${textChecked}: type=${raw.type || raw.nodeType}, isText=${isText}`);
            if (isText) {
              const rawText = (raw.data || raw.nodeValue || '').trim();
              console.log(`🔎 [LIST-CONTINUATION-TRACE] Text node content length: ${rawText.length}, preview: "${rawText.substring(0, 50)}..."`);
              if (rawText && rawText.length > 10) {
                // CRITICAL: Only treat as continuation if it looks like an action step
                // Check for step indicators or action verbs at the start
                const hasStepIndicator = /^(\d+[\.)]\s*|Step \d+|[a-z][\.)]\s*)/i.test(rawText);
                const startsWithAction = /^(Click|Select|Navigate|Choose|Enter|Specify|Open|Close|Save|Delete|Create|Update|View|Set|Configure|Enable|Disable|Add|Remove)\s+/i.test(rawText);
                
                const shouldConvert = hasStepIndicator || startsWithAction;
                
                console.log(`🔧 [LIST-CONTINUATION-FIX] Found TEXT NODE after <ol> – "${rawText.substring(0, 80)}..."`);
                console.log(`🔍 [LIST-CONTINUATION-ANALYSIS] hasStepIndicator=${hasStepIndicator}, startsWithAction=${startsWithAction}, shouldConvert=${shouldConvert}`);
                
                if (shouldConvert) {
                  console.log(`🔧 [LIST-CONTINUATION-FIX] Converting to numbered_list_item`);
                  
                  const { richText: liRichText } = await parseRichText(rawText);
                  processedBlocks.push({
                    object: "block",
                    type: "numbered_list_item",
                    numbered_list_item: {
                      rich_text: (liRichText && liRichText.length > 0) ? liRichText : [{
                        type: "text",
                        text: { content: rawText },
                        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                      }]
                    }
                  });
                  // Remove the text content to avoid double processing later
                  if (typeof raw.data === 'string') raw.data = '';
                  foundContinuation = true;
                  break;
                } else {
                  console.log(`🔎 [LIST-CONTINUATION-TRACE] Text node doesn't look like a step continuation - leaving for normal processing`);
                }
              }
            }
            // Stop if next raw sibling is an element; otherwise skip whitespace/comments
            if (raw.type === 'tag' || raw.nodeType === 1) break;
            raw = raw.nextSibling;
            textChecked++;
          }
        } catch (e) {
          console.log(`⚠️ [LIST-CONTINUATION-FIX] Error while scanning raw TEXT siblings: ${e?.message || e}`);
        }
        console.log(`🔎 [LIST-CONTINUATION-TRACE] Checking for ELEMENT siblings (Cheerio traversal)`);
        let $sib = $elem.next();
        let checked = 0;
  while ($sib && $sib.length && checked < 5) { // broaden lookahead to catch wrapped content
          const sibTag = ($sib.get(0).tagName || '').toLowerCase();
          const sibClasses = $sib.attr('class') || '';
          console.log(`🔎 [LIST-CONTINUATION-TRACE] Element sibling ${checked}: <${sibTag} class="${sibClasses}">, text preview: "${$sib.text().trim().substring(0, 50)}..."`);
          const isUiChrome = /(miniTOC|linkList|zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu)/.test(sibClasses);
          if (isUiChrome) {
            console.log(`🔎 [LIST-CONTINUATION-TRACE] Skipping UI chrome sibling <${sibTag} class="${sibClasses}">`);
            $sib = $sib.next();
            checked++;
            continue;
          }

          // Determine if this sibling (or its immediate child) is paragraph-like content
          let $candidate = null;
          if ($sib.is('p') || ($sib.is('div') && $sib.hasClass('p'))) {
            $candidate = $sib;
          } else if ($sib.is('div') && !$sib.hasClass('table-wrap')) {
            // Prefer a direct child p/div.p if present (even if there are other block children)
            const $pChild = $sib.find('> p, > div.p').filter((_, el) => {
              const t = cleanHtmlText($(el).html() || $(el).text() || '').trim();
              return t.length > 10;
            }).first();
            if ($pChild.length > 0) {
              console.log(`🔎 [LIST-CONTINUATION-TRACE] Using direct paragraph-like child inside <div> as candidate`);
              $candidate = $pChild;
            } else {
              // If no direct paragraph child, try direct text-only content of the div
              const $clone = $sib.clone();
              $clone.children().remove();
              const directHtml = $clone.html() || '';
              const directText = cleanHtmlText(directHtml).trim();
              if (directText.length > 10) {
                console.log(`🔎 [LIST-CONTINUATION-TRACE] Using direct text from <div> as candidate`);
                // Create a temporary wrapper for parsing as HTML
                const $temp = $('<p></p>').html(directHtml);
                $candidate = $temp; // not in DOM, but we can parse its HTML and not remove original; acceptable fallback
              } else if ($sib.find('> *').length === 0) {
                // Div with only whitespace text nodes
                $candidate = null;
              }
            }
          } else if ($sib.is('section, article')) {
            // Peek one level inside section/article for an immediate paragraph-like child
            const $pChild = $sib.find('> p, > div.p').first();
            if ($pChild.length > 0) {
              console.log(`🔎 [LIST-CONTINUATION-TRACE] Found paragraph-like child inside <${sibTag}> wrapper`);
              $candidate = $pChild;
            }
          }

          if ($candidate) {
            const sibHtml = $candidate.html() || $candidate.text() || '';
            const sibText = cleanHtmlText(sibHtml).trim();
            if (sibText.length > 10) {
              // Check if this looks like a step continuation
              const hasStepIndicator = /^(\d+[\.)]\s*|Step \d+|[a-z][\.)]\s*)/i.test(sibText);
              const startsWithAction = /^(Click|Select|Navigate|Choose|Enter|Specify|Open|Close|Save|Delete|Create|Update|View|Set|Configure|Enable|Disable|Add|Remove)\s+/i.test(sibText);
              const shouldConvert = hasStepIndicator || startsWithAction;
              
              console.log(`🔧 [LIST-CONTINUATION-FIX] Found sibling after <ol> – "${sibText.substring(0, 80)}..."`);
              console.log(`🔍 [LIST-CONTINUATION-ANALYSIS] hasStepIndicator=${hasStepIndicator}, startsWithAction=${startsWithAction}, shouldConvert=${shouldConvert}`);
              
              if (shouldConvert) {
                console.log(`🔧 [LIST-CONTINUATION-FIX] Converting to numbered_list_item`);
                const { richText: liRichText, imageBlocks: liImages } = await parseRichText(sibHtml);
                const listItem = {
                  object: "block",
                  type: "numbered_list_item",
                  numbered_list_item: {
                    rich_text: (liRichText && liRichText.length > 0) ? liRichText : [{
                      type: "text",
                      text: { content: sibText },
                      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                    }]
                  }
                };
                if (liImages && liImages.length > 0) {
                  listItem.numbered_list_item.children = liImages;
                }
                processedBlocks.push(listItem);

                // Remove the candidate so it is not processed again later, only if it's attached to DOM
                try { if ($candidate && $candidate.remove) $candidate.remove(); } catch {}
                foundContinuation = true;
                break; // only add one continuation item
              } else {
                console.log(`🔎 [LIST-CONTINUATION-TRACE] Sibling doesn't look like a step continuation - leaving for normal processing`);
              }
            }
          }

          // Stop scanning if we encounter other clear block containers after peeking
          if ($sib.is('ul, ol, table, pre, figure, nav, aside, header, footer, h1, h2, h3, h4, h5, h6')) {
            console.log(`🔎 [LIST-CONTINUATION-TRACE] Stopping at blocking sibling <${sibTag}>`);
            break;
          }
          console.log(`🔎 [LIST-CONTINUATION-TRACE] No candidate in sibling <${sibTag} class="${sibClasses}">, moving to next`);
          $sib = $sib.next();
          checked++;
        }
        // If not found among immediate siblings, try scanning siblings of the parent container
        if (!foundContinuation) {
          const $parent = $elem.parent();
          if ($parent && $parent.length) {
            let $psib = $parent.next();
            let pChecked = 0;
            console.log(`🔎 [LIST-CONTINUATION-TRACE] Escalating to parent-level scan from <${$parent.get(0).tagName?.toLowerCase() || 'unknown'} class="${$parent.attr('class') || ''}">`);
            while ($psib && $psib.length && pChecked < 5) {
              const pTag = ($psib.get(0).tagName || '').toLowerCase();
              const pClasses = $psib.attr('class') || '';
              const isUiChrome = /(miniTOC|linkList|zDocsFilterTableDiv|zDocsFilterColumnsTableDiv|zDocsDropdownMenu|dropdown-menu|zDocsTopicPageTableExportButton|zDocsTopicPageTableExportMenu)/.test(pClasses);
              if (isUiChrome) {
                console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: skipping UI chrome <${pTag} class="${pClasses}">`);
                $psib = $psib.next();
                pChecked++;
                continue;
              }
              let $candidate = null;
              if ($psib.is('p') || ($psib.is('div') && $psib.hasClass('p'))) {
                $candidate = $psib;
              } else if ($psib.is('div')) {
                // Prefer step containers (.stepxmp, .itemgroup, .info) -> direct paragraph children
                const $pChild = $psib.find('> p, > div.p').filter((_, el) => {
                  const t = cleanHtmlText($(el).html() || $(el).text() || '').trim();
                  return t.length > 10;
                }).first();
                if ($pChild.length > 0) {
                  console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: using paragraph-like child inside <div class="${pClasses}"> as candidate`);
                  $candidate = $pChild;
                } else {
                  // fallback to direct text-only contentm this div
                  const $clone = $psib.clone();
                  $clone.children().remove();
                  const directHtml = $clone.html() || '';
                  const directText = cleanHtmlText(directHtml).trim();
                  if (directText.length > 10) {
                    console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: using direct text from <div class="${pClasses}"> as candidate`);
                    const $temp = $('<p></p>').html(directHtml);
                    $candidate = $temp;
                  }
                }
              } else if ($psib.is('section, article')) {
                const $pChild = $psib.find('> p, > div.p').first();
                if ($pChild.length > 0) {
                  console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: found paragraph-like child inside <${pTag}> wrapper`);
                  $candidate = $pChild;
                }
              } else if ($psib.is('li')) {
                // Direct <li> as a parent-level sibling: treat as a numbered list item continuation
                const liHtml = $psib.html() || $psib.text() || '';
                const liText = cleanHtmlText(liHtml).trim();
                console.log(`🚨 [ORPHAN-LI] Found standalone <li> as sibling after <ol>!`);
                console.log(`🚨 [ORPHAN-LI] Text preview: "${liText.substring(0, 100)}..."`);
                console.log(`🚨 [ORPHAN-LI] Contains "Click Submit": ${liText.includes('Click Submit')}`);
                console.log(`🚨 [ORPHAN-LI] Contains "successfully created": ${liText.includes('successfully created')}`);
                if (liText.length > 5) {
                  console.log(`🔧 [LIST-CONTINUATION-FIX] Parent-level: found <li> sibling after <ol> – converting to numbered_list_item: "${liText.substring(0, 80)}..."`);
                  const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
                  const listItem = {
                    object: "block",
                    type: "numbered_list_item",
                    numbered_list_item: { rich_text: (liRichText && liRichText.length > 0) ? liRichText : [{ type: 'text', text: { content: liText }, annotations: { bold:false, italic:false, strikethrough:false, underline:false, code:false, color:'default' } }] }
                  };
                  if (liImages && liImages.length > 0) listItem.numbered_list_item.children = liImages;
                  processedBlocks.push(listItem);
                  try { if ($psib && $psib.remove) $psib.remove(); } catch {}
                  foundContinuation = true;
                  break;
                }
              }

              if ($candidate) {
                const cHtml = $candidate.html() || $candidate.text() || '';
                const cText = cleanHtmlText(cHtml).trim();
                
                // CRITICAL: Check if the candidate contains block-level elements (ul, ol, table, etc.)
                // These should NOT be converted to list item continuations - they are separate structural blocks
                const hasBlockElements = $candidate.find('> ul, > ol, > table, > pre, > figure, > div.table-wrap').length > 0;
                if (hasBlockElements) {
                  console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: candidate contains block elements - skipping as list continuation`);
                  console.log(`🔎 [LIST-CONTINUATION-TRACE] Stopping at blocking sibling <${$candidate.prop('tagName') || 'unknown'}>`);
                  break;
                }
                
                if (cText.length > 10) {
                  console.log(`🔧 [LIST-CONTINUATION-FIX] Parent-level: found sibling after <ol> – converting to numbered_list_item: "${cText.substring(0, 80)}..."`);
                  const { richText: liRichText, imageBlocks: liImages } = await parseRichText(cHtml);
                  const listItem = {
                    object: "block",
                    type: "numbered_list_item",
                    numbered_list_item: { rich_text: (liRichText && liRichText.length > 0) ? liRichText : [{ type: 'text', text: { content: cText }, annotations: { bold:false, italic:false, strikethrough:false, underline:false, code:false, color:'default' } }] }
                  };
                  if (liImages && liImages.length > 0) listItem.numbered_list_item.children = liImages;
                  processedBlocks.push(listItem);
                  try { if ($candidate && $candidate.remove) $candidate.remove(); } catch {}
                  foundContinuation = true;
                  break;
                }
              }

              if ($psib.is('ul, ol, table, pre, figure, nav, aside, header, footer, h1, h2, h3, h4, h5, h6')) {
                console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: stopping at blocking sibling <${pTag}>`);
                break;
              }
              console.log(`🔎 [LIST-CONTINUATION-TRACE] Parent-level: no candidate in sibling <${pTag} class="${pClasses}">, moving to next`);
              $psib = $psib.next();
              pChecked++;
            }
          }
        }
      } catch (e) {
        console.log(`⚠️ [LIST-CONTINUATION-FIX] Error while scanning after <ol>: ${e?.message || e}`);
      }

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
          const isBlockElement = isElementNode && ['DIV', 'TABLE', 'OL', 'UL', 'DL'].includes(nodeName);
          
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
            
            // Process the block element (table, etc.)
            const childBlocks = await processElement(node);
            processedBlocks.push(...childBlocks);
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
      
      // Get class attribute early for logging
      const classAttr = $elem.attr('class') || '';
      
      // Check if this paragraph contains nested block-level elements
      // (ul, ol, dl, div.note, figure, iframe) - if so, handle mixed content
      // NOTE: Search for DIRECT CHILDREN ONLY (>) to avoid finding elements already nested in lists
      // This prevents duplicate processing of figures inside <ol>/<ul> elements
      
      // DEBUG: Log ALL paragraphs being checked for nested blocks
      const paraTextPreview = $elem.text().trim().substring(0, 80).replace(/\s+/g, ' ');
      console.log(`🔎 [PARA-CHECK] Checking <${tagName} class="${classAttr}"> for nested blocks`);
      console.log(`🔎 [PARA-CHECK]   Text preview: "${paraTextPreview}..."`);
      
  const directBlocks = $elem.find('> ul, > ol, > dl').toArray();
  const inlineBlocks = $elem.find('> div.note, > figure, > iframe').toArray();
  const nestedBlocks = [...directBlocks, ...inlineBlocks];
      
      console.log(`🔎 [PARA-CHECK]   Found ${directBlocks.length} direct blocks: ${directBlocks.map(b => b.name).join(', ')}`);
      console.log(`🔎 [PARA-CHECK]   Found ${inlineBlocks.length} inline blocks: ${inlineBlocks.map(b => b.name).join(', ')}`);
      console.log(`🔎 [PARA-CHECK]   Total nested blocks: ${nestedBlocks.length}`);
  // Detect if this paragraph directly contains an ordered list (<ol>) so we can
  // treat any trailing text as a continuation step rather than a plain paragraph
  const hasDirectOlInParagraph = directBlocks.some(db => (db.name || '').toLowerCase() === 'ol');
      
      if (nestedBlocks.length > 0) {
        console.log(`🔍 Paragraph <${tagName}> contains ${nestedBlocks.length} nested block elements - processing mixed content`);
        
        // Use childNodes iteration to separate text before/after nested blocks
        // This prevents text concatenation and preserves proper ordering
        const childNodes = Array.from($elem.get(0).childNodes);
        console.log(`🔎 [MIXED-CONTENT] Paragraph has ${childNodes.length} childNodes to process`);
        const blockElementSet = new Set(nestedBlocks);
        let currentTextHtml = '';
        
        for (let i = 0; i < childNodes.length; i++) {
          const node = childNodes[i];
          const nodeType = node.nodeType;
          const nodeName = node.nodeType === 1 ? (node.name || node.nodeName || '').toLowerCase() : 'TEXT';
          const isInBlockSet = blockElementSet.has(node);
          console.log(`🔎 [MIXED-CONTENT] Child ${i}: nodeType=${nodeType} (${nodeName}), isInBlockSet=${isInBlockSet}`);
          
          // Text nodes and inline elements accumulate into currentTextHtml
          if (node.nodeType === 3 || (node.nodeType === 1 && !blockElementSet.has(node))) {
            const nodeHtml = node.nodeType === 3 ? node.nodeValue : $.html(node, { decodeEntities: false });
            const preview = nodeHtml.trim().substring(0, 50);
            console.log(`🔎 [MIXED-CONTENT] Accumulating ${node.nodeType === 3 ? 'TEXT' : 'ELEMENT'}: "${preview}..."`);
            
            // DEBUG: Check for UL ID in ANY accumulated content
            if (nodeHtml && (nodeHtml.includes('_ul_') || nodeHtml.includes('ul_jfk') || nodeHtml.includes('__ul_'))) {
              console.log(`🚨 [UL-ID-DEBUG] ${node.nodeType === 3 ? 'TEXT NODE' : 'ELEMENT'} contains UL ID pattern!`);
              console.log(`🚨 [UL-ID-DEBUG] Full content (length ${nodeHtml.length}): "${nodeHtml}"`);
              if (node.nodeType === 1) {
                console.log(`🚨 [UL-ID-DEBUG] Element tag: <${node.name || node.nodeName}>`);
              }
            }
            
            currentTextHtml += nodeHtml;
          } 
          // Block-level elements: flush accumulated text, then process block
          else if (node.nodeType === 1 && blockElementSet.has(node)) {
            // Flush accumulated text before this block element
            if (currentTextHtml.trim()) {
              const blockTag = node.name || node.nodeName || 'UNKNOWN';
              const blockId = node.attribs?.id || ($(node).attr('id')) || 'no-id';
              console.log(`🔍 Found text before block element <${blockTag} id="${blockId}">: "${currentTextHtml.trim().substring(0, 80)}..."`);
              
              // DEBUG: Check if text contains UL ID
              if (currentTextHtml.includes('_ul_') || currentTextHtml.includes('ul_jfk')) {
                console.log(`🚨 [UL-ID-DEBUG] Text before block contains UL ID string!`);
                console.log(`🚨 [UL-ID-DEBUG] Full text: "${currentTextHtml}"`);
                console.log(`🚨 [UL-ID-DEBUG] Block element: <${blockTag} id="${blockId}">`);
              }
              
              let textHtml = currentTextHtml.trim();
              
              // Remove any literal note div tags that may appear as text
              textHtml = textHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
              
              const { richText: textRichText } = await parseRichText(textHtml);
              console.log(`🔍 [MIXED-CONTENT-DEBUG] textRichText.length = ${textRichText.length}`);
              if (textRichText.length > 0) {
                const hasContent = textRichText.some(rt => rt.text.content.trim() || rt.text.link);
                console.log(`🔍 [MIXED-CONTENT-DEBUG] hasContent check = ${hasContent}`);
                if (!hasContent) {
                  console.log(`🔍 [MIXED-CONTENT-DEBUG] First richText element:`, JSON.stringify(textRichText[0], null, 2));
                }
              }
              if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim() || rt.text.link)) {
                const textChunks = splitRichTextArray(textRichText);
                console.log(`🔍 [MIXED-CONTENT] Creating ${textChunks.length} paragraph block(s) from text before <${blockTag}>`);
                for (const chunk of textChunks) {
                  const textPreview = chunk.map(rt => rt.text.content).join('').substring(0, 80);
                  console.log(`🔍 [MIXED-CONTENT]   Paragraph text: "${textPreview}..."`);
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  });
                }
              } else {
                console.log(`🔍 [MIXED-CONTENT] Skipping empty/whitespace-only text before <${blockTag}>`);
                if (textHtml && textHtml.trim()) {
                  console.log(`🔍 [MIXED-CONTENT-DEBUG] But textHtml was not empty: "${textHtml.substring(0, 100)}"`);
                }
              }
              currentTextHtml = '';
            }
            
            // Process the block element
            const blockName = node.name.toLowerCase();
            console.log(`🔍 Processing nested block: <${blockName}>`);
            const childBlocks = await processElement(node);
            processedBlocks.push(...childBlocks);
            
            // CRITICAL: Don't let nested elements remove themselves - we'll remove the parent after processing all children
            // This prevents DOM corruption during childNodes iteration
            // Reset currentTextHtml to start accumulating text after this block
            currentTextHtml = '';
          }
        }
        
        // Flush any remaining text after the last block element
        if (currentTextHtml.trim()) {
          const trailingHtml = currentTextHtml.trim();
          console.log(`🔍 Found text after block elements: "${trailingHtml.substring(0, 80)}..."`);
          
          // Remove any literal note div tags that may appear as text
          let textHtml = trailingHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
          
          const { richText: textRichText, imageBlocks: textImageBlocks } = await parseRichText(textHtml);
          const hasRealText = textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim());
          if (hasDirectOlInParagraph && hasRealText) {
            // CRITICAL: Only treat trailing text as list continuation if it looks like a step
            // Use the same criteria as the raw DOM sibling scan (hasStepIndicator OR startsWithAction)
            const plain = cleanHtmlText(textHtml).trim();
            const hasStepIndicator = /^(\d+[\.)]\s*|Step \d+|[a-z][\.)]\s*)/i.test(plain);
            const startsWithAction = /^(Click|Select|Navigate|Choose|Enter|Specify|Open|Close|Save|Delete|Create|Update|View|Set|Configure|Enable|Disable|Add|Remove)\s+/i.test(plain);
            const shouldConvert = hasStepIndicator || startsWithAction;
            
            console.log(`🔧 [LIST-CONTINUATION-TRACE] Paragraph contained <ol>; trailing text: "${plain.substring(0, 80)}..."`);
            console.log(`🔍 [LIST-CONTINUATION-ANALYSIS] hasStepIndicator=${hasStepIndicator}, startsWithAction=${startsWithAction}, shouldConvert=${shouldConvert}`);
            
            if (shouldConvert) {
              console.log(`🔧 [LIST-CONTINUATION-FIX] Converting trailing text to numbered_list_item`);
              const listItem = {
                object: "block",
                type: "numbered_list_item",
                numbered_list_item: { rich_text: textRichText }
              };
              if (textImageBlocks && textImageBlocks.length > 0) {
                listItem.numbered_list_item.children = textImageBlocks;
              }
              processedBlocks.push(listItem);
            } else {
              console.log(`🔎 [LIST-CONTINUATION-TRACE] Trailing text doesn't look like a step - creating normal paragraph`);
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
              if (textImageBlocks && textImageBlocks.length > 0) {
                processedBlocks.push(...textImageBlocks);
              }
            }
          } else if (hasRealText) {
            const textChunks = splitRichTextArray(textRichText);
            for (const chunk of textChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              });
            }
            if (textImageBlocks && textImageBlocks.length > 0) {
              console.log(`🔍 Adding ${textImageBlocks.length} image block(s) from trailing text`);
              processedBlocks.push(...textImageBlocks);
            }
          } else if (textImageBlocks && textImageBlocks.length > 0) {
            // No text, only images
            processedBlocks.push(...textImageBlocks);
          }
        }

        // NEW: If this paragraph contained an ordered list, check for an immediate
        // sibling paragraph that likely continues the list (e.g., "Click Submit...")
        // and convert it into a numbered list item to preserve the 4th step.
        try {
          const hadDirectOl = $elem.find('> ol').length > 0;
          if (hadDirectOl) {
            let $sib = $elem.next();
            let checked = 0;
            while ($sib && $sib.length && checked < 2) { // only look at the next couple of siblings
              const isParaLike = $sib.is('p') || ($sib.is('div') && $sib.hasClass('p'));
              const isUiChrome = $sib.hasClass('miniTOC') || $sib.hasClass('linkList');
              if (isParaLike && !isUiChrome) {
                const sibHtml = $sib.html() || $sib.text() || '';
                const sibText = cleanHtmlText(sibHtml).trim();
                if (sibText.length > 10) {
                  console.log(`🔧 [LIST-CONTINUATION-FIX] Found paragraph sibling after <ol> – converting to numbered_list_item: "${sibText.substring(0, 80)}..."`);
                  const { richText: liRichText, imageBlocks: liImages } = await parseRichText(sibHtml);
                  // Create numbered list item from this sibling
                  const listItem = {
                    object: "block",
                    type: "numbered_list_item",
                    numbered_list_item: {
                      rich_text: liRichText && liRichText.length > 0 ? liRichText : [{
                        type: "text",
                        text: { content: sibText },
                        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                      }]
                    }
                  };
                  // Attach any images as children if present
                  if (liImages && liImages.length > 0) {
                    listItem.numbered_list_item.children = liImages;
                  }
                  processedBlocks.push(listItem);
                  // Remove the sibling so it isn't processed again elsewhere
                  $sib.remove();
                  break;
                }
              }
              // stop scanning on non-paragraph block-level elements
              if ($sib.is('section, article, table, ul, ol, pre, figure, nav, aside')) break;
              $sib = $sib.next();
              checked++;
            }
          }
        } catch (e) {
          console.log(`⚠️ [LIST-CONTINUATION-FIX] Error while checking sibling after <ol>: ${e?.message || e}`);
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
        
        // Add any image blocks found in the paragraph FIRST
        if (paragraphImages && paragraphImages.length > 0) {
          processedBlocks.push(...paragraphImages);
        }
        
        // Add any video/iframe blocks found in the paragraph
        if (paragraphVideos && paragraphVideos.length > 0) {
          processedBlocks.push(...paragraphVideos);
        }

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
      
    } else if (tagName === 'section' && $elem.hasClass('prereq')) {
      // Special handling for "Before you begin" prerequisite sections
      // Convert entire section to a callout with pushpin emoji
      console.log(`🔍 Processing prereq section as callout`);
      
      // CRITICAL FIX: Unwrap itemgroup/info wrappers and flatten nested callouts BEFORE processing
      // This prevents nested callouts from being included as text in the parent callout
      $elem.find('div.itemgroup, div.info').each((i, wrapper) => {
        $(wrapper).replaceWith($(wrapper).html());
      });
      
      // Parse each child (including text nodes) separately to preserve paragraph boundaries
      const richTextElements = [];
      const imageBlocks = [];
      const deferredBlocks = []; // Collect blocks to add AFTER the callout
      
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
            
            // Add a line break between children - but use a SEPARATE element to avoid carrying over annotations
            if (richTextElements.length > 0 && childRichText.length > 0) {
              richTextElements.push({
                type: 'text',
                text: { content: '\n' },
                annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
              });
              console.log(`🔍   Added line break as separate element (no annotation carryover)`);
            }
            
            richTextElements.push(...childRichText);
            imageBlocks.push(...childImages);
          }
        } else {
          // Handle element node
          const $child = $(child);
          const childTag = child.tagName?.toLowerCase();
          
          // Check if this child contains block-level children (not just if it IS a block element)
          // IMPORTANT: Also check for nested callouts (div.note, div.info, etc.)
          const blockChildren = $child.find('> ul, > ol, > table, > pre, > blockquote, > div.note, > div.info, > div.warning, > div.important, > div.tip, > div.caution');
          const hasBlockChildren = blockChildren.length > 0;
          
          if (hasBlockChildren) {
            console.log(`🔍 [NESTED-CALLOUT-PREREQ] Child ${i} (<${childTag}>) contains ${blockChildren.length} block-level children including potential nested callouts`);
          }
          
          // Special handling for <div> with mixed content (text + block elements)
          if (childTag === 'div' && hasBlockChildren) {
            console.log(`🔍   Child ${i}: <div> contains ${blockChildren.length} block children - extracting mixed content`);
            
            // Extract direct text nodes and inline elements, but process block children separately
            const $tempDiv = $('<div></div>');
            const blockProcessingPromises = [];
            
            // Process each child of the div
            const divChildren = Array.from($child.get(0).childNodes);
            for (const node of divChildren) {
              const nodeTag = node.tagName?.toLowerCase();
              const $node = $(node);
              const nodeClass = $node.attr('class') || '';
              
              // Check if this is a nested callout (div.note, div.info, etc.)
              const isNestedCallout = nodeTag === 'div' && 
                /\b(note|info|warning|important|tip|caution)\b/.test(nodeClass);
              
              if (node.type === 'text') {
                // Keep text nodes in the callout
                $tempDiv.append(node.cloneNode(true));
              } else if (['ul', 'ol', 'table', 'pre', 'blockquote'].includes(nodeTag)) {
                // Process block elements separately (await these later)
                console.log(`🔍     Queuing block child <${nodeTag}> for separate processing`);
                blockProcessingPromises.push(processElement(node));
              } else if (isNestedCallout) {
                // FLATTEN nested callout - extract its text and add to parent callout
                console.log(`🔍 [NESTED-CALLOUT-PREREQ] Flattening nested callout in prereq: <${nodeTag} class="${nodeClass}">`);
                const nestedCalloutHtml = $node.html() || '';
                // Remove the title span from nested callout
                const cleanedHtml = nestedCalloutHtml.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1');
                // Add a newline before the nested callout content to separate it from previous content
                // This prevents code-formatted text (like "admin") from bleeding into the next line ("Note")
                const hasExistingContent = $tempDiv.text().trim().length > 0;
                if (hasExistingContent) {
                  $tempDiv.append('<br/>'); // Use <br/> so it becomes a newline during rich text parsing
                }
                $tempDiv.append(cleanedHtml); // Add nested callout text to parent callout
              } else {
                // Keep inline elements in the callout
                $tempDiv.append(node.cloneNode(true));
              }
            }
            
            // Parse the inline content for the callout
            const inlineHtml = $tempDiv.html();
            if (inlineHtml && inlineHtml.trim()) {
              console.log(`🔍     Inline content for callout: "${inlineHtml.substring(0, 60)}..."`);
              const { richText: childRichText, imageBlocks: childImages } = await parseRichText(inlineHtml);
              
              // Add a line break between children - but use a SEPARATE element to avoid carrying over annotations
              if (richTextElements.length > 0 && childRichText.length > 0) {
                richTextElements.push({
                  type: 'text',
                  text: { content: '\n' },
                  annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                });
                console.log(`🔍   Added line break as separate element (no annotation carryover)`);
              }
              
              richTextElements.push(...childRichText);
              imageBlocks.push(...childImages);
            }
            
            // Now await all block processing and convert to inline text for callout
            if (blockProcessingPromises.length > 0) {
              console.log(`🔍     Awaiting ${blockProcessingPromises.length} block children...`);
              const blockResults = await Promise.all(blockProcessingPromises);
              for (const blocks of blockResults) {
                if (blocks && blocks.length > 0) {
                  console.log(`🔍     Converting ${blocks.length} blocks to inline text for callout`);
                  // Convert block elements (lists) to plain text with bullet characters
                  for (const block of blocks) {
                    if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
                      // Extract text from list item and add bullet
                      const itemText = block.bulleted_list_item.rich_text
                        .map(rt => rt.text?.content || '')
                        .join('');
                      
                      if (itemText.trim()) {
                        // Add newline before bullet if there's existing content (as separate element to avoid annotation carryover)
                        if (richTextElements.length > 0) {
                          richTextElements.push({
                            type: 'text',
                            text: { content: '\n' },
                            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                          });
                        }
                        // Add the list item text with formatting preserved
                        // Add bullet as a separate rich text element to preserve formatting
                        richTextElements.push({
                          type: "text",
                          text: { content: "• " },
                          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                        });
                        // Then add all the original rich text elements, but trim trailing spaces from code blocks
                        const cleanedRichText = block.bulleted_list_item.rich_text.map(rt => {
                          if (rt.annotations?.code && rt.text?.content) {
                            // Trim trailing (and leading) spaces from code-formatted text
                            return {
                              ...rt,
                              text: {
                                ...rt.text,
                                content: rt.text.content.trim()
                              }
                            };
                          }
                          return rt;
                        });
                        richTextElements.push(...cleanedRichText);
                        console.log(`🔍       Added list item to callout: "• ${itemText.substring(0, 50)}..."`);
                      }
                    } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
                      // For numbered lists, we'll use numbers
                      const itemText = block.numbered_list_item.rich_text
                        .map(rt => rt.text?.content || '')
                        .join('');
                      
                      if (itemText.trim()) {
                        if (richTextElements.length > 0) {
                          // Add line break as separate element to avoid carrying over annotations
                          richTextElements.push({
                            type: 'text',
                            text: { content: '\n' },
                            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                          });
                        }
                        // Clean up trailing spaces from code blocks, then add number prefix
                        const cleanedAndNumbered = block.numbered_list_item.rich_text.map((rt, idx) => {
                          let content = rt.text.content;
                          // Trim spaces from code-formatted text
                          if (rt.annotations?.code) {
                            content = content.trim();
                          }
                          return {
                            ...rt,
                            text: {
                              ...rt.text,
                              content: (idx === 0 ? '1. ' : '') + content
                            }
                          };
                        });
                        richTextElements.push(...cleanedAndNumbered);
                      }
                    }
                  }
                }
              }
            }
          } else if (['ul', 'ol'].includes(childTag)) {
            // Lists should be converted to inline text for the callout
            console.log(`🔍   Child ${i}: <${childTag}> is a list - converting to inline text for callout`);
            
            const childBlocks = await processElement(child);
            if (childBlocks.length > 0) {
              console.log(`🔍     Converting ${childBlocks.length} list items to inline text`);
              for (const block of childBlocks) {
                if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
                  const itemText = block.bulleted_list_item.rich_text
                    .map(rt => rt.text?.content || '')
                    .join('');
                  
                  if (itemText.trim()) {
                    if (richTextElements.length > 0) {
                      // Add line break as separate element to avoid carrying over annotations
                      richTextElements.push({
                        type: 'text',
                        text: { content: '\n' },
                        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                      });
                    }
                    // Preserve formatting from the original rich text
                    // Add bullet as separate element to preserve formatting
                    richTextElements.push({
                      type: "text",
                      text: { content: "• " },
                      annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                    });
                    // Then add all the original rich text elements, but trim trailing spaces from code blocks
                    const cleanedRichText = block.bulleted_list_item.rich_text.map(rt => {
                      if (rt.annotations?.code && rt.text?.content) {
                        // Trim trailing (and leading) spaces from code-formatted text
                        return {
                          ...rt,
                          text: {
                            ...rt.text,
                            content: rt.text.content.trim()
                          }
                        };
                      }
                      return rt;
                    });
                    richTextElements.push(...cleanedRichText);
                    console.log(`🔍       Added list item: "• ${itemText.substring(0, 50)}..."`);
                  }
                } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
                  const itemText = block.numbered_list_item.rich_text
                    .map(rt => rt.text?.content || '')
                    .join('');
                  
                  if (itemText.trim()) {
                    if (richTextElements.length > 0) {
                      // Add line break as separate element to avoid carrying over annotations
                      richTextElements.push({
                        type: 'text',
                        text: { content: '\n' },
                        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
                      });
                    }
                    // Clean up trailing spaces from code blocks, then add number prefix
                    const numberAdded = block.numbered_list_item.rich_text.map((rt, idx) => {
                      let content = rt.text.content;
                      // Trim spaces from code-formatted text
                      if (rt.annotations?.code) {
                        content = content.trim();
                      }
                      return {
                        ...rt,
                        text: {
                          ...rt.text,
                          content: (idx === 0 ? '1. ' : '') + content
                        }
                      };
                    });
                    richTextElements.push(...numberAdded);
                  }
                }
              }
            }
          } else if (['table', 'pre', 'blockquote'].includes(childTag)) {
            // Tables, code blocks, and blockquotes should be processed as separate blocks
            console.log(`🔍   Child ${i}: <${childTag}> is a block element - processing separately`);
            
            const childBlocks = await processElement(child);
            if (childBlocks.length > 0) {
              console.log(`🔍     Adding ${childBlocks.length} blocks from <${childTag}> to deferredBlocks`);
              deferredBlocks.push(...childBlocks);
            }
          } else {
            // No block children - process as inline HTML
            // CRITICAL FIX: Use outerHTML then extract inner content properly
            // This prevents attribute values from bleeding into content
            let childHtml = '';
            
            // Get the full outer HTML first
            const outerHtml = $.html($child);
            
            // Extract ONLY the inner content by removing the opening and closing tags
            // This ensures we don't accidentally include attribute values
            const openingTagMatch = outerHtml.match(/^<[^>]+>/);
            const closingTagMatch = outerHtml.match(/<\/[^>]+>$/);
            
            if (openingTagMatch && closingTagMatch) {
              // Strip the opening and closing tags to get pure inner HTML
              childHtml = outerHtml.substring(
                openingTagMatch[0].length,
                outerHtml.length - closingTagMatch[0].length
              );
            } else {
              // Fallback to original method if regex doesn't match
              childHtml = $child.html() || '';
            }
            
            console.log(`🔍   Child ${i}: <${childTag}> class="${$child.attr('class')}" content="${childHtml.substring(0, 60)}..."`);
            
            // Parse this child's HTML to rich text
            const { richText: childRichText, imageBlocks: childImages } = await parseRichText(childHtml);
            
            // Add a line break between children - but use a SEPARATE element to avoid carrying over annotations
            if (richTextElements.length > 0 && childRichText.length > 0) {
              richTextElements.push({
                type: 'text',
                text: { content: '\n' },
                annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
              });
              console.log(`🔍   Added line break as separate element (no annotation carryover)`);
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
        console.log(`🔍 Creating ${richTextChunks.length} prereq callout block(s)`);
        for (const chunk of richTextChunks) {
          processedBlocks.push({
            object: "block",
            type: "callout",
            callout: {
              rich_text: chunk,
              icon: { type: "emoji", emoji: "📍" },
              color: "default"
            }
          });
        }
      }
      
      // Now add the deferred blocks (lists, tables, etc.) AFTER the callout
      if (deferredBlocks.length > 0) {
        console.log(`🔍 Adding ${deferredBlocks.length} deferred blocks after callout`);
        processedBlocks.push(...deferredBlocks);
      }
      
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && $elem.hasClass('contentPlaceholder')) {
      // contentPlaceholder divs can contain actual content like "Related Content" sections
      // Need to drill down through contentContainer > contentWrapper to find actual content
      console.log(`🔍 🎯 contentPlaceholder FOUND - drilling into structure`);
      const contentWrapper = $elem.find('.contentWrapper').first();
      console.log(`🔍 🎯 contentWrapper found: ${contentWrapper.length > 0}`);
      const children = contentWrapper.length > 0 ? contentWrapper.children().toArray() : $elem.find('> *').toArray();
      console.log(`🔍 🎯 contentPlaceholder children count: ${children.length}`);
      children.forEach((child, idx) => {
        const $child = $(child);
        const tagName = child.name || 'unknown';
        const classes = $child.attr('class') || 'none';
        const hasH5 = $child.find('h5').length;
        console.log(`🔍 🎯   Child ${idx}: <${tagName} class="${classes}"> hasH5=${hasH5}`);
      });
      
      const hasContent = children.some(child => {
        const $child = $(child);
        // Skip miniTOC (table of contents navigation) and buttons
        if ($child.hasClass('miniTOC')) return false;
        if ($child.is('button')) return false;
        
        const text = cleanHtmlText($child.html() || '').trim();
        const hasNavElements = $child.find('nav, [role="navigation"]').length > 0 || $child.is('nav, [role="navigation"]');
        return text.length > 20 || $child.find('h1, h2, h3, h4, h5, h6, ul, ol, p, a').length > 0 || hasNavElements;
      });
      
      console.log(`🔍 🎯 contentPlaceholder hasContent: ${hasContent}`);
      
      if (hasContent) {
        console.log(`🔍 contentPlaceholder has meaningful content (${children.length} children) - processing`);
        for (const child of children) {
          const $child = $(child);
          // Skip miniTOC div (On this page navigation) and buttons
          if ($child.hasClass('miniTOC')) {
            console.log(`🔍   Skipping miniTOC (On this page navigation)`);
            continue;
          }
          if ($child.is('button')) {
            console.log(`🔍   Skipping button element`);
            continue;
          }
          
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
      // Include > img so standalone images are recognized as block children
      const blockChildren = $elem.find('> div, > p, > ul, > ol, > table, > pre, > figure, > img').toArray();
      
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
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  });
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
                  processedBlocks.push({
                    object: "block",
                    type: "paragraph",
                    paragraph: { rich_text: chunk }
                  });
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
                processedBlocks.push({
                  object: "block",
                  type: "paragraph",
                  paragraph: { 
                    rich_text: chunk,
                    children: divImages  // Add images as children
                  }
                });
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
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              });
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
        for (const nestedBlock of nestedBlocks) {
          const childBlocks = await processElement(nestedBlock);
          nestedChildren.push(...childBlocks);
        }
        
        // Create numbered list item with text and children
        const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
        const validChildren = [];
        const postListBlocks = [];
        for (const block of nestedChildren) {
          if (block && block.type && supportedAsChildren.includes(block.type)) {
            validChildren.push(block);
          } else if (block) {
            postListBlocks.push(block);
          }
        }
        
        if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
          processedBlocks.push({
            object: "block",
            type: "numbered_list_item",
            numbered_list_item: {
              rich_text: liRichText,
              children: validChildren.length > 0 ? validChildren : undefined
            }
          });
          if (postListBlocks.length > 0) {
            console.log(`🔁 [Orphan LI] Emitting ${postListBlocks.length} sibling block(s) after list item`);
            processedBlocks.push(...postListBlocks);
          }
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
          if (postListBlocks.length > 0) {
            console.log(`🔁 [Orphan LI] Emitting ${postListBlocks.length} sibling block(s) after promoted list item`);
            processedBlocks.push(...postListBlocks);
          }
        } else if (postListBlocks.length > 0) {
          console.log(`🔁 [Orphan LI] No valid children; emitting ${postListBlocks.length} sibling block(s)`);
          processedBlocks.push(...postListBlocks);
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
      
      // FAST PATH: If there are NO element children but there is direct text/HTML, treat this container
      // as a paragraph wrapper so we don't lose important plain-text content (e.g., stray divs in sections).
      if (children.length === 0) {
        const html = fullHtml;
        const cleaned = cleanHtmlText(html).trim();
        if (cleaned) {
          const cId = $elem.attr('id') || '';
          const cClass = $elem.attr('class') || '';
          console.log(`🔍 [TEXT-RESCUE] Container <${tagName}${cId?` id="${cId}"`:''}${cClass?` class="${cClass}"`:''}> has no element children but has text - creating paragraph`);
          const { richText: containerText, imageBlocks: containerImages } = await parseRichText(html);
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
          $elem.remove();
          return processedBlocks;
        }
      }

      if (directText && children.length > 0) {
        // Mixed content: has both text nodes and child elements
        console.log(`🔍 Container <${tagName}> has mixed content (text + ${children.length} children)`);
        console.log(`🔍 Direct text preview: "${directText.substring(0, 80)}..."`);
        
        // Check if children are block-level or inline elements
        const blockLevelChildren = children.filter(child => {
          const childTag = child.name;
          return ['div', 'p', 'section', 'article', 'main', 'ul', 'ol', 'pre', 'figure', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(childTag);
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
          
          // Process only block-level children (inline elements are already in the paragraph)
          for (const child of blockLevelChildren) {
            const childBlocks = await processElement(child);
            processedBlocks.push(...childBlocks);
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
        if (tagName === 'article' && elemClass.includes('nested1')) {
          // Try to find the heading for this article
          const $heading = $elem.find('> h1, > h2').first();
          if ($heading.length > 0) {
            articleTitle = cleanHtmlText($heading.text()).trim().substring(0, 80);
          }
          console.log(`\n📘 ========== ARTICLE.NESTED1 START ==========`);
          console.log(`📘 Article ID: ${elemId || 'NO ID'}`);
          console.log(`📘 Article Title: "${articleTitle || 'NO TITLE'}"`);
          console.log(`📘 Children count: ${children.length}`);
          console.log(`📘 ============================================\n`);
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
            processedChildCount++;
            console.log(`🔍   Processing child ${processedChildCount}/${children.length}: <${child.name}>${$(child).attr('class') ? ` class="${$(child).attr('class')}"` : ''}`);
            const childBlocks = await processElement(child);
            console.log(`🔍   Child ${processedChildCount} produced ${childBlocks.length} blocks`);
            processedBlocks.push(...childBlocks);
          }
          console.log(`🔍   Finished processing all ${processedChildCount}/${children.length} children`);
          
          // TRACK ARTICLE.NESTED1 COMPLETION
          if (tagName === 'article' && elemClass.includes('nested1')) {
            console.log(`\n📘 ========== ARTICLE.NESTED1 END ==========`);
            console.log(`📘 Article ID: ${elemId || 'NO ID'}`);
            console.log(`📘 Article Title: "${articleTitle || 'NO TITLE'}"`);
            console.log(`📘 Total blocks produced: ${processedBlocks.length}`);
            console.log(`📘 ==========================================\n`);
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
    
    // Collect nav elements and contentPlaceholders early (used in multiple paths below)
    const articleNavs = $('.zDocsTopicPageBody article > nav, .zDocsTopicPageBody article[role="article"] > nav').toArray();
    
    // CRITICAL FIX: contentPlaceholder divs are often SIBLINGS of .zDocsTopicPageBody, not children!
    // Search for them in the entire page, just like we do for orphaned sections
    const allContentPlaceholders = $('.contentPlaceholder').toArray();
    console.log(`🔍 🎯 Found ${allContentPlaceholders.length} contentPlaceholder divs on entire page`);
    const contentPlaceholders = allContentPlaceholders;
    
    // CRITICAL FIX: Check if sections exist deeper in the tree (not just as direct children)
    // ServiceNow pages often have structure: .zDocsTopicPageBody > div.zDocsTopicPageBodyContent > article > main > article.dita > div.body.conbody
    // And sections can be either children of body.conbody OR siblings of it!
    const allSectionsInPage = $('section[id]').toArray();
    const allSectionsInBody = $('.zDocsTopicPageBody section[id]').toArray();
    const allArticlesInBody = $('.zDocsTopicPageBody article').toArray();
    
    console.log(`🔍 CRITICAL: Found ${allSectionsInPage.length} sections in ENTIRE PAGE`);
    console.log(`🔍 CRITICAL: Found ${allSectionsInBody.length} sections inside .zDocsTopicPageBody`);
    console.log(`🔍 CRITICAL: Found ${allArticlesInBody.length} articles inside .zDocsTopicPageBody`);
    
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
      // CRITICAL FIX: Sections may have different parents, so collect ALL unique parents
      const allParents = allSectionsInBody.map(sec => $(sec).parent().get(0));
      const uniqueParents = [...new Set(allParents)];
      
      console.log(`🔍 FIX: Found ${allSectionsInBody.length} sections with ${uniqueParents.length} unique parent(s)`);
      
      // NEW STRATEGY: If sections have multiple parents, collect from each parent
      if (uniqueParents.length > 1) {
        console.log(`🔍 FIX: Sections have multiple parents - collecting from each parent container`);
        
        // CRITICAL: Filter out ancestor parents to avoid collecting the same content multiple times
        // If Parent A contains Parent B, only collect from Parent B (the deepest one)
        const nonAncestorParents = uniqueParents.filter(parentEl => {
          const $parent = $(parentEl);
          // Check if ANY other parent is a descendant of this parent
          const hasDescendantParent = uniqueParents.some(otherParentEl => {
            return otherParentEl !== parentEl && $(otherParentEl).closest(parentEl).length > 0;
          });
          // Keep this parent only if it doesn't have any descendant parents
          return !hasDescendantParent;
        });
        
        if (nonAncestorParents.length < uniqueParents.length) {
          console.log(`🔍 FIX: Filtered out ${uniqueParents.length - nonAncestorParents.length} ancestor parent(s) to avoid duplication`);
        }
        
        // For each non-ancestor parent, get all its children
        const allContainerChildren = [];
        nonAncestorParents.forEach(parentEl => {
          const $parent = $(parentEl);
          const children = $parent.children().toArray();
          const parentTag = $parent.prop('tagName');
          const parentClass = $parent.attr('class') || 'no-class';
          
          console.log(`🔍 FIX: Collecting ${children.length} children from parent <${parentTag} class="${parentClass}">`);
          
          // Add all children from this parent
          allContainerChildren.push(...children);
        });
        
        console.log(`🔍 FIX: Collected ${allContainerChildren.length} total children from ${nonAncestorParents.length} parent container(s)`);
        console.log(`🔍 FIX: ⚠️ Will sort by DOM order after deduplication to fix any ordering issues`);
        contentElements = [...allContainerChildren, ...articleNavs, ...contentPlaceholders];
        console.log(`🔍 ✅ Using ${contentElements.length} elements from multiple parents as contentElements`);
      } else {
        // All sections share same parent - use original logic
        const firstSection = $(allSectionsInBody[0]);
        const sectionParent = firstSection.parent();
        const sectionParentTag = sectionParent.prop('tagName');
        const sectionParentClass = sectionParent.attr('class') || 'no-class';
        
        console.log(`🔍 All sections share parent: <${sectionParentTag} class="${sectionParentClass}">`);
        console.log(`🔍 Section parent has ${sectionParent.children().length} children total`);
        
        const sectionParentChildren = sectionParent.children().toArray();
        console.log(`🔍 Section parent children: ${sectionParentChildren.map(c => `<${c.name} class="${$(c).attr('class') || ''}" id="${$(c).attr('id') || ''}">`).join(', ')}`);
        
        if (articleNavs.length > 0) {
          console.log(`🔍 ✅ Found ${articleNavs.length} nav element(s) as children of articles, adding to contentElements`);
        }
        if (contentPlaceholders.length > 0) {
          console.log(`🔍 ✅ Found ${contentPlaceholders.length} contentPlaceholder element(s), adding to contentElements`);
        }
        contentElements = [...sectionParentChildren, ...articleNavs, ...contentPlaceholders];
        console.log(`🔍 ✅ Using ${contentElements.length} elements from section parent as contentElements`);
      }
    } else {
      // No sections found, use original top-level children
      contentElements = topLevelChildren;
    }
    
    // ========================================
    // 🎯 UNIVERSAL APPROACH: Use article.nested1 as primary content source
    // ========================================
    // ServiceNow pages can have article.nested1 elements in different locations:
    // 1. Inside .zDocsTopicPageBody (most common)
    // 2. As siblings of .zDocsTopicPageBody (orphaned articles like OAuth page)
    // 3. Inside article.nested0 containers (nested structure)
    //
    // 🎯 UNIVERSAL ARTICLE COLLECTION STRATEGY:
    // ServiceNow uses different article patterns across different page types:
    // 1. article.nested1 (newer pages) - nested articles with procedures
    // 2. article[role="article"].dita (OAuth pages) - DITA-based articles
    // 3. article.nested0 (wrapper) - contains shared intro content
    //
    // We need to detect and collect articles using BOTH patterns.
    
    // Pattern 1: article.nested1 (e.g., Predictive Intelligence pages)
    const allNested1 = $('article.nested1').toArray();
    console.log(`🎯 UNIVERSAL: Found ${allNested1.length} article.nested1 elements`);
    
    // Pattern 2: article[role="article"] (e.g., OAuth JWT pages)
    // Exclude article.nested0 (wrapper) and article.hascomments (outer wrapper)
    const allDitaArticles = $('article[role="article"]:not(.nested0):not(.hascomments)').toArray();
    console.log(`🎯 UNIVERSAL: Found ${allDitaArticles.length} article[role="article"] elements`);
    
    // Combine both patterns, preferring whichever has results
    let allArticles = [];
    if (allNested1.length > 0) {
      allArticles = allNested1;
      console.log(`🎯 Using article.nested1 pattern (${allArticles.length} articles)`);
    } else if (allDitaArticles.length > 0) {
      allArticles = allDitaArticles;
      console.log(`🎯 Using article[role="article"] pattern (${allArticles.length} articles)`);
    }
    
    // Diagnostic: Show details about each article
    allArticles.forEach((article, idx) => {
      const $article = $(article);
      const articleId = $article.attr('id') || 'NO-ID';
      const title = $article.find('h2, .title').first().text().trim() || 'NO-TITLE';
      const inBody = $article.closest('.zDocsTopicPageBody').length > 0;
      const parentTag = $article.parent().prop('tagName');
      const parentClass = $article.parent().attr('class') || 'no-class';
      console.log(`🎯   Article ${idx + 1}: "${articleId}" title="${title.substring(0, 60)}" inBody=${inBody} parent=<${parentTag} class="${parentClass}">`);
    });
    
    // If we found articles, use them as the primary content source
    if (allArticles.length > 0) {
      console.log(`🎯 ✅ UNIVERSAL OVERRIDE: Using all ${allArticles.length} articles as contentElements`);
      console.log(`🎯    This replaces container-based detection and captures ALL articles regardless of location`);
      
      // CRITICAL FIX: Also collect any top-level sections that are SIBLINGS of articles (NOT inside them)
      // Some pages have sections in multiple locations:
      // 1. Inside .zDocsTopicPageBodyContent but outside articles (Properties, User roles, etc.)
      // 2. Direct children of .zDocsTopicPageBody (Script includes)
      // 3. OUTSIDE .zDocsTopicPageBody entirely - SIBLINGS of it! (Client scripts, UI policies, etc.)
      // Strategy: Find ALL section.section elements in the entire page, then filter out those inside articles
      const allSectionsOnPage = $('section.section').toArray();
      console.log(`🎯 🔍 Found ${allSectionsOnPage.length} total sections on entire page`);
      
      const topLevelSections = allSectionsOnPage.filter(section => {
        // Check if this section is inside any article element
        const $section = $(section);
        const isInsideArticle = $section.closest('article').length > 0;
        return !isInsideArticle; // Only keep sections NOT inside articles
      });
      
      if (topLevelSections.length > 0) {
        console.log(`🎯 🔍 SIBLING SECTIONS: Found ${topLevelSections.length} sections OUTSIDE articles (from ${allSectionsOnPage.length} total)`);
        topLevelSections.forEach((section, idx) => {
          const $section = $(section);
          const sectionId = $section.attr('id') || 'no-id';
          const title = $section.find('> h2, > .title').first().text().trim() || 'NO-TITLE';
          const parent = $section.parent();
          const parentTag = parent.prop('tagName') || 'unknown';
          const parentClass = parent.attr('class') || 'no-class';
          console.log(`🎯    Section ${idx + 1}: id="${sectionId}" title="${title.substring(0, 60)}" parent=<${parentTag} class="${parentClass}">`);
        });
      } else {
        console.log(`🎯 ℹ️  No sections found outside articles`);
      }
      
      // CRITICAL FIX: Also collect SIBLING TABLES that are NOT inside articles
      // Some ServiceNow pages (e.g., "Accept an improvement") have tables as siblings of articles
      // Structure: <article></article> <div class="table-wrap"><table>...</table></div> <table>...</table>
      const allTablesOnPage = $('table').toArray();
      console.log(`🎯 🔍 Found ${allTablesOnPage.length} total tables on entire page`);
      
      const allTableWrapsOnPage = $('div.table-wrap').toArray();
      console.log(`🎯 🔍 Found ${allTableWrapsOnPage.length} total table-wrap divs on entire page`);
      
      const topLevelTables = allTablesOnPage.filter(table => {
        const $table = $(table);
        const isInsideArticle = $table.closest('article').length > 0;
        return !isInsideArticle; // Only keep tables NOT inside articles
      });
      
      const topLevelTableWraps = allTableWrapsOnPage.filter(wrap => {
        const $wrap = $(wrap);
        const isInsideArticle = $wrap.closest('article').length > 0;
        return !isInsideArticle; // Only keep table-wraps NOT inside articles
      });
      
      if (topLevelTables.length > 0 || topLevelTableWraps.length > 0) {
        console.log(`🎯 🔍 SIBLING TABLES: Found ${topLevelTables.length} tables + ${topLevelTableWraps.length} table-wraps OUTSIDE articles`);
        topLevelTables.forEach((table, idx) => {
          const $table = $(table);
          const tableId = $table.attr('id') || 'no-id';
          const caption = $table.find('caption .title').first().text().trim() || 'NO-CAPTION';
          console.log(`🎯    Table ${idx + 1}: id="${tableId}" caption="${caption}"`);
        });
        topLevelTableWraps.forEach((wrap, idx) => {
          const $wrap = $(wrap);
          const table = $wrap.find('table').first();
          const tableId = table.attr('id') || 'no-id';
          const caption = table.find('caption .title').first().text().trim() || 'NO-CAPTION';
          console.log(`🎯    TableWrap ${idx + 1}: contains table id="${tableId}" caption="${caption}"`);
        });
      } else {
        console.log(`🎯 ℹ️  No tables found outside articles`);
      }
      
      // Check for article.nested0 wrapper with intro content
      const nested0 = $('article.nested0').first();
      if (nested0.length > 0) {
        console.log(`🎯 📝 Found article.nested0 wrapper - checking for intro content`);
        
        // Extract the body container AND any orphaned content after nested0
        // Structure: article.nested0 > div.body.conbody (contains shortdesc + sections)
        // After article.nested0 closes, there may be orphaned notes/paragraphs/lists
        const bodyConbody = nested0.find('> div.body.conbody').first();
        const introElements = [];
        
        if (bodyConbody.length > 0) {
          console.log(`🎯 ✅ Found div.body.conbody in nested0`);
          introElements.push(bodyConbody.get(0));
          
          const shortdesc = bodyConbody.find('> p.shortdesc');
          const sections = bodyConbody.find('> section');
          console.log(`🎯    Contains: ${shortdesc.length} shortdesc + ${sections.length} sections`);
        }
        
        // Also collect any orphaned content AFTER article.nested0 closes
        // CRITICAL: Orphaned content can appear at multiple DOM levels:
        // 1. As siblings of nested0's parent wrappers
        // 2. As direct children of .zDocsTopicPageBody
        // 3. Scattered between wrapper divs
        // 4. AFTER .zDocsTopicPageBody closes (as siblings in the body)
        // Strategy: Find ALL meaningful content in AND after .zDocsTopicPageBody that's NOT inside article.nested1
        
        // Search inside .zDocsTopicPageBody
        // CRITICAL: Also include plain <div> elements (no class) that may contain orphaned text
        const insideCandidates = $('.zDocsTopicPageBody')
          .find('div.note, div.p, div:not([class]), p:not([class*="shortdesc"]), ul, ol')
          .toArray();
        
        // ALSO search for orphaned content AFTER .zDocsTopicPageBody closes
        // This catches content that appears as siblings after the main container
        const topicBodyDiv = $('.zDocsTopicPageBody').first();
        const afterCandidates = [];
        if (topicBodyDiv.length > 0) {
          let sibling = topicBodyDiv.get(0).nextSibling;
          while (sibling) {
            if (sibling.type === 'tag') {
              const $sibling = $(sibling);
              // Check if it matches our orphan patterns
              const tag = sibling.name;
              const siblingText = $sibling.text().trim();
              // CRITICAL: Also include plain <div> elements (no class) with meaningful text
              if (tag === 'div' && ($sibling.hasClass('note') || $sibling.hasClass('p') || (!$sibling.attr('class') && siblingText.length > 20))) {
                afterCandidates.push(sibling);
              } else if (tag === 'p' || tag === 'ul' || tag === 'ol') {
                afterCandidates.push(sibling);
              }
              // Also search within this sibling for nested orphans (including plain divs)
              const nested = $sibling.find('div.note, div.p, div:not([class]), p:not([class*="shortdesc"]), ul, ol').toArray();
              afterCandidates.push(...nested);
            }
            sibling = sibling.nextSibling;
          }
        }
        
        const allOrphanCandidates = [...insideCandidates, ...afterCandidates];
        
        console.log(`🎯 🔍 Found ${insideCandidates.length} potential orphan candidates inside zDocsTopicPageBody`);
        console.log(`🎯 🔍 Found ${afterCandidates.length} potential orphan candidates AFTER zDocsTopicPageBody`);
        console.log(`🎯 🔍 Total ${allOrphanCandidates.length} potential orphan candidates`);
        
        // Filter to only elements that are:
        // 1. NOT inside article.nested1 (those are already processed)
        //    EXCEPTION: allow likely "list continuation" paragraphs that appear after an <ol>
        // 2. NOT inside article.nested0's body.conbody (already collected above)
        // 3. NOT miniTOC navigation elements (On this page navigation)
        // 4. Have meaningful text content
        const meaningfulOrphans = allOrphanCandidates.filter(el => {
          const $el = $(el);
          const tag = el.name;
          const text = $el.text().trim();
          const classes = $el.attr('class') || 'no-class';
          const textPreview = text.substring(0, 80);
          
          console.log(`🎯 🔍 Candidate: <${tag} class="${classes}"> "${textPreview}..."`);
          
          // Skip if inside any article.nested1, UNLESS it's likely a continuation of a numbered list
          if ($el.closest('article.nested1').length > 0) {
            // Heuristic: paragraphs that immediately follow an <ol> within the same section/article
            const isParaLike = tag === 'p' || (tag === 'div' && $el.hasClass('p'));
            let prevOlNearby = false;
            if (isParaLike && text.length > 10) {
              // Look for a nearby previous <ol> among element siblings (up to 5 steps back)
              let prev = $el.prev();
              let steps = 0;
              while (prev && prev.length && steps < 5) {
                if (prev.is('ol')) { prevOlNearby = true; break; }
                prev = prev.prev();
                steps++;
              }
              // Also check previous siblings of the parent (up to 3 steps)
              if (!prevOlNearby) {
                const $parent = $el.parent();
                if ($parent && $parent.length) {
                  let pPrev = $parent.prev();
                  let pSteps = 0;
                  while (pPrev && pPrev.length && pSteps < 3) {
                    if (pPrev.is('ol')) { prevOlNearby = true; break; }
                    pPrev = pPrev.prev();
                    pSteps++;
                  }
                }
              }
            }

            if (!prevOlNearby) {
              console.log(`🎯   ❌ Filtered: inside article.nested1`);
              return false;
            } else {
              console.log(`🎯   ✅ KEEPING orphan inside nested1 as list continuation after <ol>`);
            }
          }
          
          // Skip if inside article.nested0's body.conbody (already collected)
          if ($el.closest('article.nested0 div.body.conbody').length > 0) {
            console.log(`🎯   ❌ Filtered: inside article.nested0 body.conbody`);
            return false;
          }
          
          // Skip miniTOC navigation elements (On this page navigation)
          if ($el.hasClass('linkList') || $el.closest('.miniTOC').length > 0 || $el.closest('.linkList').length > 0) {
            console.log(`🎯   ❌ Filtered: miniTOC navigation element`);
            return false;
          }
          
          // Skip empty elements
          if (text.length === 0) {
            console.log(`🎯   ❌ Filtered: empty`);
            return false;
          }
          
          // Keep meaningful semantic elements
          // CRITICAL: Also accept plain <div> elements (no class) if they have meaningful text
          const isValid = (
            tag === 'div' && ($el.hasClass('note') || $el.hasClass('p') || (!$el.attr('class') && text.length > 20)) ||
            tag === 'p' ||
            tag === 'ul' ||
            tag === 'ol'
          );
          
          if (isValid) {
            console.log(`🎯   ✅ KEEPING orphan`);
          } else {
            console.log(`🎯   ❌ Filtered: not a meaningful semantic element`);
          }
          
          return isValid;
        });
        
        if (meaningfulOrphans.length > 0) {
          console.log(`🎯 ✅ Found ${meaningfulOrphans.length} orphaned content elements (notes, paragraphs, lists)`);

          // Normalize certain orphans: if a paragraph inside nested1 likely continues a numbered list,
          // convert it to an orphan <li> so it becomes a proper numbered_list_item in Notion.
          const normalizedOrphans = [];
          meaningfulOrphans.forEach((el, idx) => {
            const $el = $(el);
            const tagName = el.name;
            const textFull = $el.text().trim();
            const text = textFull.substring(0, 80);
            const classes = $el.attr('class') || 'no-class';
            const insideNested1 = $el.closest('article.nested1').length > 0;

            // Determine if this orphan is a list-continuation paragraph
            const isParaLike = tagName === 'p' || (tagName === 'div' && $el.hasClass('p'));
            let prevOlNearby = false;
            if (insideNested1 && isParaLike && textFull.length > 10) {
              let prev = $el.prev();
              let steps = 0;
              while (prev && prev.length && steps < 5) {
                if (prev.is('ol')) { prevOlNearby = true; break; }
                prev = prev.prev();
                steps++;
              }
              if (!prevOlNearby) {
                const $parent = $el.parent();
                if ($parent && $parent.length) {
                  let pPrev = $parent.prev();
                  let pSteps = 0;
                  while (pPrev && pPrev.length && pSteps < 3) {
                    if (pPrev.is('ol')) { prevOlNearby = true; break; }
                    pPrev = pPrev.prev();
                    pSteps++;
                  }
                }
              }
            }

            if (insideNested1 && isParaLike && prevOlNearby) {
              // Convert paragraph to orphan <li> to create a proper numbered list item
              const $li = $('<li class="li"></li>');
              const html = $el.html() || $el.text();
              $li.html(html);
              console.log(`🔧 [LIST-CONTINUATION-FIX] Converting orphan paragraph to orphan <li>: "${text}..."`);
              normalizedOrphans.push($li.get(0));
            } else {
              normalizedOrphans.push(el);
            }

            console.log(`🎯    Orphan ${idx + 1}: <${tagName} class="${classes}"> "${text}..."`);
          });

          introElements.push(...normalizedOrphans);
        } else {
          console.log(`🎯 ℹ️  No orphaned content found outside articles`);
        }
        
        if (introElements.length > 0) {
          console.log(`🎯 ✅ Total intro/orphaned elements: ${introElements.length}`);
          
          // Prepend intro content before articles, append sibling sections + tables after
          contentElements = [...introElements, ...allArticles, ...topLevelSections, ...topLevelTableWraps, ...topLevelTables, ...articleNavs, ...contentPlaceholders];
          console.log(`🎯 ✅ Total contentElements: ${contentElements.length} (${introElements.length} intro+orphaned + ${allArticles.length} articles + ${topLevelSections.length} sections + ${topLevelTableWraps.length} table-wraps + ${topLevelTables.length} tables + ${articleNavs.length} navs + ${contentPlaceholders.length} placeholders)`);
        } else {
          console.log(`🎯 ℹ️  No intro or orphaned elements found in/after nested0`);
          contentElements = [...allArticles, ...topLevelSections, ...topLevelTableWraps, ...topLevelTables, ...articleNavs, ...contentPlaceholders];
          console.log(`🎯 ✅ Total contentElements: ${contentElements.length} (${allArticles.length} articles + ${topLevelSections.length} sections + ${topLevelTableWraps.length} table-wraps + ${topLevelTables.length} tables + ${articleNavs.length} navs + ${contentPlaceholders.length} placeholders)`);
        }
      } else {
        // No nested0 wrapper, use articles + sibling sections + sibling tables
        contentElements = [...allArticles, ...topLevelSections, ...topLevelTableWraps, ...topLevelTables, ...articleNavs, ...contentPlaceholders];
        console.log(`🎯 ✅ Total contentElements: ${contentElements.length} (${allArticles.length} articles + ${topLevelSections.length} sections + ${topLevelTableWraps.length} table-wraps + ${topLevelTables.length} tables + ${articleNavs.length} navs + ${contentPlaceholders.length} placeholders)`);
      }
    } else {
      // Fallback: No articles found using universal patterns, keep container-based contentElements
      console.log(`🎯 ⚠️  WARNING: No articles found using known universal patterns!`);
      console.log(`🎯 ⚠️  This may indicate a new ServiceNow page structure that needs analysis.`);
      console.log(`🎯 ⚠️  Falling back to container-based detection (${contentElements.length} elements)`);
      
      // Diagnostic: Show what article elements exist on the page (if any)
      const allArticlesOnPage = $('article').toArray();
      if (allArticlesOnPage.length > 0) {
        console.log(`🎯 📊 DIAGNOSTIC: Found ${allArticlesOnPage.length} <article> elements on page with these patterns:`);
        const articlePatterns = new Map();
        allArticlesOnPage.forEach(article => {
          const $article = $(article);
          const classes = $article.attr('class') || 'no-class';
          const role = $article.attr('role') || 'no-role';
          const id = $article.attr('id') || 'no-id';
          const key = `<article class="${classes}" role="${role}">`;
          const existing = articlePatterns.get(key) || { count: 0, ids: [] };
          existing.count++;
          existing.ids.push(id);
          articlePatterns.set(key, existing);
        });
        
        articlePatterns.forEach((info, pattern) => {
          console.log(`🎯 📊   ${info.count}x ${pattern}`);
          console.log(`🎯 📊      IDs: ${info.ids.slice(0, 3).join(', ')}${info.ids.length > 3 ? '...' : ''}`);
        });
        
        console.log(`🎯 💡 Consider updating universal article collection to support these patterns.`);
      } else {
        console.log(`🎯 📊 DIAGNOSTIC: No <article> elements found on page (unusual structure)`);
      }
    }
    
    // FIX: Collect orphaned <li> elements that are NOT inside any ol/ul
    // These can appear anywhere in the page body due to malformed ServiceNow HTML
    const allLis = $('.zDocsTopicPageBody li').toArray();
    const orphanedLis = allLis.filter(li => {
      const $li = $(li);
      // Check if this <li> has an <ol> or <ul> as a parent
      const hasListParent = $li.closest('ol, ul').length > 0;
      return !hasListParent;
    });
    
    if (orphanedLis.length > 0) {
      console.log(`🔍 FIX: Found ${orphanedLis.length} orphaned <li> elements (not inside ol/ul)`);
      orphanedLis.forEach((li, idx) => {
        const $li = $(li);
        const text = $li.text().trim().substring(0, 80);
        const parentTag = $li.parent().prop('tagName');
        const parentClass = $li.parent().attr('class') || 'no-class';
        console.log(`🔍 FIX:   Orphan LI ${idx + 1}: "${text}..." parent=<${parentTag} class="${parentClass}">`);
      });
      contentElements.push(...orphanedLis);
      console.log(`🔍 FIX: Added ${orphanedLis.length} orphaned <li> to contentElements (now ${contentElements.length} total)`);
    }
    
    // FIX: Deduplicate contentElements array (orphan collection strategies may overlap)
    // Use a Map with element identity key (cheerio element reference won't work with Set)
    const uniqueElements = [];
    const seenElementKeys = new Set();
    
    for (const el of contentElements) {
      // Create unique key: tag name + id + position in parent + text preview
      const $el = $(el);
      const tag = el.name || 'unknown';
      const id = $el.attr('id') || '';
      const parent = $el.parent();
      const indexInParent = parent.length > 0 ? parent.children().index(el) : -1;
      const textPreview = $el.text().trim().substring(0, 50);
      const key = `${tag}|${id}|${indexInParent}|${textPreview}`;
      
      if (!seenElementKeys.has(key)) {
        seenElementKeys.add(key);
        uniqueElements.push(el);
      } else {
        console.log(`🔍 FIX: Skipping duplicate element: <${tag}> id="${id}" text="${textPreview.substring(0, 30)}..."`);
      }
    }
    
    if (uniqueElements.length < contentElements.length) {
      console.log(`🔍 FIX: Deduplicated contentElements: ${contentElements.length} → ${uniqueElements.length} (removed ${contentElements.length - uniqueElements.length} duplicates)`);
      contentElements = uniqueElements;
    }
    
    // Sort contentElements by original DOM order using the element order map
    // This ensures orphan elements appear in their correct position, not at the bottom
    contentElements.sort((a, b) => {
      const orderA = elementOrderMap.has(a) ? elementOrderMap.get(a) : Number.MAX_SAFE_INTEGER;
      const orderB = elementOrderMap.has(b) ? elementOrderMap.get(b) : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
    console.log(`🗺️ Sorted ${contentElements.length} content elements by DOM order`);
    
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
    const $child = $(child);
    const childId = $child.attr('id') || 'no-id';
    const childClass = $child.attr('class') || 'no-class';
    const childTag = child.name;
    
    // Skip miniTOC navigation elements (On this page navigation)
    if ($child.hasClass('linkList') || $child.hasClass('miniTOC') || $child.closest('.miniTOC').length > 0) {
      console.log(`🔍 Skipping miniTOC navigation element: <${childTag} id="${childId}" class="${childClass}">`);
      continue;
    }
    
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
  // Count elements with actual text content, not just empty wrappers
  let unprocessedElements = 0;
  let elementsToCheck = [];
  
  if ($('body').length > 0) {
    elementsToCheck = $('body').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6, article').toArray();
  } else if ($('.zDocsTopicPageBody').length > 0) {
    elementsToCheck = $('.zDocsTopicPageBody').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6, article').toArray();
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      elementsToCheck = mainArticle.children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6, article').toArray();
    } else {
      elementsToCheck = $('.dita, .refbody, article, main, [role="main"]').first().children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6, article').toArray();
    }
  }
  
  // Only count elements that have meaningful text content (not just whitespace/structure)
  unprocessedElements = elementsToCheck.filter(el => {
    const text = $(el).text().trim();
    const $el = $(el);
    
    // Skip known empty container classes that are expected after extraction
    // NOTE: After universal article collection, wrapper divs may remain but are empty of meaningful content
    const isKnownContainer = $el.hasClass('zDocsTopicPageBodyContent') || 
                            $el.hasClass('zDocsTopicPageBody') ||
                            $el.hasClass('hascomments') || // Skip article.hascomments wrappers (outer container)
                            $el.attr('role') === 'main' ||
                            $el.attr('role') === 'article' || // Skip article wrappers (processed via universal collection)
                            $el.attr('dir') === 'ltr' ||
                            ($el.is('article') && $el.children().length === 0) || // Skip empty articles
                            ($el.is('div') && $el.hasClass('zDocsTopicPageBodyContent')) || // Skip main content wrapper
                            ($el.is('div') && $el.children().length === 0 && text.length === 0); // Skip empty divs
    
    if (isKnownContainer) {
      console.log(`🔍 Skipping known container: <${el.name} class="${$el.attr('class') || 'none'}" role="${$el.attr('role') || 'none'}">`);
      return false; // Don't count known empty containers
    }
    
    // CRITICAL: Skip anonymous wrapper divs that only contain known empty containers
    // Pattern: <div><article class="hascomments">...</article></div>
    // After extraction, the article.hascomments is empty, and the wrapper div should be ignored too
    if ($el.is('div') && !$el.attr('class') && $el.children().length > 0) {
      const allChildrenAreKnownContainers = $el.children().toArray().every(child => {
        const $child = $(child);
        return $child.hasClass('hascomments') || 
               $child.attr('role') === 'article' ||
               $child.hasClass('zDocsTopicPageBodyContent') ||
               ($child.is('article') && $child.children().length === 0);
      });
      if (allChildrenAreKnownContainers) {
        console.log(`🔍 Skipping anonymous wrapper div containing only known containers (${$el.children().length} children)`);
        return false;
      }
    }
    
    // Count as unprocessed if it has substantial text (>10 chars) or contains content-rich children
    return text.length > 10 || $(el).find('p, ul, ol, table, pre').length > 0;
  }).length;
  
  console.log(`🔍 Unprocessed elements remaining: ${unprocessedElements} (with meaningful content)`);
  
  if (unprocessedElements > 0) {
    console.log(`⚠️ Warning: ${unprocessedElements} content elements were not processed!`);
    console.log(`⚠️ This indicates a bug in the element processing logic.`);
    console.log(`⚠️ Remaining HTML structure (first 500 chars):`);
    console.log(remainingHtml.substring(0, 500));
    
    // Save remaining HTML for analysis
    if (process.env.SN2N_VERBOSE === '1' || process.env.SN2N_EXTRA_DEBUG === '1') {
      const fs = require('fs');
      const path = require('path');
      const logDir = path.join(__dirname, '..', 'logs');
      const logFile = path.join(logDir, 'unprocessed-html.html');
      try {
        fs.writeFileSync(logFile, remainingHtml, 'utf8');
        console.log(`📝 Saved unprocessed HTML to ${logFile}`);
      } catch (err) {
        console.log(`⚠️ Could not save unprocessed HTML: ${err.message}`);
      }
    }
    
    // Collect warning for later logging (after page creation when we have pageId)
    warnings.push({
      type: 'UNPROCESSED_CONTENT',
      data: {
        count: unprocessedElements,
        htmlPreview: remainingHtml.substring(0, 500)
      }
    });
  } else if (elementsToCheck.length > 0) {
    console.log(`✅ All ${elementsToCheck.length} remaining elements are empty wrappers (no meaningful content)`);
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
  
  return { blocks, hasVideos: hasDetectedVideos, warnings };
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
