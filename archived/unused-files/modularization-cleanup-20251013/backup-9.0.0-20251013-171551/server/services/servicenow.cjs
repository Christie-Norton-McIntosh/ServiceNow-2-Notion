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

/**
 * Determines if an iframe URL is from a known video platform.
 * 
 * This function checks if a given URL matches patterns from popular video
 * hosting platforms like YouTube, Vimeo, Wistia, Loom, etc.
 * 
 * @param {string} url - The iframe URL to check
 * 
 * @returns {boolean} True if the URL is from a recognized video platform
 * 
 * @example
 * isVideoIframeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'); // returns true
 * isVideoIframeUrl('https://player.vimeo.com/video/123456789'); // returns true
 * isVideoIframeUrl('https://example.com/iframe'); // returns false
 * 
 * @private
 */
function isVideoIframeUrl(url) {
  if (!url) return false;
  const videoPatterns = [
    /youtube\.com\/embed\//i,
    /youtube-nocookie\.com\/embed\//i,
    /player\.vimeo\.com\//i,
    /vimeo\.com\/video\//i,
    /wistia\.(com|net)/i,
    /fast\.wistia\.(com|net)/i,
    /loom\.com\/embed\//i,
    /vidyard\.com\/embed\//i,
    /brightcove\.(com|net)/i,
  ];
  return videoPatterns.some((pattern) => pattern.test(url));
}

/**
 * Removes HTML tags and decodes HTML entities from text content.
 * 
 * This function strips all HTML markup and converts HTML entities (both named
 * and numeric) back to their corresponding characters, then normalizes whitespace.
 * 
 * @param {string} html - HTML string to clean
 * 
 * @returns {string} Clean plain text with HTML entities decoded
 * 
 * @example
 * cleanHtmlText('<p>Hello &amp; <strong>world</strong>!</p>');
 * // Returns: "Hello & world!"
 * 
 * @example
 * cleanHtmlText('Price: &#36;100&nbsp;USD');
 * // Returns: "Price: $100 USD"
 * 
 * @private
 */
function cleanHtmlText(html) {
  if (!html) return "";

  // Remove HTML tags
  let text = html.replace(/<[^>]*>/g, " ");

  // Decode HTML entities (both named and numeric)
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#xa0;/gi, " ") // Non-breaking space (hex)
    .replace(/&#160;/g, " ") // Non-breaking space (decimal)
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec)) // All decimal entities
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    ); // All hex entities

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// Helper function to validate URLs for Notion links
function isValidNotionUrl(url) {
  if (!url || typeof url !== "string") return false;

  // Trim whitespace
  url = url.trim();

  // Reject empty or whitespace-only URLs
  if (url.length === 0) return false;

  // Reject fragment-only URLs
  if (url.startsWith("#")) return false;

  // Reject javascript: protocol
  if (url.toLowerCase().startsWith("javascript:")) return false;

  // Notion API does NOT accept relative URLs - they must be absolute
  // Reject any URL that starts with / as it should have been converted by convertServiceNowUrl
  if (url.startsWith("/")) {
    return false;
  }
  try {
    const parsedUrl = new URL(url);

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    // Basic validation - URL should have a hostname
    if (!parsedUrl.hostname) {
      return false;
    }

    return true;
  } catch (e) {
    // Invalid URL format
    return false;
  }
}

// Helper function to convert ServiceNow relative URLs to absolute URLs
function convertServiceNowUrl(url) {
  if (!url || typeof url !== "string") return url;

  // Convert ServiceNow documentation relative URLs to absolute
  if (url.startsWith("/")) {
    // Convert any relative URL starting with / to absolute ServiceNow URL
    return "https://www.servicenow.com" + url;
  }

  return url;
}

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
  if (!html || typeof html !== "string")
    return { blocks: [], hasVideos: false };

  // Reset video detection flag for this conversion
  hasDetectedVideos = false;

  log(`🔄 Converting HTML to Notion blocks (${html.length} chars)`);
  log(`📄 HTML sample: ${html.substring(0, 500)}...`);

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

  // Enhanced block parsing logic with custom formatting
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

  // Parse callouts (notes, warnings, etc.) with proper color and icon detection
  const calloutRegex = /<div[^>]*class=["']note[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let calloutMatch;
  while ((calloutMatch = calloutRegex.exec(html)) !== null) {
    const calloutHtml = calloutMatch[0];
    const calloutContent = calloutMatch[1];
    
    // Determine callout type and color based on classes
    let calloutColor = "gray";
    let calloutIcon = "💡";
    
    if (calloutHtml.includes('class="note important') || calloutHtml.includes('note_important')) {
      calloutColor = "red";
      calloutIcon = "⚠️";
    } else if (calloutHtml.includes('class="note warning') || calloutHtml.includes('note_warning')) {
      calloutColor = "orange";
      calloutIcon = "⚠️";
    } else if (calloutHtml.includes('class="note tip') || calloutHtml.includes('note_tip')) {
      calloutColor = "green";
      calloutIcon = "💡";
    } else if (calloutHtml.includes('class="note note') || calloutHtml.includes('note_note')) {
      calloutColor = "blue";
      calloutIcon = "ℹ️";
    }

    // Remove note title spans but preserve the text
    let cleanedContent = calloutContent.replace(/<span[^>]*class=["'][^"']*note__title[^"']*["'][^>]*>([^<]*)<\/span>/gi, '$1: ');
    
    const calloutRichText = await parseRichText(cleanedContent);
    blocks.push({
      object: "block",
      type: "callout",
      callout: {
        rich_text: calloutRichText,
        icon: { type: "emoji", emoji: calloutIcon },
        color: calloutColor
      }
    });
    html = html.replace(calloutMatch[0], "");
  }

  // ...existing table, code, image, heading, list, paragraph logic (use parseRichText for rich_text)...
  // Tables
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[0];
    if (typeof parseTableToNotionBlock === 'function') {
      const tableBlocks = await parseTableToNotionBlock(tableHtml);
      if (tableBlocks) blocks.push(...tableBlocks);
    }
    html = html.replace(tableHtml, "");
  }
  // Code blocks
  const preRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let preMatch;
  while ((preMatch = preRegex.exec(html)) !== null) {
    const codeHtml = preMatch[1];
    const codeText = cleanHtmlText(codeHtml);
    blocks.push({
      object: "block",
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: codeText } }],
        language: "plain text"
      }
    });
    html = html.replace(preMatch[0], "");
  }
  // Images
  const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    const src = imgMatch[1];
    if (isValidImageUrl(src)) {
      const imageBlock = await downloadAndUploadImage(src);
      if (imageBlock) blocks.push(imageBlock);
    }
    html = html.replace(imgMatch[0], "");
  }
  // Headings
  for (let level = 1; level <= 3; level++) {
    const headingRegex = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
    let headingMatch;
    while ((headingMatch = headingRegex.exec(html)) !== null) {
      const headingRichText = await parseRichText(headingMatch[1]);
      blocks.push({
        object: "block",
        type: `heading_${level}`,
        [`heading_${level}`]: {
          rich_text: headingRichText,
        },
      });
      html = html.replace(headingMatch[0], "");
    }
  }
  // Lists
  const ulRegex = /<ul[^>]*>([\s\S]*?)<\/ul>/gi;
  let ulMatch;
  while ((ulMatch = ulRegex.exec(html)) !== null) {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(ulMatch[1])) !== null) {
      const liRichText = await parseRichText(liMatch[1]);
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: liRichText,
        },
      });
    }
    html = html.replace(ulMatch[0], "");
  }
  const olRegex = /<ol[^>]*>([\s\S]*?)<\/ol>/gi;
  let olMatch;
  while ((olMatch = olRegex.exec(html)) !== null) {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(olMatch[1])) !== null) {
      const liRichText = await parseRichText(liMatch[1]);
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: liRichText,
        },
      });
    }
    html = html.replace(olMatch[0], "");
  }
  // Paragraphs
  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = paragraphRegex.exec(html)) !== null) {
    if (cleanHtmlText(match[1]).trim()) {
      const paragraphRichText = await parseRichText(match[1]);
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: paragraphRichText,
        },
      });
    }
    html = html.replace(match[0], "");
  }
  // Fallback: any remaining text as a paragraph
  const content = cleanHtmlText(html);
  if (content.trim()) {
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: content.trim() } }],
      },
    });
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
