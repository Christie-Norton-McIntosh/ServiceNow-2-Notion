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
  
  console.log('🚨🚨🚨 SERVICENOW.CJS FUNCTION START - MODULE LOADED 🚨🚨🚨');
  
  // cleanHtmlText already imported at top of file
  if (!html || typeof html !== "string") {
    return { blocks: [], hasVideos: false };
  }

  // Reset video detection flag for this conversion
  hasDetectedVideos = false;

  log(`🔄 Converting HTML to Notion blocks (${html.length} chars)`);

  // Remove script and style tags
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove ServiceNow documentation helper UI elements
  html = html.replace(/<div[^>]*class="[^\"]*zDocsCodeExplanationContainer[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*zDocsAiActionsButton[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  html = html.replace(/<div[^>]*class="(?![^\"]*code-toolbar)[^\"]*\btoolbar\b[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  html = html.replace(/<button[^>]*class="[^\"]*copy-to-clipboard-button[^\"]*"[^>]*>[\s\S]*?<\/button>/gi, "");
  
  // Remove DataTables wrapper divs (generated by JavaScript table libraries)
  // These contain no useful content and often leak into text extraction
  html = html.replace(/<div[^>]*class="[^\"]*dataTables_wrapper[^\"]*"[^>]*>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*dataTables_filter[^\"]*"[^>]*>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*dataTables_length[^\"]*"[^>]*>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*dataTables_info[^\"]*"[^>]*>/gi, "");
  html = html.replace(/<div[^>]*class="[^\"]*dataTables_paginate[^\"]*"[^>]*>/gi, "");

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
    kbdPlaceholders.forEach((content, index) => {
      const placeholder = `__KBD_PLACEHOLDER_${index}__`;
      const formatted = processKbdContent(content);
      text = text.replace(placeholder, formatted);
      console.log(`🔍 [parseRichText] Restored <kbd>: "${content}" → ${formatted.includes('CODE') ? 'code' : 'bold'}`);
    });

    // Handle span with uicontrol class as bold + blue
    text = text.replace(/<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      if (getExtraDebug && getExtraDebug()) log(`🔍 Found span with uicontrol class: ${match.substring(0, 100)}`);
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    });

    // DEBUG: Check if we have ">" characters
    if (text.includes('>') && !text.includes('<')) {
      console.log('🔍 [parseRichText] Found standalone ">" character before cleanup');
    }

    // CRITICAL FIX: Strip ALL div tags (not just note divs) - they're structural containers
    // that should have been processed at element level, not appearing in rich text
    text = text.replace(/<\/?div[^>]*>/gi, ' ');  // Remove ALL div tags (opening and closing)
    text = text.replace(/<\/?section[^>]*>/gi, ' ');
    text = text.replace(/<\/?article[^>]*>/gi, ' ');
    
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
    while ((imgMatch = imgRegex.exec(text)) !== null) {
      const imgTag = imgMatch[0];
      const srcMatch = imgTag.match(/src=["']([^"']*)["']/i);
      const altMatch = imgTag.match(/alt=["']([^"']*)["']/i);

      if (srcMatch && srcMatch[1]) {
        let src = srcMatch[1];
        const alt = altMatch && altMatch[1] ? altMatch[1] : "";
        src = convertServiceNowUrl(src);
        if (src && isValidImageUrl(src)) {
          const imageBlock = await createImageBlock(src, alt);
          if (imageBlock) imageBlocks.push(imageBlock);
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

  // CRITICAL DIAGNOSTIC: Count articles in RAW HTML before Cheerio parsing
  const rawNested1Count = (html.match(/class="topic task nested1"/g) || []).length;
  const rawNested0Count = (html.match(/class="[^"]*nested0[^"]*"/g) || []).length;
  console.log(`🔥🔥🔥 BEFORE CHEERIO LOAD: Raw HTML has ${rawNested0Count} nested0 and ${rawNested1Count} nested1 articles`);
  console.log(`🔥🔥🔥 Raw HTML length: ${html.length} characters`);
  
  // DUMP: Find all article IDs in raw HTML
  const articleIdMatches = html.match(/id="(dev-ops-[^"]+)"/g) || [];
  const articleIds = articleIdMatches.map(m => m.match(/id="([^"]+)"/)[1]).filter(id => id.startsWith('dev-ops-'));
  console.log(`🔥🔥🔥 Article IDs in raw HTML: ${articleIds.join(', ')}`);
  
  // Use cheerio to parse HTML and process elements in document order
  let $;
  try {
    $ = cheerio.load(html, { 
      decodeEntities: false,
      _useHtmlParser2: true 
    });
    
    // CRITICAL DIAGNOSTIC: Count articles AFTER Cheerio parsing
    const cheerioNested1Count = $('article.nested1').length;
    const cheerioNested0Count = $('article.nested0').length;
    console.log(`🔥🔥🔥 AFTER CHEERIO LOAD: Cheerio found ${cheerioNested0Count} nested0 and ${cheerioNested1Count} nested1 articles`);
    console.log(`🔥🔥🔥 CHEERIO LOST ${rawNested1Count - cheerioNested1Count} articles during parsing!`);
    
    // DUMP: Show where all articles are in the DOM
    $('article.nested1').each((i, el) => {
      const $el = $(el);
      const id = $el.attr('id');
      const parents = $el.parents().map((j, p) => `<${p.name} class="${$(p).attr('class') || ''}">`).get().join(' > ');
      console.log(`🔥 Article ${i+1}: id="${id}", path: ${parents}`);
    });
    
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

      // Callout/Note
      const classAttr = $elem.attr('class') || '';
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);

      // Check if callout contains nested block elements (ul, ol, figure, table, pre, etc.)
      // NOTE: <p> tags should NOT be treated as nested blocks - they're part of callout rich_text
      // IMPORTANT: div.p is a ServiceNow wrapper that often contains mixed content (text + blocks)
      // We need to detect blocks INSIDE div.p and extract them, while preserving div.p text content
      
      // Find nested blocks that are direct children OR inside div.p containers
      const directNestedBlocks = $elem.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.itemgroup, > div.info');
      const divPNestedBlocks = $elem.find('> div.p > ul, > div.p > ol, > div.p > figure, > div.p > table, > div.p > pre');
      const allNestedBlocks = $([...directNestedBlocks.toArray(), ...divPNestedBlocks.toArray()]);
      
      console.log(`🔍 Callout nested blocks check: found ${directNestedBlocks.length} direct + ${divPNestedBlocks.length} inside div.p = ${allNestedBlocks.length} total`);
      
      if (allNestedBlocks.length > 0) {
        console.log(`🔍 Callout contains ${allNestedBlocks.length} nested block elements - processing with children`);
        
        // Clone and remove nested blocks to get just the text content
        // For div.p: remove nested blocks INSIDE it, but keep the div.p text content
        const $clone = $elem.clone();
        $clone.find('> ul, > ol, > figure, > table, > pre, > div.table-wrap, > div.note, > div.itemgroup, > div.info').remove();
        $clone.find('> div.p > ul, > div.p > ol, > div.p > figure, > div.p > table, > div.p > pre').remove();
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
        const calloutContent = calloutRichText.map(rt => rt.text.content).join('').trim();
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
    } else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /\b(info|note|warning|important|tip|caution)\b/.test($elem.attr('class') || ''))) {
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
      if (src && isValidImageUrl(src)) {
        const imageBlock = await createImageBlock(src, $elem.attr('alt') || '');
        if (imageBlock) processedBlocks.push(imageBlock);
      }
      $elem.remove(); // Mark as processed
      
    } else if (/^h[1-6]$/.test(tagName)) {
      // Heading (h1-h6) - Notion only supports heading_1, heading_2, heading_3
      // Map h1->1, h2->2, h3->3, h4->3, h5->3, h6->3
      let level = parseInt(tagName.charAt(1));
      if (level > 3) level = 3; // Notion max is heading_3
      
      const innerHtml = $elem.html() || '';
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
        // First, unwrap div.itemgroup and div.info so we can find nested blocks properly
        $li.find('> div.itemgroup, > div.info').each((i, wrapper) => {
          $(wrapper).replaceWith($(wrapper).html());
        });
        
        const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note').toArray();
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 List item contains ${nestedBlocks.length} nested block elements`);
          
          // Extract text content without nested blocks for the list item text
          const $textOnly = $li.clone();
          // Remove nested blocks (including div.p which may contain div.note, AND direct div.note children)
          $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.stepxmp, > div.note').remove();
          const textOnlyHtml = $textOnly.html();
          
          // Process nested blocks first to add as children
          const nestedChildren = [];
          for (let i = 0; i < nestedBlocks.length; i++) {
            const nestedBlock = nestedBlocks[i];
            console.log(`🔍 Processing nested block in list item: <${nestedBlock.name}>`);
            const childBlocks = await processElement(nestedBlock);
            nestedChildren.push(...childBlocks);
          }
          
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
              // If so, it should go directly to processedBlocks, not get a new marker
              if (block && block._sn2n_marker) {
                console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - preserving for orchestration`);
                // This block will be added to processedBlocks separately to maintain its marker
                return; // Skip further processing for this block
              }
              
              if (block && block.type === 'paragraph') {
                console.log(`⚠️ Standalone paragraph needs marker for deferred append to bulleted_list_item`);
                markedBlocks.push(block);
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
            
            // Use only immediateChildren - images are now handled separately with markers
            const allChildren = [...immediateChildren];
            
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
                  markedBlocks.forEach(block => {
                    block._sn2n_marker = marker;
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
              const blocksWithExistingMarkers = nestedChildren.filter(b => {
                if (!b || !b._sn2n_marker) return false;
                // Check if already in immediateChildren or markedBlocks
                const alreadyAdded = immediateChildren.includes(b) || markedBlocks.includes(b);
                return !alreadyAdded;
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
          const liHtml = $li.html() || '';
          console.log(`🔍 List item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 List item rich_text: ${liRichText.length} elements`);
          
          // Debug: Log the actual text content
          if (liRichText.length > 0) {
            const textPreview = liRichText.map(rt => rt.text?.content || '').join('').substring(0, 100);
            console.log(`🔍 List item text content: "${textPreview}"`);
          }
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (const chunk of richTextChunks) {
            const listItemBlock = {
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: {
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
              console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements`);
              console.log(`🔍 Added marker ${markerToken} for ${liImages.length} deferred image(s)`);
              processedBlocks.push(listItemBlock);
              processedBlocks.push(...liImages);
            } else {
              console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements`);
              processedBlocks.push(listItemBlock);
            }
          }
        }
      }
      console.log(`✅ Created list blocks from <ul>`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'ol') {
      // Ordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ol> with ${listItems.length} list items`);
      
      for (let li of listItems) {
        const $li = $(li);
        
        // Check if list item contains nested block elements (pre, ul, ol, div.note, p, div.itemgroup, etc.)
        // Note: We search for div.p wrappers which may contain div.note elements
        // We ALSO search for div.note directly in case it's a direct child of <li>
        const nestedBlocks = $li.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').toArray();
        
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
          // Remove nested blocks (including div.p which may contain div.note, AND direct div.note children)
          $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').remove();
          const textOnlyHtml = $textOnly.html();
          
          // Process nested blocks first to add as children
          const nestedChildren = [];
          for (let i = 0; i < nestedBlocks.length; i++) {
            const nestedBlock = nestedBlocks[i];
            console.log(`🔍 Processing nested block in ordered list item: <${nestedBlock.name}>`);
            const childBlocks = await processElement(nestedBlock);
            nestedChildren.push(...childBlocks);
          }
          
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
              // If so, it should go directly to processedBlocks, not get a new marker
              if (block && block._sn2n_marker) {
                console.log(`🔍 Block type "${block.type}" already has marker ${block._sn2n_marker} - preserving for orchestration`);
                // This block will be added to processedBlocks separately to maintain its marker
                return; // Skip further processing for this block
              }
              
              if (block && block.type === 'paragraph') {
                console.log(`⚠️ Standalone paragraph needs marker for deferred append to numbered_list_item`);
                markedBlocks.push(block);
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
            
            // Use only immediateChildren - images are now handled separately with markers
            const allChildren = [...immediateChildren];
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
              console.log(`🔍 List item text: "${liRichText.map(rt => rt.text.content).join('').substring(0, 80)}..."`);
              console.log(`🔍 List item has ${allChildren.length} children: ${allChildren.map(c => c.type).join(', ')}`);
              for (const chunk of richTextChunks) {
                console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements and ${allChildren.length} children`);
                
                // If there are marked blocks, generate a marker and add token to rich text
                let markerToken = null;
                if (markedBlocks.length > 0) {
                  const marker = generateMarker();
                  markerToken = `(sn2n:${marker})`;
                  // Tag each marked block with the marker for orchestration
                  markedBlocks.forEach(block => {
                    block._sn2n_marker = marker;
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
                
                // Add marked blocks to processedBlocks so they get collected by orchestrator
                // These will be removed from initial payload and appended via API after page creation
                if (markedBlocks.length > 0) {
                  processedBlocks.push(...markedBlocks);
                }
              }
              
              // Add blocks from nested children that already have markers (from nested list processing)
              // These preserve their original markers and parent associations
              // BUT only if they're not already being added as immediate children or marked blocks
              const blocksWithExistingMarkers = nestedChildren.filter(b => {
                if (!b || !b._sn2n_marker) return false;
                // Check if already in immediateChildren or markedBlocks
                const alreadyAdded = immediateChildren.includes(b) || markedBlocks.includes(b);
                return !alreadyAdded;
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
          const liHtml = $li.html() || '';
          console.log(`🔍 Ordered list item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 Ordered list item rich_text: ${liRichText.length} elements`);
          
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
          const isBlockElement = isElementNode && ['DIV', 'TABLE'].includes(nodeName);
          
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
      
      // Check if this paragraph contains nested block-level elements
      // (ul, ol, dl, div.note, figure, iframe) - if so, handle mixed content
      // NOTE: Search for DIRECT CHILDREN ONLY (>) to avoid finding elements already nested in lists
      // This prevents duplicate processing of figures inside <ol>/<ul> elements
      const directBlocks = $elem.find('> ul, > ol, > dl').toArray();
      const inlineBlocks = $elem.find('> div.note, > figure, > iframe').toArray();
      const nestedBlocks = [...directBlocks, ...inlineBlocks];
      
      if (nestedBlocks.length > 0) {
        console.log(`🔍 Paragraph <${tagName}> contains ${nestedBlocks.length} nested block elements - processing mixed content`);
        
        // Clone the element and remove nested blocks from the clone to extract text-only content
        const $clone = $elem.clone();
        $clone.find('> ul, > ol, > dl').remove();
        $clone.find('> div.note, > figure, > iframe').remove();
        let textOnlyHtml = $clone.html() || '';
        
        // CRITICAL: Remove any remaining literal note div tags that may appear as text
        // These can appear when ServiceNow HTML contains note divs as literal text in paragraph content
        textOnlyHtml = textOnlyHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
        
        const cleanedText = cleanHtmlText(textOnlyHtml).trim();
        console.log(`🔍 Text after removing nested blocks (${cleanedText.length} chars): "${cleanedText.substring(0, 80)}..."`);
        
        // Process all nested blocks and separate them by type:
        // - List elements (ul, ol, dl) should be nested as children of the paragraph
        // - Other elements (figure, div.note, iframe) should be siblings
        const listChildBlocks = [];
        const siblingBlocks = [];
        
        for (let i = 0; i < nestedBlocks.length; i++) {
          const nestedBlock = nestedBlocks[i];
          const blockName = nestedBlock.name.toLowerCase();
          console.log(`🔍 Processing nested block ${i + 1}/${nestedBlocks.length}: <${blockName}>`);
          const childBlocks = await processElement(nestedBlock);
          
          // Only nest list elements as children; others become siblings
          if (blockName === 'ul' || blockName === 'ol' || blockName === 'dl') {
            console.log(`🔍   → List element, will nest as children`);
            listChildBlocks.push(...childBlocks);
          } else {
            console.log(`🔍   → Non-list element (${blockName}), will add as sibling`);
            siblingBlocks.push(...childBlocks);
          }
        }
        
        // If there's text content before/after nested blocks, create a paragraph
        if (cleanedText) {
          console.log(`🔍 Creating paragraph from text, with ${listChildBlocks.length} list children, ${siblingBlocks.length} siblings`);
          // NOTE: Don't extract images from textOnlyHtml since nested block elements (like figures)
          // will be processed separately. If there are any leftover img tags, they should NOT create
          // separate image blocks - just include them as part of the paragraph text.
          // We only call parseRichText to get the text content, not the images.
          
          // IMPORTANT: Pass HTML directly to parseRichText to preserve formatting (links, bold, etc)
          // parseRichText handles entity decoding and tag processing internally
          const { richText: textRichText } = await parseRichText(textOnlyHtml);
          // Intentionally ignoring imageBlocks from mixed content to prevent duplicates
          if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim() || rt.text.link)) {
            const richTextChunks = splitRichTextArray(textRichText);
            for (const chunk of richTextChunks) {
              const paragraphBlock = {
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              };
              
              // IMPORTANT: Paragraphs CANNOT have children in Notion API
              // List blocks must be added as siblings, not children
              processedBlocks.push(paragraphBlock);
            }
          }
          
          // Add list blocks as siblings after the paragraph (NOT as children - paragraphs can't have children)
          if (listChildBlocks.length > 0) {
            console.log(`🔍 Adding ${listChildBlocks.length} list blocks as siblings after paragraph`);
            processedBlocks.push(...listChildBlocks);
          }
          
          // Add non-list blocks as siblings after the paragraph
          if (siblingBlocks.length > 0) {
            console.log(`🔍 Adding ${siblingBlocks.length} non-list blocks as siblings`);
            processedBlocks.push(...siblingBlocks);
          }
        } else {
          console.log(`🔍 No text content outside nested blocks - adding all blocks as siblings`);
          // No text content, add all nested blocks as siblings
          processedBlocks.push(...listChildBlocks, ...siblingBlocks);
        }
        
        $elem.remove();
        return processedBlocks;
      }
      
      let innerHtml = $elem.html() || '';
      
      // CRITICAL: Remove any literal note div tags that may appear as text in paragraph content
      // These can appear when ServiceNow HTML contains note divs as literal text
      innerHtml = innerHtml.replace(/<div\s+class=["'][^"']*note[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
      
      const cleanedText = cleanHtmlText(innerHtml).trim();
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
      
      const sectionHtml = $elem.html() || '';
      const { richText: sectionRichText, imageBlocks: sectionImages } = await parseRichText(sectionHtml);
      
      // Debug: log the parsed rich text structure
      console.log(`🔍 Prereq parsed into ${sectionRichText.length} rich text elements:`);
      sectionRichText.forEach((rt, idx) => {
        console.log(`   [${idx}] "${rt.text.content.substring(0, 80)}${rt.text.content.length > 80 ? '...' : ''}"`);
      });
      
      // Add any images found in the section
      if (sectionImages && sectionImages.length > 0) {
        processedBlocks.push(...sectionImages);
      }
      
      // Create callout block(s) from the section content
      if (sectionRichText.length > 0 && sectionRichText.some(rt => rt.text.content.trim())) {
        let modifiedRichText = [...sectionRichText];
        
        // Check if this is a simple 2-line prereq (just "Before you begin" + "Role required:")
        // It's only simple if "Role required:" is at the START of the second element with no text before it
        let isSimpleTwoLine = false;
        let roleRequiredIndex = -1;
        
        for (let i = 0; i < Math.min(3, modifiedRichText.length); i++) {
          const element = modifiedRichText[i];
          if (element && element.text && element.text.content) {
            const content = element.text.content;
            const roleIndex = content.indexOf('Role required:');
            
            if (roleIndex >= 0) {
              roleRequiredIndex = i;
              // It's only simple if "Role required:" is at position 0 (start of element)
              // AND it's in the second element (index 1)
              // This means: "Before you begin\nRole required:" with nothing in between
              isSimpleTwoLine = (roleIndex === 0 && i === 1);
              console.log(`🔍 Found "Role required:" at element ${i}, position ${roleIndex} - isSimpleTwoLine=${isSimpleTwoLine}`);
              break;
            }
          }
        }
        
        console.log(`🔍 Prereq section analysis: isSimpleTwoLine=${isSimpleTwoLine}, roleRequiredIndex=${roleRequiredIndex}, totalElements=${modifiedRichText.length}`);
        
        // Add soft line break after "Before you begin" (first element)
        if (modifiedRichText.length > 0) {
          const firstElement = modifiedRichText[0];
          if (firstElement && firstElement.text && firstElement.text.content) {
            modifiedRichText[0] = {
              ...firstElement,
              text: {
                ...firstElement.text,
                content: firstElement.text.content + '\n'
              }
            };
            console.log(`🔍 Added soft return after first element: "${modifiedRichText[0].text.content.substring(0, 50)}..."`);
          }
        }
        
        // Only add single line break before "Role required:" if it's NOT a simple two-line prereq
        if (!isSimpleTwoLine && roleRequiredIndex >= 0) {
          console.log(`🔍 Adding single line break before "Role required:" (complex prereq with paragraph)`);
          for (let i = 0; i < modifiedRichText.length; i++) {
            const element = modifiedRichText[i];
            if (element && element.text && element.text.content) {
              const content = element.text.content;
              const roleIndex = content.indexOf('Role required:');
              
              if (roleIndex > 0) {
                // "Role required:" is in the middle of this element, split it
                // Trim any trailing whitespace before "Role required:"
                const beforeRole = content.substring(0, roleIndex).trimEnd();
                const roleAndAfter = content.substring(roleIndex);
                
                console.log(`🔍 Splitting at "Role required:" - before: "${beforeRole.substring(Math.max(0, beforeRole.length - 30))}", after: "${roleAndAfter.substring(0, 30)}"`);
                
                // Replace current element with the part before "Role required:" + newline
                modifiedRichText[i] = {
                  ...element,
                  text: {
                    ...element.text,
                    content: beforeRole + '\n'
                  }
                };
                
                // Insert a new element with "Role required:" and the rest (trim trailing newlines)
                modifiedRichText.splice(i + 1, 0, {
                  ...element,
                  text: {
                    ...element.text,
                    content: roleAndAfter.trimEnd()
                  }
                });
                
                break;
              } else if (roleIndex === 0) {
                // "Role required:" starts this element, add newline to previous element
                console.log(`🔍 "Role required:" at start of element ${i}, adding newline to previous element`);
                if (i > 0 && modifiedRichText[i - 1]) {
                  const prevElement = modifiedRichText[i - 1];
                  // Trim trailing whitespace and add newline
                  const trimmedContent = prevElement.text.content.trimEnd();
                  modifiedRichText[i - 1] = {
                    ...prevElement,
                    text: {
                      ...prevElement.text,
                      content: trimmedContent + '\n'
                    }
                  };
                }
                break;
              }
            }
          }
        } else if (isSimpleTwoLine) {
          console.log(`🔍 Simple two-line prereq detected - using only soft returns (no extra line break)`);
        }
        
        const richTextChunks = splitRichTextArray(modifiedRichText);
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
      
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && $elem.hasClass('contentPlaceholder')) {
      // contentPlaceholder divs can contain actual content like "Related Content" sections
      // Check if it has meaningful content before skipping
      const children = $elem.find('> *').toArray();
      const hasContent = children.some(child => {
        const $child = $(child);
        const text = cleanHtmlText($child.html() || '').trim();
        return text.length > 20 || $child.find('h1, h2, h3, h4, h5, h6, ul, ol, p, a').length > 0;
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
        const cleanedText = cleanHtmlText(html).trim();
        
        if (cleanedText) {
          console.log(`🔍 Processing <div class="${$elem.attr('class')}"> as paragraph wrapper`);
          const { richText: divRichText, imageBlocks: divImages } = await parseRichText(html);
          
          if (divImages && divImages.length > 0) {
            processedBlocks.push(...divImages);
          }
          
          if (divRichText.length > 0 && divRichText.some(rt => rt.text.content.trim())) {
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
          } else {
            // Not a div - accumulate as text/HTML
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
      
      // Check for nested blocks
      const nestedBlocks = $elem.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').toArray();
      
      if (nestedBlocks.length > 0) {
        // Has nested blocks - extract text without them
        const $textOnly = $elem.clone();
        $textOnly.find('> pre, > ul, > ol, > figure, > table, > div.table-wrap, > p, > div.p, > div.itemgroup, > div.stepxmp, > div.info, > div.note').remove();
        const textOnlyHtml = $textOnly.html();
        const { richText: liRichText } = await parseRichText(textOnlyHtml);
        
        // Process nested blocks
        const nestedChildren = [];
        for (const nestedBlock of nestedBlocks) {
          const childBlocks = await processElement(nestedBlock);
          nestedChildren.push(...childBlocks);
        }
        
        // Create numbered list item with text and children
        const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
        const validChildren = nestedChildren.filter(b => b && b.type && supportedAsChildren.includes(b.type));
        
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
        const { richText: liRichText } = await parseRichText(liHtml);
        if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
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
        console.log(`🔍 Container element <${tagName}>, recursively processing ${children.length} children`);
        
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
    contentElements = $('.zDocsTopicPageBody').find('> *').toArray();
    console.log(`🔍 Processing from .zDocsTopicPageBody, found ${contentElements.length} children`);
    console.log(`🔍 Top-level children: ${contentElements.map(c => `<${c.name} class="${$(c).attr('class') || ''}">`).join(', ')}`);
    
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
    const childBlocks = await processElement(child);
    // console.log(`🔍 Element <${child.name}> produced ${childBlocks.length} blocks`);
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
  let unprocessedElements = 0;
  if ($('body').length > 0) {
    unprocessedElements = $('body').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').length;
  } else if ($('.zDocsTopicPageBody').length > 0) {
    unprocessedElements = $('.zDocsTopicPageBody').children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').length;
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      unprocessedElements = mainArticle.children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').length;
    } else {
      unprocessedElements = $('.dita, .refbody, article, main, [role="main"]').first().children('p, div, section, ul, ol, pre, figure, h1, h2, h3, h4, h5, h6').length;
    }
  }
  
  console.log(`🔍 Unprocessed elements remaining: ${unprocessedElements}`);
  
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
  
  return { blocks, hasVideos: hasDetectedVideos };
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
