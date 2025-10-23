/**
 * @fileoverview Notion Formatting Utilities
 * 
 * This module provides core formatting utilities for Notion API integration,
 * including color validation, annotation normalization, and HTML text cleaning.
 * These utilities ensure that content sent to Notion conforms to API requirements.
 * 
 * Key Features:
 * - Rich text color validation against Notion's supported colors
 * - Annotation object normalization with default values
 * - HTML entity decoding and tag stripping
 * - Whitespace normalization for clean text output
 * 
 * @module utils/notion-format
 * @since 8.2.5
 */

/**
 * Set of valid rich text colors supported by Notion's API.
 * 
 * This includes both standard colors and background color variants.
 * Using colors outside this set will result in API errors.
 * 
 * @type {Set<string>}
 * @readonly
 * 
 * @example
 * if (VALID_RICH_TEXT_COLORS.has('blue')) {
 *   // Safe to use 'blue' color in annotations
 * }
 */
const VALID_RICH_TEXT_COLORS = new Set([
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
  'gray_background',
  'brown_background',
  'orange_background',
  'yellow_background',
  'green_background',
  'blue_background',
  'purple_background',
  'pink_background',
  'red_background',
]);

/**
 * Normalizes a Notion rich text annotations object to ensure API compliance.
 * 
 * This function takes any input and produces a valid Notion annotations object
 * with proper boolean values and validated colors. It prevents API errors by
 * ensuring all properties have correct types and valid values.
 * 
 * @param {*} annotations - Input annotations object (any type accepted)
 * 
 * @returns {object} Normalized annotations object with all required properties
 * @returns {boolean} returns.bold - Bold formatting flag
 * @returns {boolean} returns.italic - Italic formatting flag  
 * @returns {boolean} returns.strikethrough - Strikethrough formatting flag
 * @returns {boolean} returns.underline - Underline formatting flag
 * @returns {boolean} returns.code - Inline code formatting flag
 * @returns {string} returns.color - Valid color from VALID_RICH_TEXT_COLORS set
 * 
 * @example
 * const normalized = normalizeAnnotations({
 *   bold: true,
 *   color: 'BLUE',  // Will be normalized to 'blue'
 *   invalid: 'ignored'  // Invalid properties are ignored
 * });
 * // Returns: { bold: true, italic: false, strikethrough: false, underline: false, code: false, color: 'blue' }
 * 
 * @example  
 * const normalized = normalizeAnnotations(null);
 * // Returns: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' }
 * 
 * @see {@link VALID_RICH_TEXT_COLORS} for supported color values
 */
function normalizeAnnotations(annotations) {
  const input = annotations && typeof annotations === 'object' ? annotations : {};
  const normalized = {
    bold: !!input.bold,
    italic: !!input.italic,
    strikethrough: !!input.strikethrough,
    underline: !!input.underline,
    code: !!input.code,
    color: 'default',
  };

  if (typeof input.color === 'string') {
    const candidate = input.color.toLowerCase();
    if (VALID_RICH_TEXT_COLORS.has(candidate)) {
      normalized.color = candidate;
    }
  }

  if (!VALID_RICH_TEXT_COLORS.has(normalized.color)) {
    normalized.color = 'default';
  }

  return normalized;
}

/**
 * Removes HTML tags and decodes HTML entities from text content.
 * 
 * This function strips all HTML markup and converts HTML entities (both named
 * and numeric) back to their corresponding characters, then normalizes whitespace
 * to produce clean, readable text suitable for Notion blocks.
 * 
 * @param {string} html - HTML string to clean and decode
 * 
 * @returns {string} Clean plain text with HTML entities decoded and whitespace normalized
 * 
 * @example
 * const clean = cleanHtmlText('<p>Hello &amp; <strong>world</strong>!</p>');
 * // Returns: "Hello & world!"
 * 
 * @example
 * const clean = cleanHtmlText('Price: &#36;100&nbsp;USD &lt;tax included&gt;');
 * // Returns: "Price: $100 USD <tax included>"
 * 
 * @example
 * const clean = cleanHtmlText('   Multiple   \n\n   spaces   ');
 * // Returns: "Multiple spaces"
 */
function cleanHtmlText(html) {
  if (!html) return "";

  // DEBUG: Log if input contains URLs
  if (html.includes('http')) {
    console.log('🚨 [cleanHtmlText] INPUT WITH URL:', html.substring(0, 500));
  }

  // CRITICAL STEP 1: Protect technical placeholders FIRST (before any processing)
  // Convert &lt;placeholder-text&gt; patterns to markers so they survive HTML stripping
  // This handles both already-decoded (<instance-name>) and HTML-encoded (&lt;Tool ID&gt;) placeholders
  const technicalPlaceholders = [];
  html = html.replace(/&lt;([^&]+)&gt;/g, (match, content) => {
    // Check if this looks like an HTML tag or a placeholder
    const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*(\s|$)/i.test(content.trim());
    if (!isHtmlTag) {
      const marker = `__TECH_PLACEHOLDER_${technicalPlaceholders.length}__`;
      technicalPlaceholders.push(content);
      return marker;
    }
    return match; // Leave HTML-encoded tags for normal decoding
  });
  
  // Also protect already-decoded placeholders like <instance-name>
  html = html.replace(/<([^>]+)>/g, (match, content) => {
    const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*(\s|$|>)/i.test(content.trim());
    if (!isHtmlTag) {
      const marker = `__TECH_PLACEHOLDER_${technicalPlaceholders.length}__`;
      technicalPlaceholders.push(content);
      return marker;
    }
    return match; // Leave HTML tags for normal processing
  });

  // CRITICAL STEP 2: Extract and protect URLs (may contain placeholder markers now)
  const urlPlaceholders = [];
  let text = html.replace(/\b(https?:\/\/[^\s]+?)(?=\s|$)/gi, (match, url) => {
    console.log('🚨 [cleanHtmlText] FOUND URL:', url);
    // Decode HTML entities within the URL
    let cleanUrl = url
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    // Clean any actual HTML tags from URL but preserve placeholders
    // Match only known HTML tags, not arbitrary text in angle brackets
    // Common tags: div, span, p, a, img, br, hr, b, i, u, strong, em, etc.
    cleanUrl = cleanUrl.replace(/<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|code|pre|ul|ol|li|table|tr|td|th|h[1-6]|font|center|small|big|sub|sup)(?:\s+[^>]*)?>/gi, '');
    console.log('🚨 [cleanHtmlText] DECODED URL:', cleanUrl);
    const placeholder = `__URL_PLACEHOLDER_${urlPlaceholders.length}__`;
    urlPlaceholders.push(cleanUrl);
    return placeholder;
  });

  // Decode HTML entities (after URL extraction)
  // This ensures entity-encoded tags like &lt;div&gt; get decoded to <div> so they can be stripped
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

  // NOW remove HTML tags (including any that were entity-encoded)
  // Match actual HTML tags but preserve technical placeholders like <instance-name> or <Tool ID>
  // HTML tags: <tagname>, <tagname attr="value">, </tagname>
  // Preserved: <instance-name>, <Tool ID>, <file.txt>, <hostname>, etc.
  text = text.replace(/<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|code|pre|ul|ol|li|table|tr|td|th|tbody|thead|tfoot|h[1-6]|font|center|small|big|sub|sup|abbr|cite|del|ins|mark|s|strike|blockquote|q|address|article|aside|footer|header|main|nav|section|details|summary|figure|figcaption|time|video|audio|source|canvas|svg|path|g|rect|circle|line|polyline|polygon)(?:\s+[^>]*)?>/gi, ' ');
  
  // Safety: Remove incomplete HTML tags that might have been truncated during chunking
  // Only match known HTML tag names at end of string
  text = text.replace(/<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|code|pre|ul|ol|li|table|tr|td|th|h[1-6]|font|center|small|big|sub|sup)(?:\s+[^>]*)?$/gi, ' ');
  
  // Pattern 2: Only strip if it starts with tag-like content (tag name followed by = for attributes)
  // This ensures we don't strip legitimate content like "All > System"
  text = text.replace(/^[a-z][a-z0-9]*\s*[a-z]+\s*=\s*[^>]*>/gi, " ");
  
  // REMOVED: Don't strip standalone < and > characters - they may be legitimate content like navigation arrows
  // text = text.replace(/</g, " ").replace(/>/g, " ");

  // Clean up whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Restore URL placeholders
  urlPlaceholders.forEach((url, index) => {
    text = text.replace(`__URL_PLACEHOLDER_${index}__`, url);
  });

  // Restore technical placeholders (convert markers back to <content>)
  technicalPlaceholders.forEach((content, index) => {
    text = text.replace(`__TECH_PLACEHOLDER_${index}__`, `<${content}>`);
  });

  return text;
}

/**
 * @typedef {object} NotionAnnotations
 * @property {boolean} bold - Bold text formatting
 * @property {boolean} italic - Italic text formatting
 * @property {boolean} strikethrough - Strikethrough text formatting
 * @property {boolean} underline - Underline text formatting
 * @property {boolean} code - Inline code formatting
 * @property {string} color - Text/background color from VALID_RICH_TEXT_COLORS
 */

// Export formatting utilities
module.exports = { 
  /** @type {Set<string>} Set of valid Notion rich text colors */
  VALID_RICH_TEXT_COLORS, 
  /** @type {function(*): NotionAnnotations} */
  normalizeAnnotations, 
  /** @type {function(string): string} */
  cleanHtmlText 
};
