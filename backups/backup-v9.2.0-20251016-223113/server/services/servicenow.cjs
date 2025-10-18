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
const { convertServiceNowUrl, isVideoIframeUrl } = require('../utils/url.cjs');
const { cleanHtmlText } = require('../converters/rich-text.cjs');
const { convertRichTextBlock } = require('../converters/rich-text.cjs');
const { normalizeAnnotations: normalizeAnnotationsLocal } = require('../utils/notion-format.cjs');

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
  };
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
  const { log, normalizeAnnotations, isValidImageUrl, downloadAndUploadImage, normalizeUrl } = getGlobals();
  
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
        
        console.log(`🎬 Found iframe in parseRichText: ${src.substring(0, 100)}`);
        
        // Check if it's a video URL
        if (isVideoIframeUrl(src)) {
          hasDetectedVideos = true;
          console.log(`📹 Video iframe detected - will create video/embed block`);
          
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
          console.log(`🔗 Non-video iframe detected - will create embed block`);
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
      return `__CODE_START__${content}__CODE_END__`;
    });

    // Handle spans with technical identifier classes (ph, keyword, parmname, codeph, etc.) as inline code
    text = text.replace(/<span[^>]*class=["'][^"']*(?:\bph\b|\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      console.log(`🔍 Found span with technical class: ${match.substring(0, 100)}`);
      const cleanedContent = cleanHtmlText(content);
      if (!cleanedContent || !cleanedContent.trim()) return match;

      const technicalTokenRegex = /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]*/g;
      const strictTechnicalTokenRegex = /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]+/g;

      let replaced = cleanedContent;
      replaced = replaced.replace(strictTechnicalTokenRegex, (token) => {
        const bareToken = token.trim();
        if (!bareToken) return token;

        // Skip uppercase acronyms without lowercase characters after removing separators
        const bareAlphaNumeric = bareToken.replace(/[._-]/g, "");
        if (bareAlphaNumeric && /^[A-Z0-9]+$/.test(bareAlphaNumeric)) {
          return token;
        }
        return `__CODE_START__${bareToken}__CODE_END__`;
      });

      if (replaced !== cleanedContent) return replaced;
      return match;
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
    text = text.replace(/\b([a-zA-Z][a-zA-Z0-9]*(?:[_.][a-zA-Z][a-zA-Z0-9]*)+)(?![_.a-zA-Z0-9])/g, (match, identifier) => {
      // Skip if already wrapped or if it's part of a URL
      if (match.includes('__CODE_START__') || match.includes('http')) {
        return match;
      }
      return `__CODE_START__${identifier}__CODE_END__`;
    });

    // Handle span with uicontrol class as bold + blue
    text = text.replace(/<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      console.log(`🔍 Found span with uicontrol class: ${match.substring(0, 100)}`);
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    });

    // Handle p/span with sectiontitle tasklabel class as bold
    text = text.replace(/<(p|span)[^>]*class=["'][^"']*sectiontitle[^"']*tasklabel[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
      console.log(`🔍 Found sectiontitle tasklabel: "${content.substring(0, 50)}"`);
      return `__BOLD_START__${content}__BOLD_END__`;
    });

    // Handle line breaks (<br> tags) as newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');
    
    // Add soft return between </a> and any <p> tag
    text = text.replace(/(<\/a>)(\s*)(<p[^>]*>)/gi, (match, closingA, whitespace, openingP) => {
      return `${closingA}__SOFT_BREAK__${openingP}`;
    });

    // Handle links - extract before cleaning HTML
    const links = [];
    text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, content) => {
      const linkIndex = links.length;
      links.push({ href, content: cleanHtmlText(content) });
      return `__LINK_${linkIndex}__`;
    });

    // Split by markers and build rich text
    const parts = text.split(/(__BOLD_START__|__BOLD_END__|__BOLD_BLUE_START__|__BOLD_BLUE_END__|__ITALIC_START__|__ITALIC_END__|__CODE_START__|__CODE_END__|__LINK_\d+__|__SOFT_BREAK__)/);

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
        const cleanedText = cleanHtmlText(part);
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
   * Splits a rich_text array into chunks of max 100 elements (Notion's limit).
   * 
   * @param {Array} richText - Array of rich_text elements
   * @returns {Array<Array>} Array of rich_text chunks, each with ≤100 elements
   */
  function splitRichTextArray(richText) {
    const MAX_RICH_TEXT_ELEMENTS = 100;
    
    if (!richText || richText.length <= MAX_RICH_TEXT_ELEMENTS) {
      return [richText];
    }
    
    const chunks = [];
    for (let i = 0; i < richText.length; i += MAX_RICH_TEXT_ELEMENTS) {
      chunks.push(richText.slice(i, i + MAX_RICH_TEXT_ELEMENTS));
    }
    
    return chunks;
  }

  // Helper function to create image blocks (needed by parseRichText)
  async function createImageBlock(src, alt = "") {
    if (!src || !isValidImageUrl(src)) return null;

    try {
      log(`🖼️ Using external image URL: ${src.substring(0, 80)}...`);
      return {
        object: "block",
        type: "image",
        image: {
          type: "external",
          external: { url: src },
          caption: alt ? [{ type: "text", text: { content: alt } }] : [],
        },
      };
    } catch (error) {
      log(`❌ Error processing image ${src}: ${error.message}`);
      return null;
    }
  }

  // Use cheerio to parse HTML and process elements in document order
  let $;
  try {
    $ = cheerio.load(html, { 
      decodeEntities: false,
      _useHtmlParser2: true 
    });
  } catch (error) {
    log(`❌ Cheerio load ERROR: ${error.message}`);
    // Fall back to single paragraph
    return {
      blocks: [{
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: convertRichTextBlock(cleanHtmlText(html)),
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
    console.log(`🔍 Processing element: <${tagName}>, class="${elemClass}"`);
    
    // Special debug for div elements with 'note' in class
    if (tagName === 'div' && elemClass !== 'none' && elemClass.includes('note')) {
      console.log(`🔍 ⚠️ DIV WITH NOTE CLASS FOUND! Full class="${elemClass}", HTML preview: ${$.html($elem).substring(0, 100)}`);
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
      console.log(`🔍 MATCHED CALLOUT! class="${$elem.attr('class')}"`);

      // Callout/Note
      const calloutHtml = $.html($elem);
      const classAttr = $elem.attr('class') || '';
      const { color: calloutColor, icon: calloutIcon } = getCalloutPropsFromClasses(classAttr);

      // Get inner HTML and process
      let cleanedContent = $elem.html() || '';
      // Remove note title span (it already has a colon like "Note:")
      cleanedContent = cleanedContent.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
      
      const { richText: calloutRichText, imageBlocks: calloutImages } = await parseRichText(cleanedContent);
      console.log(`🔍 Callout rich_text has ${calloutRichText.length} elements`);
      
      // Add any image blocks found in the callout
      if (calloutImages && calloutImages.length > 0) {
        processedBlocks.push(...calloutImages);
      }
      
      // Split if exceeds 100 elements (Notion limit)
      const richTextChunks = splitRichTextArray(calloutRichText);
      console.log(`🔍 Callout split into ${richTextChunks.length} chunks`);
      for (const chunk of richTextChunks) {
        console.log(`🔍 Creating callout block with ${chunk.length} rich_text elements`);
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
      $elem.remove(); // Mark as processed
    // 2) Aside elements commonly used as notes/admonitions
    // Note: Exclude "itemgroup" divs - those are just ServiceNow content containers, not callouts
    } else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /\b(info|note|warning|important|tip|caution)\b/.test($elem.attr('class') || ''))) {
      const classAttr = $elem.attr('class') || '';
      console.log(`🔍 MATCHED CALLOUT CONTAINER (<${tagName}>) class="${classAttr}"`);
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
          
          figuresWithImages.each((idx, fig) => {
            const $figure = $(fig);
            const $img = $figure.find('img').first();
            const $caption = $figure.find('figcaption').first();
            
            if ($img.length > 0) {
              let imgSrc = $img.attr('src');
              const caption = $caption.length > 0 ? cleanHtmlText($caption.html()) : '';
              
              // Convert ServiceNow URL to proper format
              imgSrc = convertServiceNowUrl(imgSrc);
              
              // Validate URL and create image block
              const isValid = imgSrc && (imgSrc.startsWith('http://') || imgSrc.startsWith('https://'));
              
              if (isValid) {
                const imageBlock = {
                  object: "block",
                  type: "image",
                  image: {
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
                
                processedBlocks.push(imageBlock);
              }
            }
          });
          
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
        const children = $elem.children().toArray();
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
      
    } else if (tagName === 'ul') {
      // Unordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ul> with ${listItems.length} list items`);
      
      for (let li of listItems) {
        const $li = $(li);
        
        // Check if list item contains nested block elements (pre, ul, ol, div.note, p, div.itemgroup, etc.)
        const nestedBlocks = $li.find('> pre, > ul, > ol, > div.note, > figure, > table, > div.table-wrap, > p, > div.itemgroup, > div.stepxmp, > div.info');
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 List item contains ${nestedBlocks.length} nested block elements`);
          
          // Extract text content without nested blocks for the list item text
          const $textOnly = $li.clone();
          $textOnly.find('> pre, > ul, > ol, > div.note, > figure, > table, > p, > div.itemgroup, > div.stepxmp, > div.info').remove();
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
            // Supported: bulleted_list_item, numbered_list_item, paragraph, to_do, toggle, image
            // NOT supported: table, code, heading, callout (must use marker system for 2nd action)
            // IMPORTANT: Nested list items that have their own children would create 3-level nesting (not supported)
            // SOLUTION: Flatten paragraph children into the list item's rich_text to maintain 2-level structure
            const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
            const validChildren = [];
            const markedBlocks = []; // Blocks that need marker-based orchestration
            
            nestedChildren.forEach(block => {
              if (block && block.type && supportedAsChildren.includes(block.type)) {
                // Check if this is a list item with paragraph children (would create 3rd level - flatten instead)
                const isListItemWithChildren = (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item') &&
                                               block[block.type]?.children && 
                                               block[block.type].children.length > 0;
                
                if (isListItemWithChildren) {
                  // Check if all children are paragraphs OR images - if so, flatten paragraphs and keep images
                  const children = block[block.type].children;
                  const allParagraphsOrImages = children.every(child => 
                    child.type === 'paragraph' || child.type === 'image'
                  );
                  
                  if (allParagraphsOrImages) {
                    const paragraphChildren = children.filter(child => child.type === 'paragraph');
                    const imageChildren = children.filter(child => child.type === 'image');
                    
                    if (paragraphChildren.length > 0) {
                      console.log(`🔍 Flattening ${paragraphChildren.length} paragraph children into ${block.type} rich_text to avoid 3-level nesting`);
                      // Merge paragraph rich_text into the list item's rich_text with line breaks
                      paragraphChildren.forEach((child, idx) => {
                        if (idx > 0) {
                          // Add line break between paragraphs
                          block[block.type].rich_text.push({
                            type: "text",
                            text: { content: "\n" },
                            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                          });
                        }
                        block[block.type].rich_text.push(...child.paragraph.rich_text);
                      });
                    }
                    
                    // Keep images as children (they're allowed at 2nd level)
                    if (imageChildren.length > 0) {
                      block[block.type].children = imageChildren;
                      console.log(`🔍 Keeping ${imageChildren.length} image(s) as children of ${block.type}`);
                    } else {
                      // No images, remove children array
                      delete block[block.type].children;
                    }
                    
                    validChildren.push(block);
                  } else {
                    console.log(`⚠️ Nested ${block.type} has ${children.length} non-paragraph/non-image children - marking for orchestration.`);
                    markedBlocks.push(block);
                  }
                } else {
                  validChildren.push(block);
                }
              } else if (block && block.type) {
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                markedBlocks.push(block);
              }
            });
            
            // Add images as children of the list item, not as separate blocks
            const allChildren = [...validChildren];
            if (liImages && liImages.length > 0) {
              allChildren.push(...liImages);
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
                if (markedBlocks.length > 0) {
                  processedBlocks.push(...markedBlocks);
                }
              }
            }
          } else if (nestedChildren.length > 0) {
            // No text content, but has nested blocks - create empty list item with children
            // Filter nested blocks using same logic
            const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
            const validChildren = [];
            const markedBlocks = [];
            
            nestedChildren.forEach(block => {
              if (block && block.type && supportedAsChildren.includes(block.type)) {
                validChildren.push(block);
              } else if (block && block.type) {
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                markedBlocks.push(block);
              }
            });
            
            console.log(`🔍 Creating bulleted_list_item with no text but ${validChildren.length} valid children`);
            
            // Generate marker if needed
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
              
              // Add marked blocks to processedBlocks for orchestrator
              if (markedBlocks.length > 0) {
                processedBlocks.push(...markedBlocks);
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          const liHtml = $li.html() || '';
          console.log(`🔍 List item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 List item rich_text: ${liRichText.length} elements`);
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (const chunk of richTextChunks) {
            const listItemBlock = {
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: {
                rich_text: chunk,
              },
            };
            
            // Add images as children of the list item if any
            if (liImages && liImages.length > 0) {
              listItemBlock.bulleted_list_item.children = liImages;
              console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements and ${liImages.length} image children`);
            } else {
              console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements`);
            }
            
            processedBlocks.push(listItemBlock);
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
        const nestedBlocks = $li.find('> pre, > ul, > ol, > div.note, > figure, > table, > div.table-wrap, > p, > div.itemgroup, > div.stepxmp, > div.info');
        
        if (nestedBlocks.length > 0) {
          console.log(`🔍 Ordered list item contains ${nestedBlocks.length} nested block elements`);
          
          // Extract text content without nested blocks for the list item text
          const $textOnly = $li.clone();
          $textOnly.find('> pre, > ul, > ol, > div.note, > figure, > table, > p, > div.itemgroup, > div.stepxmp, > div.info').remove();
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
            // Supported: bulleted_list_item, numbered_list_item, paragraph, to_do, toggle, image
            // NOT supported: table, code, heading, callout (must use marker system for 2nd action)
            // IMPORTANT: Nested list items that have their own children would create 3-level nesting (not supported)
            // SOLUTION: Flatten paragraph children into the list item's rich_text to maintain 2-level structure
            const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
            const validChildren = [];
            const markedBlocks = []; // Blocks that need marker-based orchestration
            
            nestedChildren.forEach(block => {
              if (block && block.type && supportedAsChildren.includes(block.type)) {
                // Check if this is a list item with paragraph children (would create 3rd level - flatten instead)
                const isListItemWithChildren = (block.type === 'numbered_list_item' || block.type === 'bulleted_list_item') &&
                                               block[block.type]?.children && 
                                               block[block.type].children.length > 0;
                
                if (isListItemWithChildren) {
                  // Check if all children are paragraphs OR images - if so, flatten paragraphs and keep images
                  const children = block[block.type].children;
                  const allParagraphsOrImages = children.every(child => 
                    child.type === 'paragraph' || child.type === 'image'
                  );
                  
                  if (allParagraphsOrImages) {
                    const paragraphChildren = children.filter(child => child.type === 'paragraph');
                    const imageChildren = children.filter(child => child.type === 'image');
                    
                    if (paragraphChildren.length > 0) {
                      console.log(`🔍 Flattening ${paragraphChildren.length} paragraph children into ${block.type} rich_text to avoid 3-level nesting`);
                      // Merge paragraph rich_text into the list item's rich_text with line breaks
                      paragraphChildren.forEach((child, idx) => {
                        if (idx > 0) {
                          // Add line break between paragraphs
                          block[block.type].rich_text.push({
                            type: "text",
                            text: { content: "\n" },
                            annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" }
                          });
                        }
                        block[block.type].rich_text.push(...child.paragraph.rich_text);
                      });
                    }
                    
                    // Keep images as children (they're allowed at 2nd level)
                    if (imageChildren.length > 0) {
                      block[block.type].children = imageChildren;
                      console.log(`🔍 Keeping ${imageChildren.length} image(s) as children of ${block.type}`);
                    } else {
                      // No images, remove children array
                      delete block[block.type].children;
                    }
                    
                    validChildren.push(block);
                  } else {
                    console.log(`⚠️ Nested ${block.type} has ${children.length} non-paragraph/non-image children - marking for orchestration.`);
                    markedBlocks.push(block);
                  }
                } else {
                  validChildren.push(block);
                }
              } else if (block && block.type) {
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                markedBlocks.push(block);
              }
            });
            
            // Add images as children of the list item, not as separate blocks
            const allChildren = [...validChildren];
            if (liImages && liImages.length > 0) {
              allChildren.push(...liImages);
            }
            
            if (liRichText.length > 0 && liRichText.some(rt => rt.text.content.trim())) {
              const richTextChunks = splitRichTextArray(liRichText);
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
                if (markedBlocks.length > 0) {
                  processedBlocks.push(...markedBlocks);
                }
              }
            }
          } else if (nestedChildren.length > 0) {
            // No text content, but has nested blocks - create empty list item with children
            // Filter nested blocks using same logic
            const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
            const validChildren = [];
            const markedBlocks = [];
            
            nestedChildren.forEach(block => {
              if (block && block.type && supportedAsChildren.includes(block.type)) {
                validChildren.push(block);
              } else if (block && block.type) {
                console.log(`⚠️ Block type "${block.type}" needs marker for deferred append to list item`);
                markedBlocks.push(block);
              }
            });
            
            console.log(`🔍 Creating numbered_list_item with no text but ${validChildren.length} valid children`);
            
            // Generate marker if needed
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
              
              // Add marked blocks to processedBlocks for orchestrator
              if (markedBlocks.length > 0) {
                processedBlocks.push(...markedBlocks);
              }
            }
          }
        } else {
          // Simple list item with no nested blocks
          const liHtml = $li.html() || '';
          console.log(`🔍 Ordered list item HTML: "${liHtml.substring(0, 100)}"`);
          const { richText: liRichText, imageBlocks: liImages } = await parseRichText(liHtml);
          console.log(`🔍 Ordered list item rich_text: ${liRichText.length} elements`);
          
          const richTextChunks = splitRichTextArray(liRichText);
          for (const chunk of richTextChunks) {
            const listItemBlock = {
              object: "block",
              type: "numbered_list_item",
              numbered_list_item: {
                rich_text: chunk,
              },
            };
            
            // Add images as children of the list item if any
            if (liImages && liImages.length > 0) {
              listItemBlock.numbered_list_item.children = liImages;
              console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements and ${liImages.length} image children`);
            } else {
              console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements`);
            }
            
            processedBlocks.push(listItemBlock);
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
        
        // Extract any direct text content before child elements
        const directText = $elem.clone().children().remove().end().text().trim();
        if (directText) {
          console.log(`🔍 Found direct text before table: "${directText}"`);
          const { richText: textRichText } = await parseRichText(directText);
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
        
        // Now process child elements (table-wrap, etc.)
        const children = $elem.children().toArray();
        console.log(`🔍 Container element <${tagName}>, recursively processing ${children.length} children`);
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
        }
        $elem.remove();
        return processedBlocks;
      }
      
      // Check if this paragraph contains nested block-level elements
      // (ul, ol, div.note, figure, iframe) - if so, handle mixed content
      const nestedBlocks = $elem.find('> ul, > ol, > div.note, > figure, > iframe');
      if (nestedBlocks.length > 0) {
        console.log(`🔍 Paragraph <${tagName}> contains ${nestedBlocks.length} nested block elements - processing mixed content`);
        
        // Get the raw HTML and manually extract text by removing nested block HTML
        let textOnlyHtml = $elem.html() || '';
        
        // Remove each nested block's outer HTML from the content
        nestedBlocks.each((i, block) => {
          const blockOuterHtml = $.html(block);
          textOnlyHtml = textOnlyHtml.replace(blockOuterHtml, '');
        });
        
        const cleanedText = cleanHtmlText(textOnlyHtml).trim();
        console.log(`🔍 Text after removing nested blocks (${cleanedText.length} chars): "${cleanedText.substring(0, 80)}..."`);
        
        // If there's text content before/after nested blocks, create a paragraph first
        if (cleanedText) {
          console.log(`🔍 Creating paragraph from text around nested blocks`);
          const { richText: textRichText, imageBlocks: textImages } = await parseRichText(textOnlyHtml);
          if (textImages && textImages.length > 0) {
            processedBlocks.push(...textImages);
          }
          if (textRichText.length > 0 && textRichText.some(rt => rt.text.content.trim())) {
            const richTextChunks = splitRichTextArray(textRichText);
            for (const chunk of richTextChunks) {
              processedBlocks.push({
                object: "block",
                type: "paragraph",
                paragraph: { rich_text: chunk }
              });
            }
          }
        } else {
          console.log(`🔍 No text content outside nested blocks - skipping paragraph creation`);
        }
        
        // Now process each nested block
        for (let i = 0; i < nestedBlocks.length; i++) {
          const nestedBlock = nestedBlocks[i];
          console.log(`🔍 Processing nested block ${i + 1}/${nestedBlocks.length}: <${nestedBlock.name}>`);
          const childBlocks = await processElement(nestedBlock);
          processedBlocks.push(...childBlocks);
        }
        
        $elem.remove();
        return processedBlocks;
      }
      
      let innerHtml = $elem.html() || '';
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
        
        // Only create paragraph blocks if there's actual text content
        if (paragraphRichText.length > 0 && paragraphRichText.some(rt => rt.text.content.trim())) {
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
          console.log(`🔍 Paragraph has no text content, only images were added`);
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
                
                // Insert a new element with "Role required:" and the rest
                modifiedRichText.splice(i + 1, 0, {
                  ...element,
                  text: {
                    ...element.text,
                    content: roleAndAfter
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
      const children = $elem.children().toArray();
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
      
    } else {
      // Container element (div, section, main, article, etc.) - recursively process children
      // First check if there's direct text content mixed with child elements
      const children = $elem.children().toArray();
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
          // Has block-level children - check if any contain tables (if so, skip text extraction)
          const childrenHaveTables = blockLevelChildren.some(child => $(child).find('table').length > 0);
          
          if (!childrenHaveTables) {
            // Extract text before first block child only if no tables present
            const firstBlockChild = blockLevelChildren[0];
            const firstBlockHtml = $.html(firstBlockChild);
            const beforeFirstBlock = firstBlockHtml ? fullHtml.split(firstBlockHtml)[0] : fullHtml;
            
            if (beforeFirstBlock && cleanHtmlText(beforeFirstBlock).trim()) {
              console.log(`🔍 Processing text before first block-level child element`);
              const { richText: beforeText, imageBlocks: beforeImages } = await parseRichText(beforeFirstBlock);
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
          } else {
            console.log(`🔍 Skipping text extraction - block-level children contain tables`);
          }
          
          // Process only block-level children (inline elements are already in the paragraph)
          for (const child of blockLevelChildren) {
            const childBlocks = await processElement(child);
            processedBlocks.push(...childBlocks);
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
        for (const child of children) {
          const childBlocks = await processElement(child);
          processedBlocks.push(...childBlocks);
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
    contentElements = $('.zDocsTopicPageBody').children().toArray();
    console.log(`🔍 Processing from .zDocsTopicPageBody, found ${contentElements.length} children`);
  } else if ($('body').length > 0) {
    // Full HTML document with body tag
    contentElements = $('body').children().toArray();
    console.log(`🔍 Processing from <body>, found ${contentElements.length} children`);
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    // ServiceNow documentation content wrappers - process the full article including related content
    const mainArticle = $('article.dita, .refbody').first();
    if (mainArticle.length > 0) {
      contentElements = mainArticle.children().toArray();
      console.log(`🔍 Processing from article.dita, found ${contentElements.length} children`);
    } else {
      // Fallback to original logic
      contentElements = $('.dita, .refbody, article, main, [role="main"]').first().children().toArray();
      console.log(`🔍 Processing from content wrapper, found ${contentElements.length} children`);
    }
  } else {
    // HTML fragment - get all top-level elements
    contentElements = $.root().children().toArray().filter(el => el.type === 'tag');
    console.log(`🔍 Processing from root, found ${contentElements.length} top-level elements`);
  }
  
  console.log(`🔍 Found ${contentElements.length} elements to process`);
  
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
    const hasSidebarContent = remainingHtml.includes('contentPlaceholder') || 
                             remainingHtml.includes('zDocsSideBoxes') ||
                             remainingHtml.includes('Applications and features');
    
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
      
      const fallbackRichText = convertRichTextBlock(content.trim());
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
