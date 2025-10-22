const { convertServiceNowUrl } = require("../utils/url.cjs");
/**
 * @fileoverview Rich Text Converter for Notion blocks
 * 
 * This module provides utilities for converting HTML content to Notion's rich_text format,
 * handling various formatting elements like bold, italic, code, links, and technical identifiers.
 * 
 * Key Features:
 * - HTML to Notion rich_text conversion with proper annotation handling
 * - Technical identifier detection and inline code formatting
 * - Link extraction and formatting preservation
 * - Rich text sanitization and validation
 * 
 * Dependencies:
 * - server/utils/notion-format.cjs (normalizeAnnotations, VALID_RICH_TEXT_COLORS)
 * 
 * @module converters/rich-text
 * @since 8.2.5
 */

const { normalizeAnnotations, VALID_RICH_TEXT_COLORS } = require('../utils/notion-format.cjs');

/**
 * Converts HTML or plain text content to Notion's rich_text block array format.
 * 
 * This function processes HTML content and converts it to Notion's rich_text format,
 * preserving formatting like bold, italic, inline code, and links. It also has
 * special handling for technical identifiers (e.g., field names, API endpoints)
 * that are automatically formatted as inline code.
 * 
 * @param {string|object} input - HTML string or parsed DOM node to convert
 * @param {object} [options={}] - Conversion options (currently unused, reserved for future use)
 * @param {boolean} [options.preserveWhitespace=false] - Whether to preserve whitespace exactly
 * @param {boolean} [options.detectTechnicalTokens=true] - Whether to auto-detect technical identifiers
 * 
 * @returns {Array<object>} Array of Notion rich_text objects with proper annotations
 * 
 * @example
 * // Convert simple HTML
 * const richText = convertRichTextBlock('<b>Bold text</b> and <i>italic</i>');
 * // Returns: [
 * //   { type: "text", text: { content: "Bold text" }, annotations: { bold: true } },
 * //   { type: "text", text: { content: " and " }, annotations: {} },
 * //   { type: "text", text: { content: "italic" }, annotations: { italic: true } }
 * // ]
 * 
 * @example
 * // Convert HTML with links
 * const richText = convertRichTextBlock('<a href="https://example.com">Link text</a>');
 * // Returns: [
 * //   { type: "text", text: { content: "Link text", link: { url: "https://example.com" } }, annotations: {} }
 * // ]
 * 
 * @example  
 * // Technical identifiers are auto-detected
 * const richText = convertRichTextBlock('Use the field sys_id.value for the record');
 * // Returns rich text with "sys_id.value" formatted as inline code
 */
function convertRichTextBlock(input, options = {}) {
  // Convert HTML or plain text to Notion rich_text block array
  // This implementation is adapted from htmlToNotionRichText in sn2n-proxy.cjs
  const richText = [];
  let html = typeof input === "string" ? input : "";
  if (!html) return [];
  
  // DEBUG: Log input HTML if it contains span tags
  if (html.includes('<span')) {
    console.log(`🔍 [rich-text.cjs] convertRichTextBlock called with HTML containing <span>:`);
    console.log(`   Input: "${html.substring(0, 250)}..."`);
  }

  // Extract and store links first with indexed placeholders
  const links = [];
  html = html.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, content) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    let href = hrefMatch ? hrefMatch[1] : "";
    // Convert relative ServiceNow URLs to absolute
    href = convertServiceNowUrl(href);
    
    // CRITICAL: Strip span tags from link content BEFORE storing
    // This handles cases like: <a href="...">Contact <span class="ph">Support</span></a>
    let cleanedContent = content;
    
    // Strip span tags with ph/keyword/parmname/codeph/userinput classes from link content
    cleanedContent = cleanedContent.replace(
      /<span[^>]*class=["'][^"']*(?:\bph\b|\bkeyword\b|\bparmname\b|\bcodeph\b|\buserinput\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      (spanMatch, spanContent) => {
        // Just return the content without the span tags
        return spanContent || '';
      }
    );
    
    // Also strip uicontrol spans (these will be handled as bold+blue later)
    cleanedContent = cleanedContent.replace(
      /<span[^>]*class=["'][^"']*\buicontrol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      (spanMatch, spanContent) => {
        return `__BOLD_BLUE_START__${spanContent}__BOLD_BLUE_END__`;
      }
    );
    
    const linkIndex = links.length;
    links.push({ href, content: cleanedContent });
    // Use indexed placeholder that won't be caught by technical identifier regex
    return `__LINK_${linkIndex}__`;
  });

  // Force insert __SOFT_BREAK__ after every closing link placeholder followed by any non-whitespace character
  // Skip this for table cells where links should flow naturally in sentences
  if (options.skipSoftBreaks !== true) {
    html = html.replace(/(__LINK_\d+__)(\s*[^\s<])/gi, (match, linkMarker, after) => `${linkMarker}__SOFT_BREAK__${after}`);
  }

  // Handle bold/strong tags
  html = html.replace(/<(b|strong)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => `__BOLD_START__${content}__BOLD_END__`);
  // Handle italic/em tags
  html = html.replace(/<(i|em)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => `__ITALIC_START__${content}__ITALIC_END__`);
  // Handle inline code tags
  html = html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (match, attrs, content) => `__CODE_START__${content}__CODE_END__`);
  
  // Handle span with uicontrol class as bold + blue
  html = html.replace(/<span[^>]*class=["'][^"']*\buicontrol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
  });
  
  // Handle spans with note__title class - just extract content, no formatting
  // These are title labels like "Note:" in callouts that should be plain text
  html = html.replace(/<span[^>]*class=["'][^"']*\bnote__title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    if (process.env.SN2N_VERBOSE === '1') {
      console.log(`🔍 Matched span with class note__title: "${match.substring(0, 80)}"`);
    }
    const cleanedContent = typeof content === "string" ? content.trim() : "";
    if (!cleanedContent) return " "; // Return space instead of empty match
    // Just return the content without the span tags (no special formatting)
    return cleanedContent;
  });
  
  // Handle spans with userinput class as inline code (preserve content exactly as-is)
  // This is for user input placeholders like <instance-name> that should not be modified
  html = html.replace(/<span[^>]*class=["'][^"']*\buserinput\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    if (process.env.SN2N_VERBOSE === '1') {
      console.log(`🔍 Matched span with class userinput: "${match.substring(0, 80)}"`);
    }
    const cleanedContent = typeof content === "string" ? content.trim() : "";
    if (!cleanedContent) return " "; // Return space instead of empty match
    // Wrap entire content as code without any character modifications
    return `__CODE_START__${cleanedContent}__CODE_END__`;
  });
  
  // Handle spans with technical identifier classes (ph, keyword, parmname, codeph, etc.)
  // These tags wrap technical terms, product names, or code identifiers
  // These go through technical identifier detection (dots, underscores, etc.)
  // CRITICAL FIX: Always return the content (not the HTML tags) even if not detected as technical
  const htmlBefore = html;
  html = html.replace(/<span[^>]*class=["'][^"']*(?:\bph\b|\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    if (process.env.SN2N_VERBOSE === '1') {
      console.log(`🔍 Matched span with class ph/keyword/parmname/codeph: "${match.substring(0, 80)}"`);
    }
    const cleanedContent = typeof content === "string" ? content.trim() : "";
    if (!cleanedContent) return " "; // Return space instead of empty match
    
    // Check if content looks like a technical identifier (has dots or underscores)
    const strictTechnicalTokenRegex = /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]+/g;
    let replaced = cleanedContent.replace(strictTechnicalTokenRegex, (token) => {
      const bareToken = token.trim();
      if (!bareToken) return token;
      const bareAlphaNumeric = bareToken.replace(/[._-]/g, "");
      if (bareAlphaNumeric && /^[A-Z0-9]+$/.test(bareAlphaNumeric)) return token;
      return `__CODE_START__${bareToken}__CODE_END__`;
    });
    
    // ALWAYS return content without the span tags, regardless of whether it was formatted
    return replaced;
  });
  
  // DEBUG: Check if span replacement worked
  if (htmlBefore.includes('<span') && htmlBefore !== html) {
    console.log(`🔍 [rich-text.cjs] After span replacement:`);
    console.log(`   Before: "${htmlBefore.substring(0, 150)}..."`);
    console.log(`   After:  "${html.substring(0, 150)}..."`);
    if (html.includes('<span')) {
      console.log(`   ❌ WARNING: <span> tags still present after replacement!`);
    } else {
      console.log(`   ✅ All <span> tags successfully removed`);
    }
  }
  // Remove surrounding parentheses/brackets around inline code markers
  html = html.replace(/([\(\[])(\s*(?:__CODE_START__[\s\S]*?__CODE_END__\s*)+)([\)\]])/g, (match, open, codes, close) => {
    const codeRegex = /__CODE_START__([\s\S]*?)__CODE_END__/g;
    let codeMatch;
    let shouldStrip = true;
    while ((codeMatch = codeRegex.exec(codes)) !== null) {
      const codeContent = codeMatch[1].trim();
      if (!codeContent || !/^[A-Za-z0-9._-]+$/.test(codeContent) || !/[._]/.test(codeContent)) {
        shouldStrip = false;
        break;
      }
    }
    if (!shouldStrip) return match;
    return codes.trim();
  });
  // Handle raw technical identifiers in parentheses/brackets as inline code
  // Must contain at least one dot or underscore to be considered a technical identifier
  html = html.replace(/([\(\[])[ \t\n\r]*([a-zA-Z][-a-zA-Z0-9]*(?:[_.][-a-zA-Z0-9]+)+)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => `__CODE_START__${code.trim()}__CODE_END__`);

  // Standalone multi-word identifiers connected by _ or . (no spaces) as inline code
  // Each segment must start with a letter, can contain letters, numbers, and hyphens
  // Examples: com.snc.incident.mim.ml_solution, sys_user_table, package.class.method, com.glide.service-portal
  // Must have at least 2 segments separated by . or _ and no brackets/parentheses
  // Use a function to check context to avoid matching inside already-wrapped code
  html = html.replace(/\b([a-zA-Z][-a-zA-Z0-9]*(?:[_.][a-zA-Z][-a-zA-Z0-9]*)+)\b/g, (match, identifier, offset, string) => {
    // Check if we're inside a __CODE_START__...__CODE_END__ block
    const beforeMatch = string.substring(0, offset);
    const lastCodeStart = beforeMatch.lastIndexOf('__CODE_START__');
    const lastCodeEnd = beforeMatch.lastIndexOf('__CODE_END__');
    
    // If there's a CODE_START after the last CODE_END, we're inside a code block
    if (lastCodeStart > lastCodeEnd) {
      return match; // Don't wrap, already in code block
    }
    
    // Skip if part of a URL or link placeholder
    if (match.includes('http') || match.includes('__LINK_')) {
      return match;
    }
    return `__CODE_START__${identifier}__CODE_END__`;
  });

  // Strip any remaining HTML tags that weren't converted to markers
  // This handles span tags, divs, and other markup that doesn't need special formatting
  const beforeStrip = html;
  html = html.replace(/<[^>]+>/g, ' ');
  
  // Debug: Log if we stripped any span tags
  if (beforeStrip !== html && beforeStrip.includes('<span')) {
    console.log(`🧹 Stripped remaining HTML tags from: "${beforeStrip.substring(0, 100)}"`);
    console.log(`   Result: "${html.substring(0, 100)}"`);
  }
  
  // Clean up excessive whitespace from tag removal, BUT preserve newlines
  html = html.replace(/[^\S\n]+/g, ' '); // Replace consecutive non-newline whitespace with single space
  html = html.replace(/ *\n */g, '\n'); // Clean spaces around newlines

  // Now split by markers and build rich text
  const parts = html.split(/(__BOLD_START__|__BOLD_END__|__BOLD_BLUE_START__|__BOLD_BLUE_END__|__ITALIC_START__|__ITALIC_END__|__CODE_START__|__CODE_END__|__LINK_\d+__|__SOFT_BREAK__)/);
  let currentAnnotations = {
    bold: false,
    italic: false,
    code: false,
    color: "default",
  };
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
      currentAnnotations.code = true;
      currentAnnotations.color = "red";
    } else if (part === "__CODE_END__") {
      currentAnnotations.code = false;
      currentAnnotations.color = "default";
    } else if (part.match(/^__LINK_(\d+)__$/)) {
      const linkIndex = parseInt(part.match(/^__LINK_(\d+)__$/)[1]);
      const linkInfo = links[linkIndex];
      if (linkInfo && linkInfo.content && linkInfo.content.trim()) {
        const { href, content } = linkInfo;
        const trimmedContent = content.trim();
        // Validate URL - must be absolute http(s) URL, not empty or relative
        const isValidUrl = href && href.trim() && /^https?:\/\/.+/i.test(href.trim());
        
        // Log invalid URLs for debugging
        if (!isValidUrl && href) {
          console.warn(`[SN2N] ⚠️ Skipping invalid/relative URL: "${href}" (link text: "${trimmedContent.substring(0, 50)}...")`);
        }
        
        // Split long link content into 2000-char chunks
        if (trimmedContent.length > 2000) {
          let remaining = trimmedContent;
          while (remaining.length > 0) {
            const chunk = remaining.substring(0, 2000);
            const rt = {
              type: "text",
              text: { content: chunk },
              annotations: normalizeAnnotations(currentAnnotations),
            };
            // Only add link to first chunk if URL is valid
            if (isValidUrl && remaining === trimmedContent) {
              rt.text.link = { url: href.trim() };
            }
            richText.push(rt);
            remaining = remaining.substring(2000);
          }
        } else {
          const rt = {
            type: "text",
            text: { content: trimmedContent },
            annotations: normalizeAnnotations(currentAnnotations),
          };
          if (isValidUrl) {
            rt.text.link = { url: href.trim() };
          }
          richText.push(rt);
        }
      }
    } else if (part) {
      const cleanedText = typeof part === "string" ? part : "";
      
      // Special handling for newline-only content - preserve it for table cells
      if (cleanedText === '\n' || cleanedText === '\r\n') {
        richText.push({
          type: "text",
          text: { content: '\n' },
          annotations: normalizeAnnotations(currentAnnotations),
        });
      } else if (cleanedText.trim() || cleanedText.includes('\n')) {
        // Split by newlines first - each line becomes a separate rich_text element
        // This is necessary for table cells where newlines should create visual line breaks
        const lines = cleanedText.split('\n');
        
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          
          // CRITICAL: Don't skip empty lines - they represent intentional newlines
          // When text starts with "\n", splitting creates an empty first element
          // Skipping it loses the newline, causing bullets to run together
          // Instead, we'll add content if non-empty, then always add newline between elements
          
          // Split long content into 2000-char chunks to comply with Notion API
          if (line.length > 2000) {
            let remaining = line;
            while (remaining.length > 0) {
              const chunk = remaining.substring(0, 2000);
              richText.push({
                type: "text",
                text: { content: chunk },
                annotations: normalizeAnnotations(currentAnnotations),
              });
              remaining = remaining.substring(2000);
            }
          } else if (line.trim()) {
            // Only add non-empty lines as content
            richText.push({
              type: "text",
              text: { content: line },
              annotations: normalizeAnnotations(currentAnnotations),
            });
          }
          
          // Add newline as separate element between lines (but not after the last line)
          // This preserves the original newline positions even when empty lines are present
          if (i < lines.length - 1) {
            richText.push({
              type: "text",
              text: { content: '\n' },
              annotations: normalizeAnnotations(currentAnnotations),
            });
          }
        }
      }
    }
  }
  return richText;
}


/**
 * Creates a deep clone of a Notion rich_text object with normalized annotations.
 * 
 * This function safely clones a rich_text object, ensuring all annotations are
 * properly normalized and required properties are present. It handles edge cases
 * like missing plain_text properties and malformed annotation objects.
 * 
 * @param {object} rt - The Notion rich_text object to clone
 * @param {string} rt.type - The type of rich text ("text", "mention", "equation")
 * @param {object} [rt.text] - Text content and formatting for "text" type
 * @param {string} [rt.text.content] - The actual text content
    // Helper to split long content into 2000-char chunks
    function splitContentToRichText(content, annotations) {
      const chunks = [];
      let i = 0;
      while (i < content.length) {
        const chunk = content.substring(i, i + 2000);
        chunks.push({
          type: "text",
          text: { content: chunk },
          annotations: annotations ? { ...annotations } : {},
        });
        i += 2000;
      }
      return chunks;
    }
 * @param {object} [rt.text.link] - Link information if text is a hyperlink
 * @param {object} [rt.annotations] - Formatting annotations (bold, italic, etc.)
 * @param {string} [rt.plain_text] - Plain text representation
 * 
 * @returns {object|null} Deep cloned and normalized rich_text object, or null if input is invalid
 * 
 * @example
 * const original = {
 *   type: "text",
 *   text: { content: "Hello world" },
 *   annotations: { bold: true, italic: false }
 * };
 * const cloned = cloneRichText(original);
 * // Returns a new object with normalized annotations and auto-generated plain_text
 * 
 * @see {@link normalizeAnnotations} for annotation normalization details
 */
function cloneRichText(rt) {
  if (!rt || typeof rt !== "object") {
    return null;
  }
  const cloned = {
    ...rt,
    annotations: normalizeAnnotations(rt.annotations),
  };
  if (rt.text && typeof rt.text === "object") {
    cloned.text = { ...rt.text };
  }
  if (typeof cloned.plain_text !== "string" && cloned.text?.content) {
    cloned.plain_text = cloned.text.content;
  }
  return cloned;
}

/**
 * Sanitizes and validates an array of Notion rich_text objects.
 * 
 * This function filters out invalid rich_text objects and normalizes valid ones.
 * It removes empty text content (except when links are present), malformed objects,
 * and ensures all remaining objects conform to Notion's rich_text specification.
 * 
 * @param {Array<object>} items - Array of rich_text objects to sanitize
 * 
 * @returns {Array<object>} Filtered and sanitized array of valid rich_text objects
 * 
 * @example
 * const mixed = [
 *   { type: "text", text: { content: "Valid text" } },
 *   { type: "text", text: { content: "" } }, // Will be removed (empty)
 *   { type: "text", text: { content: "", link: { url: "https://example.com" } } }, // Kept (has link)
 *   { type: "invalid" }, // Will be removed (malformed)
 *   null, // Will be removed (null)
 *   undefined // Will be removed (undefined)
 * ];
 * const sanitized = sanitizeRichTextArray(mixed);
 * // Returns: [{ type: "text", text: { content: "Valid text" } }, { type: "text", text: { content: "", link: {...} } }]
 * 
 * @see {@link cloneRichText} for individual object cloning and normalization
 */
function sanitizeRichTextArray(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((rt) => cloneRichText(rt))
    .filter((rt) => {
      if (!rt || typeof rt.type !== "string") {
        return false;
      }
      if (rt.type === "text") {
        const content = rt.text?.content;
        if (typeof content !== "string") {
          return false;
        }
        // Allow content that has visible characters (including non-breaking space) or links
        return content.length > 0 || !!rt.text?.link;
      }
      return !!rt[rt.type];
    });
}

/**
 * @typedef {object} NotionRichText
 * @property {string} type - Rich text type ("text", "mention", "equation")
 * @property {object} [text] - Text content object for "text" type
 * @property {string} text.content - The actual text content
 * @property {object} [text.link] - Link object with url property
 * @property {object} annotations - Formatting annotations
 * @property {boolean} annotations.bold - Bold formatting
 * @property {boolean} annotations.italic - Italic formatting
 * @property {boolean} annotations.strikethrough - Strikethrough formatting
 * @property {boolean} annotations.underline - Underline formatting
 * @property {boolean} annotations.code - Inline code formatting
 * @property {string} annotations.color - Text color (from VALID_RICH_TEXT_COLORS)
 * @property {string} [plain_text] - Plain text representation
 */

/**
 * @typedef {object} ConversionOptions
 * @property {boolean} [preserveWhitespace=false] - Whether to preserve whitespace exactly
 * @property {boolean} [detectTechnicalTokens=true] - Whether to auto-detect technical identifiers
 */

// cleanHtmlText moved to utils/notion-format.cjs for better organization

// Import and re-export cleanHtmlText from notion-format for convenience
const { cleanHtmlText } = require('../utils/notion-format.cjs');

// Export all converter functions and utilities
module.exports = {
  /** @type {function(string|object, ConversionOptions=): NotionRichText[]} */
  convertRichTextBlock,
  /** @type {function(object): object|null} */
  cloneRichText,
  /** @type {function(object[]): object[]} */
  sanitizeRichTextArray,
  /** @type {function(object): object} Re-exported from utils/notion-format.cjs */
  normalizeAnnotations,
  /** @type {string[]} Re-exported from utils/notion-format.cjs */
  VALID_RICH_TEXT_COLORS,
  /** @type {function(string): string} Re-exported from utils/notion-format.cjs */
  cleanHtmlText
};
