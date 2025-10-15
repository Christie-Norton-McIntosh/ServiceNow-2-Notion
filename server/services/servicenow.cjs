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
const { convertTableBlock } = require('../converters/table.cjs');

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
    normalizeAnnotations: global.normalizeAnnotations,
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
  async function parseRichText(html) {
    if (!html) return [{ type: "text", text: { content: "" } }];

    const richText = [];
    const inlineImages = [];
    let text = html;

    // Extract and process img tags, converting them to inline images
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
          if (imageBlock) inlineImages.push(imageBlock);
        }
      }
      text = text.replace(imgTag, "");
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

    // Handle span with uicontrol class as bold + blue
    text = text.replace(/<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      console.log(`🔍 Found span with uicontrol class: ${match.substring(0, 100)}`);
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    });

    // Handle p/span with sectiontitle tasklabel class as bold
    text = text.replace(/<(p|span)[^>]*class=["'][^"']*sectiontitle[^"']*tasklabel[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi, (match, tag, content) => {
      return `__BOLD_START__${content}__BOLD_END__`;
    });

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
          richText.push({
            type: "text",
            text: { content: cleanedText },
            annotations: normalizeAnnotations(currentAnnotations),
          });
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

    return richText;
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
      log(`🖼️ Downloading and uploading image: ${src.substring(0, 80)}...`);
      const uploadId = await downloadAndUploadImage(src, alt || "image");

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
        log(`⚠️ Image upload failed, using external URL as fallback`);
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
    
    console.log(`🔍 Processing element: <${tagName}>, class="${$elem.attr('class') || 'none'}"`);

    // Handle different element types
    if (tagName === 'div' && $elem.attr('class') && $elem.attr('class').includes('note')) {
      console.log(`🔍 MATCHED CALLOUT! class="${$elem.attr('class')}"`);

      // Callout/Note
      const calloutHtml = $.html($elem);
      let calloutColor = "gray";
      let calloutIcon = "💡";
      
      const classAttr = $elem.attr('class') || '';
      if (classAttr.includes('note important') || classAttr.includes('note_important')) {
        calloutColor = "red_background";
        calloutIcon = "⚠️";
      } else if (classAttr.includes('note warning') || classAttr.includes('note_warning')) {
        calloutColor = "orange_background";
        calloutIcon = "⚠️";
      } else if (classAttr.includes('note tip') || classAttr.includes('note_tip')) {
        calloutColor = "green_background";
        calloutIcon = "💡";
      } else if (classAttr.includes('note note') || classAttr.includes('note_note')) {
        calloutColor = "blue_background";
        calloutIcon = "ℹ️";
      }

      // Get inner HTML and process
      let cleanedContent = $elem.html() || '';
      // Remove note title span (it already has a colon like "Note:")
      cleanedContent = cleanedContent.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1 ');
      
      const calloutRichText = await parseRichText(cleanedContent);
      console.log(`🔍 Callout rich_text has ${calloutRichText.length} elements`);
      
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
      
    } else if (tagName === 'table') {
      // Table
      const tableHtml = $.html($elem);
      console.log(`🔍 Converting table, HTML length: ${tableHtml.length}`);
      try {
        const tableBlocks = await convertTableBlock(tableHtml);
        console.log(`🔍 Table conversion returned ${tableBlocks ? tableBlocks.length : 0} blocks`);
        if (tableBlocks && Array.isArray(tableBlocks)) {
          processedBlocks.push(...tableBlocks);
        }
      } catch (error) {
        console.log(`⚠️ Table conversion error: ${error.message}`);
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'pre') {
      // Code block - detect language from class attribute
      console.log(`✅ PRE TAG HANDLER ENTERED - Creating code block`);
      const codeText = cleanHtmlText($elem.html() || '');
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
      
    } else if (tagName === 'figure') {
      // Figure element - extract image and caption together
      console.log(`🔍 Processing <figure> element`);
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
      const headingRichText = await parseRichText(innerHtml);
      console.log(`🔍 Heading ${level} rich_text has ${headingRichText.length} elements, first: ${JSON.stringify(headingRichText[0])}`);
      
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
      
    } else if (tagName === 'ul') {
      // Unordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ul> with ${listItems.length} list items`);
      
      $elem.find('> li').each((i, li) => {
        // Process synchronously, collect for later
        $(li).data('_sn2n_list_type', 'bulleted_list_item');
      });
      
      for (let li of listItems) {
        const liHtml = $(li).html() || '';
        console.log(`🔍 List item HTML: "${liHtml.substring(0, 100)}"`);
        const liRichText = await parseRichText(liHtml);
        console.log(`🔍 List item rich_text: ${liRichText.length} elements`);
        
        // Split if exceeds 100 elements (Notion limit)
        const richTextChunks = splitRichTextArray(liRichText);
        for (const chunk of richTextChunks) {
          console.log(`🔍 Creating bulleted_list_item with ${chunk.length} rich_text elements`);
          processedBlocks.push({
            object: "block",
            type: "bulleted_list_item",
            bulleted_list_item: {
              rich_text: chunk,
            },
          });
        }
      }
      console.log(`✅ Created ${processedBlocks.length} list item blocks from <ul>`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'ol') {
      // Ordered list
      const listItems = $elem.find('> li').toArray();
      console.log(`🔍 Processing <ol> with ${listItems.length} list items`);
      
      for (let li of listItems) {
        const liHtml = $(li).html() || '';
        console.log(`🔍 Ordered list item HTML: "${liHtml.substring(0, 100)}"`);
        const liRichText = await parseRichText(liHtml);
        console.log(`🔍 Ordered list item rich_text: ${liRichText.length} elements`);
        
        // Split if exceeds 100 elements (Notion limit)
        const richTextChunks = splitRichTextArray(liRichText);
        for (const chunk of richTextChunks) {
          console.log(`🔍 Creating numbered_list_item with ${chunk.length} rich_text elements`);
          processedBlocks.push({
            object: "block",
            type: "numbered_list_item",
            numbered_list_item: {
              rich_text: chunk,
            },
          });
        }
      }
      console.log(`✅ Created ${processedBlocks.length} list item blocks from <ol>`);
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'p' || (tagName === 'div' && $elem.hasClass('p'))) {
      // Paragraph (both <p> and <div class="p"> in ServiceNow docs)
      const innerHtml = $elem.html() || '';
      const cleanedText = cleanHtmlText(innerHtml).trim();
      console.log(`🔍 Paragraph <${tagName}${$elem.hasClass('p') ? ' class="p"' : ''}> innerHtml length: ${innerHtml.length}, cleaned: ${cleanedText.length}`);
      if (cleanedText) {
        const paragraphRichText = await parseRichText(innerHtml);
        
        console.log(`🔍 Paragraph rich_text has ${paragraphRichText.length} elements`);
        
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
        console.log(`🔍 Paragraph skipped (empty after cleaning)`);
      }
      $elem.remove(); // Mark as processed
      
    } else if (tagName === 'div' && $elem.hasClass('contentPlaceholder')) {
      // Skip sidebar/placeholder content - this is UI chrome, not document content
      console.log(`🔍 Skipping sidebar content (contentPlaceholder)`);
      $elem.remove(); // Mark as processed
      
    } else {
      // Container element (div, section, main, article, etc.) - recursively process children
      console.log(`🔍 Container element <${tagName}>, recursively processing ${$elem.children().length} children`);
      const children = $elem.children().toArray();
      for (const child of children) {
        const childBlocks = await processElement(child);
        processedBlocks.push(...childBlocks);
      }
    }

    return processedBlocks;
  }

  // Process top-level elements in document order
  // Find all content elements - try body first, then look for common content wrappers
  let contentElements = [];
  
  if ($('body').length > 0) {
    // Full HTML document with body tag
    contentElements = $('body').children().toArray();
    // console.log(`🔍 Processing from <body>, found ${contentElements.length} children`);
  } else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
    // ServiceNow documentation content wrappers
    contentElements = $('.dita, .refbody, article, main, [role="main"]').first().children().toArray();
    // console.log(`🔍 Processing from content wrapper, found ${contentElements.length} children`);
  } else {
    // HTML fragment - get all top-level elements
    contentElements = $.root().children().toArray().filter(el => el.type === 'tag');
    // console.log(`🔍 Processing from root, found ${contentElements.length} top-level elements`);
  }
  
  console.log(`🔍 Found ${contentElements.length} elements to process`);
  
  for (const child of contentElements) {
    const childBlocks = await processElement(child);
    // console.log(`🔍 Element <${child.name}> produced ${childBlocks.length} blocks`);
    blocks.push(...childBlocks);
  }
  
  console.log(`🔍 Total blocks after processing: ${blocks.length}`);
  
  // Check for any truly unprocessed content
  // Note: $.html() will still show processed elements, so we check for actual text content
  const remainingHtml = $.html();
  const content = cleanHtmlText(remainingHtml);
  
  console.log(`🔍 Fallback check - remaining HTML length: ${remainingHtml.length}`);
  console.log(`🔍 Fallback check - cleaned content length: ${content.trim().length}`);
  
  if (content.trim().length > 100) {
    // Significant content remaining - this might be real unprocessed content
    console.log(`⚠️ Significant remaining content detected: "${content.trim().substring(0, 200)}..."`);
    console.log(`⚠️ Remaining HTML structure (first 500 chars):`);
    console.log(remainingHtml.substring(0, 500));
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
