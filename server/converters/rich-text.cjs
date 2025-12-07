const { convertServiceNowUrl } = require("../utils/url.cjs");
const fs = require('fs');
const { 
  isTechnicalContent, 
  processKbdContent, 
  processTechnicalSpan,
  decodeHtmlEntities: decodeEntities,
  isInCodeBlock 
} = require('../utils/html-formatting.cjs');
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

// Module-level storage for placeholder warnings
// These will be logged with page context in w2n.cjs after page creation
let placeholderWarnings = [];

/**
 * Get and clear any accumulated placeholder warnings
 * @returns {Array} Array of warning objects with context
 */
function getAndClearPlaceholderWarnings() {
  const warnings = placeholderWarnings;
  placeholderWarnings = [];
  return warnings;
}

/**
 * Add a placeholder warning to be logged later with page context
 * @param {Array} placeholders - Array of placeholder strings that would be stripped
 * @param {string} context - First 200 chars of the HTML context
 */
function addPlaceholderWarning(placeholders, context) {
  placeholderWarnings.push({
    placeholders,
    context,
    timestamp: new Date().toISOString()
  });
}

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
  
  // DEBUG: Check if input contains "Role required"
  if (html && html.toLowerCase().includes('role required')) {
    console.log(`🔍 [ROLE DEBUG] convertRichTextBlock received input with "Role required":`);
    console.log(`   Input: "${html}"`);
  }
  
  // DEBUG: Log what we receive
  if (html && html.includes('__CODE_START__')) {
    fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-url-extract.log',
      `\n=== convertRichTextBlock INPUT ===\n${JSON.stringify(html.substring(0, 300))}\n`);
  }
  
  // CRITICAL: Protect technical placeholders FIRST before any HTML processing
  // Convert <placeholder-text> and &lt;placeholder-text&gt; patterns to markers
  // This ensures they survive HTML stripping and entity decoding
  // Examples: <instance-name>, <Tool ID>, &lt;file-name&gt;, &lt;Tool ID&gt;
  const placeholders = [];
  
    // Decode any HTML entities first
  html = decodeEntities(html);
  
  // Convert <br> and <br/> tags to special marker BEFORE HTML tag stripping
  // Use marker to distinguish intentional breaks from HTML formatting whitespace
  const beforeBrConversion = html;
  html = html.replace(/<br\s*\/?>/gi, '__BR_NEWLINE__');
  if (beforeBrConversion !== html) {
    console.log(`🔍 [BR-CONVERSION] Converted <br> tags to __BR_NEWLINE__ markers`);
    console.log(`   Before: "${beforeBrConversion.substring(0, 150)}"`);
    console.log(`   After: "${html.substring(0, 150)}"`);
  }
  
  // Remove SVG elements entirely (including their content) FIRST - these are just decorative icons
  // This must happen before placeholder extraction to prevent SVG content from being protected
  // Prevents SVG markup like "<use xlink:href="#ico-related-link"></use>" from appearing as text
  const beforeSvgStrip = html;
  html = html.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  if (beforeSvgStrip !== html) {
    console.log(`🔍 [SVG STRIP] Removed SVG elements from HTML`);
    console.log(`   Before: "${beforeSvgStrip.substring(0, 200)}"`);
    console.log(`   After: "${html.substring(0, 200)}"`);
  }
  
  // First, protect HTML-encoded placeholders: &lt;placeholder-text&gt;
  html = html.replace(/&lt;([^&]+)&gt;/g, (match, content) => {
    const trimmed = content.trim();
    // Check if it's an HTML tag (e.g., &lt;div&gt;) or a placeholder
    const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*(\s|$)/i.test(trimmed);
    if (!isHtmlTag) {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(content);
      return placeholder;
    }
    return match; // Leave encoded HTML tags for normal decoding
  });
  
  // Then, protect already-decoded placeholders: <placeholder-text>
  html = html.replace(/<([^>]+)>/g, (match, content) => {
    const trimmed = content.trim();
    // HTML tags: start with / or lowercase letter, followed by tag name (no spaces/hyphens in tag name itself)
    // Examples: <div>, </div>, <span class="x">, <a href="...">
    // SVG tags: svg, use, path, g, etc.
    const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*(\s|$|>)/i.test(trimmed);
    const isSvgTag = /^\/?\s*(svg|use|path|g|rect|circle|line|polyline|polygon|defs|symbol)/i.test(trimmed);
    
    if (!isHtmlTag && !isSvgTag) {
      const placeholder = `__PLACEHOLDER_${placeholders.length}__`;
      placeholders.push(content);
      return placeholder;
    }
    // It's an HTML or SVG tag, leave it alone for normal processing
    return match;
  });
  
  // DEBUG: Log input HTML if it contains span tags
  if (html.includes('<span')) {
    console.log(`🔍 [rich-text.cjs] convertRichTextBlock called with HTML containing <span>:`);
    console.log(`   Input: "${html.substring(0, 250)}..."`);
  }

  // CRITICAL FIX: Strip HTML tags that could break technical identifier detection
  // This must happen BEFORE technical identifier regex processing
  // The regex requires contiguous text, but HTML tags between identifier parts break matching
  // Example: <span>sn_devops</span>.<span>admin</span> becomes sn_devops.admin after stripping
  const beforeHtmlStrip = html;
  
  // FIX v11.0.117: Preserve abbreviation content FIRST (before stripping tags)
  // <abbr> elements contain visual separators in menu cascades like <abbr> > </abbr>
  // Convert <abbr>CONTENT</abbr> to just CONTENT so separators don't disappear
  const beforeAbbrPreserve = html;
  html = html.replace(/<abbr[^>]*>([^<]*)<\/abbr>/gi, '$1');
  if (beforeAbbrPreserve !== html) {
    console.log(`✅ [ABBR-PRESERVE] Preserved <abbr> content (menu cascade separators)`);
    console.log(`   Before: "${beforeAbbrPreserve.substring(0, 150)}"`);
    console.log(`   After:  "${html.substring(0, 150)}"`);
  }
  
  // Split by existing markers to protect already-processed content
  const htmlStripParts = html.split(/(__BR_NEWLINE__|__[A-Z_]+__)/);
  html = htmlStripParts.map(part => {
    // Skip markers - don't process them
    if (part.startsWith('__') && part.endsWith('__')) {
      return part;
    }
    // Strip HTML tags from unprotected content
    // CRITICAL: Replace tags with empty string when they appear to be between technical identifier parts
    // This prevents spaces from breaking regex patterns like "sn_devops.admin"
    // IMPORTANT: Don't strip <code> and <samp> tags - they are handled separately later
    return part.replace(/<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|var|pre|ul|ol|li|table|tr|td|th|tbody|thead|tfoot|h[1-6]|font|center|small|big|sub|sup|cite|del|ins|mark|s|strike|blockquote|q|address|article|aside|footer|header|main|nav|section|details|summary|figure|figcaption|time|video|audio|source|canvas|svg|path|g|rect|circle|line|polyline|polygon)(?:\s+[^>]*)?>/gi, '');
  }).join('');
  
  // Clean up excessive whitespace from tag removal, but preserve intentional spaces
  // Only collapse multiple consecutive spaces, don't remove single spaces that might be intentional
  html = html.replace(/[^\S\n]{2,}/g, ' '); // Replace 2+ consecutive non-newline whitespace with single space
  
  if (beforeHtmlStrip !== html) {
    console.log(`🧹 [PRE-TECH-ID HTML STRIP] Stripped HTML tags before technical identifier detection`);
    console.log(`   Before: "${beforeHtmlStrip.substring(0, 150)}"`);
    console.log(`   After:  "${html.substring(0, 150)}"`);
  }

  // CRITICAL FIX: Process technical identifiers BEFORE any HTML tag processing
  // This prevents the regex from matching corrupted marker text
  // Handle raw technical identifiers in parentheses/brackets as inline code
  // Must contain at least one dot or underscore to be considered a technical identifier
  // Remove the brackets/parentheses from the output (treat same as parentheses around code)
  html = html.replace(/([\(\[])[ \t\n\r]*([a-zA-Z][-a-zA-Z0-9_]*(?:[_.][-a-zA-Z0-9_]+)+)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => `__CODE_START__${code.trim()}__CODE_END__`);

  // Handle "Role required:" followed by comma-separated role names as inline code
  // Examples: "Role required: admin", "Role required: sn_devops.admin, asset", "Role required: sam"
  // Roles can contain underscores and dots (e.g., sn_devops.admin)
  // CRITICAL: Process text in segments split by __BR_NEWLINE__ to avoid matching across line breaks
  const beforeSplit = html;
  const segments = html.split(/(__BR_NEWLINE__|__[A-Z_]+__)/);
  if (beforeSplit.includes('Role required:')) {
    console.log(`🔍 [ROLE-SPLIT] Split into ${segments.length} segments around markers`);
    segments.forEach((seg, idx) => {
      if (seg.includes('Role required:') || seg.includes('admin') || seg.includes('__BR_NEWLINE__')) {
        console.log(`🔍 [ROLE-SPLIT]   [${idx}] "${seg.substring(0, 80)}"`);
      }
    });
  }
  html = segments.map((segment, idx) => {
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

  // Standalone multi-word identifiers connected by _ or . (no spaces) as inline code
  // Each segment can start with a letter, can contain letters, numbers, hyphens, and underscores
  // Examples: com.snc.incident.mim.ml_solution, sys_user_table, sn_devops.admin, package.class.method, com.glide.service-portal
  // FIX v11.0.111: Changed from {2,} to {1,} to match 2-segment identifiers like "inventory_user"
  // Must have at least 2 segments separated by . or _ and no brackets/parentheses
  // CRITICAL: Process text in segments split by __BR_NEWLINE__ to avoid matching across line breaks
  const beforeTechSplit = html;
  const techSegments = html.split(/(__BR_NEWLINE__|__[A-Z_]+__)/);
  html = techSegments.map((segment, idx) => {
    // Skip markers - don't process them
    if (segment.startsWith('__') && segment.endsWith('__')) {
      return segment;
    }
    // Process this segment for technical identifiers
    // REQUIREMENT: Must contain at least one number or underscore (not just dots) to be technical
    return segment.replace(/\b([a-zA-Z][-a-zA-Z0-9_]*(?:[_.][a-zA-Z][-a-zA-Z0-9_]*){1,})\b/g, (match, identifier, offset, string) => {
    console.log(`🔍 [TECH ID REGEX] Matched: "${match}"`);
    
    // Skip if it doesn't contain at least one number or underscore (beyond just dots)
    // This prevents matching regular English text like "some.regular.words"
    const hasNumbersOrUnderscores = /[0-9_]/.test(match);
    if (!hasNumbersOrUnderscores) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - no numbers/underscores, likely not technical`);
      return match;
    }
    const fileExtensions = ['.txt', '.doc', '.docx', '.pdf', '.xml', '.json', '.html', '.htm', '.css', '.js', '.py', '.java', '.cpp', '.c', '.php', '.rb', '.go', '.rs', '.ts', '.jsx', '.tsx'];
    if (fileExtensions.some(ext => match.toLowerCase().endsWith(ext))) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - common file extension`);
      return match;
    }

    // Skip very short identifiers (less than 6 characters total, likely not technical)
    if (match.length < 6) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - too short for technical identifier`);
      return match;
    }
    const beforeMatch = string.substring(0, offset);
    const lastCodeStart = beforeMatch.lastIndexOf('__CODE_START__');
    const lastCodeEnd = beforeMatch.lastIndexOf('__CODE_END__');
    const lastUrlStart = beforeMatch.lastIndexOf('__URL_START__');
    const lastUrlEnd = beforeMatch.lastIndexOf('__URL_END__');
    
    // If there's a CODE_START after the last CODE_END, we're inside a code block
    if (lastCodeStart > lastCodeEnd) {
      if (match.includes('github') || match.includes('api') || match.includes('com')) {
        console.log(`🚫 [TECH ID - URL DEBUG] Skipping "${match}" at offset ${offset}`);
        console.log(`   lastCodeStart: ${lastCodeStart}, lastCodeEnd: ${lastCodeEnd}`);
        console.log(`   Context before (100 chars): "${beforeMatch.substring(Math.max(0, beforeMatch.length - 100))}"`);
      }
      return match; // Don't wrap, already in code block
    }
    
    // If there's a URL_START after the last URL_END, we're inside a URL block
    if (lastUrlStart > lastUrlEnd) {
      if (match.includes('github') || match.includes('api') || match.includes('com')) {
        console.log(`🚫 [TECH ID - URL PROTECTION] Skipping "${match}" - inside URL block`);
        console.log(`   lastUrlStart: ${lastUrlStart}, lastUrlEnd: ${lastUrlEnd}`);
      }
      return match; // Don't wrap, part of URL
    }
    
    // Skip if this identifier is IMMEDIATELY part of an active URL
    // Check if the protocol (http:// or https://) is immediately before this match with no whitespace break
    // Example: "https://api.github.com/<installation_id>" - <installation_id> is part of this URL (skip)
    // But: "https://api.github.com/tokens. For enterprise: https://<HOST_URL>" - <HOST_URL> is a NEW URL (don't skip)
    const contextBefore = string.substring(Math.max(0, offset - 10), offset);
    // Check if we're immediately after a protocol (less than 10 chars back, no whitespace between)
    const immediatelyAfterProtocol = /https?:\/\/$/i.test(contextBefore);
    
    if (immediatelyAfterProtocol) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - immediately after URL protocol`);
      return match; // This is the start of a URL hostname, don't wrap
    }

    // Skip ServiceNow path segments ending in .do (should remain plain text)
    if (/\.do$/i.test(match)) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - ServiceNow .do path segment`);
      return match;
    }

    // Skip identifiers that are part of query strings or URL segments (adjacent to delimiters)
    const beforeChar = offset > 0 ? string[offset - 1] : '';
    const afterChar = string[offset + match.length];
    if (beforeChar === '/' || beforeChar === '?') {
      console.log(`🚫 [TECH ID] Skipping "${match}" - preceded by "${beforeChar}" (URL delimiter)`);
      return match;
    }
    if (afterChar && '?=&'.includes(afterChar)) {
      console.log(`🚫 [TECH ID] Skipping "${match}" - followed by "${afterChar}" (query delimiter)`);
      return match;
    }
    
    console.log(`✅ [TECH ID] Wrapping "${match}" as inline code`);
    return `__CODE_START__${identifier}__CODE_END__`;
  });
  }).join('');
  if (beforeTechSplit !== html) {
    console.log(`🔧 [AFTER TECH ID] HTML (first 300 chars): "${html.substring(0, 300)}"`);
  }

  // Convert URL markers to code markers AFTER technical identifier processing
  // This ensures URLs are wrapped as inline code without their parts being wrapped separately
  html = html.replace(/__URL_START__/g, '__CODE_START__');
  html = html.replace(/__URL_END__/g, '__CODE_END__');

  // Extract and store links first with indexed placeholders
  const links = [];
  html = html.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, content) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    let href = hrefMatch ? hrefMatch[1] : "";
    // Convert relative ServiceNow URLs to absolute
    href = convertServiceNowUrl(href);
    
    // CRITICAL: Strip span tags and SVG icons from link content BEFORE storing
    // This handles cases like: <a href="...">Contact <span class="ph">Support</span></a>
    // and: <a href="..."><svg>...</svg>Link Text</a>
    let cleanedContent = content;
    
    // Strip SVG icons from link content (these are just decorative icons)
    cleanedContent = cleanedContent.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    
    // Strip span tags with keyword/parmname/codeph/apiname classes from link content
    // Note: Generic "ph" class removed - only specific technical classes
    cleanedContent = cleanedContent.replace(
      /<span[^>]*class=["'][^"']*(?:\bkeyword\b|\bparmname\b|\bcodeph\b|\bapiname\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
      (spanMatch, spanContent) => {
        // Just return the content without the span tags
        return spanContent || '';
      }
    );
    
    // Also strip generic <span class="ph"> wrappers inside link text (unwrap, keep content)
    // Do this iteratively to handle nested ph spans
    let before;
    do {
      before = cleanedContent;
      cleanedContent = cleanedContent.replace(
        /<span[^>]*class=["'][^"']*\bph\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
        '$1'
      );
    } while (cleanedContent !== before && /<span[^>]*\bph\b[^>]*>/i.test(cleanedContent));

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
  // Handle italic/em/dfn tags (dfn = definition term, semantically rendered as italic)
  html = html.replace(/<(i|em|dfn)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => `__ITALIC_START__${content}__ITALIC_END__`);
  
  // Handle kbd tags - use shared utility for intelligent detection
  html = html.replace(/<kbd([^>]*)>([\s\S]*?)<\/kbd>/gi, (match, attrs, content) => {
    // Decode HTML entities within kbd content
    const decoded = decodeEntities(content);
    
    // Use shared processing utility
    return processKbdContent(decoded);
  });

  // Wrap complete URLs in special markers BEFORE <code> tag processing
  // This prevents <code> tags from wrapping URLs that should stay intact
  // Match complete URLs including dots in domain and path, but stop at whitespace or sentence-ending punctuation followed by space/end
  const beforeUrls = html;
  html = html.replace(/(https?:\/\/[^\s<]+)/gi, (match) => {
    // Remove trailing punctuation that's clearly not part of the URL
    let url = match;
    let trailing = '';
    
    // If URL ends with sentence punctuation, remove it (but keep dots/commas that are part of the URL)
    const trailingPuncMatch = url.match(/([.,;:!?)\]}\s]+)$/);
    if (trailingPuncMatch) {
      // Only remove if it's clearly sentence-ending (like ". " or "." at end)
      const punct = trailingPuncMatch[1];
      // Keep the punctuation that's part of URLs, remove sentence-ending punctuation
      if (punct.match(/^[.,;:!?)\]}\s]+$/)) {
        trailing = punct;
        url = url.slice(0, -punct.length);
      }
    }
    
    console.log(`🔗 [URL WRAP] Found URL: "${url}"`);
    if (trailing) {
      console.log(`   Trailing: "${trailing}"`);
    }
    // Wrap URL with protective markers, preserve trailing punctuation
    const result = `__URL_START__${url}__URL_END__${trailing}`;
    console.log(`   Result: "${result.substring(0, 150)}"`);
    return result;
  });
  if (beforeUrls !== html) {
    console.log(`🔗 [URL WRAP] HTML changed after URL wrapping`);
  }
  
  // DEBUG: Check if HTML contains samp tags BEFORE handler runs
  if (html.includes('<samp') || html.includes('&lt;samp')) {
    console.log(`🔍 [SAMP PRE-HANDLER] HTML contains samp tag BEFORE handler:`);
    const sampIndex = html.indexOf('<samp') >= 0 ? html.indexOf('<samp') : html.indexOf('&lt;samp');
    console.log(`   Context: "${html.substring(Math.max(0, sampIndex - 50), sampIndex + 200)}"`);
  }
  
  // Handle inline code tags (<code> and <samp>)
  html = html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (match, attrs, content) => {
    const result = `__CODE_START__${content}__CODE_END__`;
    fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-richtext.log', 
      `CODE TAG: "${content.substring(0, 100)}" → "${result.substring(0, 150)}"\n`);
    return result;
  });
  
  // Handle <samp> tags (sample output/system output) - treat same as inline code
  html = html.replace(/<samp([^>]*)>([\s\S]*?)<\/samp>/gi, (match, attrs, content) => {
    const result = `__CODE_START__${content}__CODE_END__`;
    console.log(`💾 [SAMP TAG] Converting <samp> to inline code: "${content.substring(0, 100)}"`);
    fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-richtext.log', 
      `SAMP TAG: "${content.substring(0, 100)}" → "${result.substring(0, 150)}"\n`);
    return result;
  });

  // Handle <var> tags (variable/placeholder markup) - strip wrapper but keep inner content
  if (/<var[\s>]/i.test(html)) {
    console.log('🧪 [VAR TAG] Stripping <var> wrappers while preserving content');
    html = html.replace(/<var[^>]*>([\s\S]*?)<\/var>/gi, '$1');
  }
  
  fs.appendFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/debug-richtext.log', 
    `AFTER CODE/SAMP TAGS: "${html.substring(0, 200)}"\n\n`);
  
    // Handle span with uicontrol class as bold + blue
    html = html.replace(/<span[^>]*class=["'][^"']*\buicontrol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
      return `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`;
    });  // Handle spans with technical identifier classes (keyword, parmname, codeph, etc.)
  // Use shared utility for simplified, consistent detection
  // CRITICAL FIX: Always return the content (not the HTML tags) even if not detected as technical
  // NOTE: Generic "ph" class removed from inline code formatting - only specific technical classes get formatting
  // NOTE: This runs AFTER cmd handler, so <span class="ph cmd"> has already been processed
  const htmlBefore = html;
  
  // Log if we have span tags to process
  if (html.includes('<span') && html.includes('com.snc.incident.ml')) {
    console.log(`🔍 [ph span strip] BEFORE stripping, HTML contains com.snc.incident.ml:`);
    const snippet = html.substring(html.indexOf('com.snc.incident.ml') - 50, html.indexOf('com.snc.incident.ml') + 100);
    console.log(`   "${snippet}"`);
  }
  
  // First, strip generic <span class="ph"> tags that don't have technical identifiers
  // This allows their content to be processed by the technical identifier regex later
  // CRITICAL: Run in a loop to handle nested spans (innermost to outermost)
  let lastHtml;
  let iterations = 0;
  do {
    lastHtml = html;
    html = html.replace(/<span[^>]*class=["'][^"']*\bph\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1');
    iterations++;
    if (iterations > 1 && lastHtml !== html) {
      console.log(`🔍 [ph span strip] Iteration ${iterations}: removed ${(lastHtml.match(/<span/g) || []).length - (html.match(/<span/g) || []).length} span tags`);
    }
  } while (html !== lastHtml && html.includes('<span') && iterations < 10);
  
  // Log after stripping
  if (htmlBefore.includes('<span') && htmlBefore.includes('com.snc.incident.ml')) {
    console.log(`🔍 [ph span strip] AFTER ${iterations} iteration(s):`);
    const snippet = html.substring(html.indexOf('com.snc.incident.ml') - 50, html.indexOf('com.snc.incident.ml') + 100);
    console.log(`   "${snippet}"`);
    console.log(`   Spans remaining: ${(html.match(/<span/g) || []).length}`);
  }
  
  // Then handle specific technical identifier classes (keyword, parmname, codeph, apiname)
  html = html.replace(/<span[^>]*class=["'][^"']*(?:\bkeyword\b|\bparmname\b|\bcodeph\b|\bapiname\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    if (process.env.SN2N_VERBOSE === '1') {
      console.log(`🔍 Matched span with class keyword/parmname/codeph/apiname: "${match.substring(0, 80)}"`);
    }
    
    // Use shared processing utility
    return processTechnicalSpan(content, options);
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

  // Strip any remaining HTML tags that weren't converted to markers
  // This handles span tags, divs, and other markup that doesn't need special formatting
  // CRITICAL: Only strip KNOWN HTML tags, preserve technical placeholders like <instance-name>
  const beforeStrip = html;
  
  // CRITICAL: Remove figcaption content entirely - figcaptions should only be used as image captions, not as content text
  html = html.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, '');
  
  // FIRST: Check for potential unprotected technical placeholders before stripping
  // BUT: Only check content OUTSIDE of __CODE_START__...__CODE_END__ markers
  // Split by code markers to skip checking protected code content
  const checkParts = html.split(/(__CODE_START__|__CODE_END__)/);
  let inCodeCheck = false;
  const unprotectedPlaceholders = [];
  
  checkParts.forEach(part => {
    if (part === '__CODE_START__') {
      inCodeCheck = true;
    } else if (part === '__CODE_END__') {
      inCodeCheck = false;
    } else if (!inCodeCheck) {
      // Only check content OUTSIDE code blocks
      const potentialPlaceholders = part.match(/<([^>\/]+)>/g);
      if (potentialPlaceholders) {
        const knownHtmlTags = /^<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|code|samp|var|pre|ul|ol|li|table|tr|td|th|tbody|thead|tfoot|h[1-6]|font|center|small|big|sub|sup|abbr|cite|del|ins|mark|s|strike|blockquote|q|address|article|aside|footer|header|main|nav|section|details|summary|figure|figcaption|time|video|audio|source|canvas|svg|path|g|rect|circle|line|polyline|polygon)(?:\s+[^>]*)?>/i;
        
        const actualPlaceholders = potentialPlaceholders.filter(tag => !knownHtmlTags.test(tag));
        unprotectedPlaceholders.push(...actualPlaceholders);
      }
    }
  });
  
  if (unprotectedPlaceholders.length > 0) {
    // Store warning for later logging with page context
    addPlaceholderWarning(unprotectedPlaceholders, html.substring(0, 200));
    
    // Also log immediately for debugging
    console.warn(`⚠️ [PLACEHOLDER WARNING] Found ${unprotectedPlaceholders.length} unprotected technical placeholder(s) OUTSIDE code blocks:`);
    unprotectedPlaceholders.forEach(placeholder => {
      console.warn(`   ❌ Would strip: "${placeholder}"`);
    });
    console.warn(`   📍 Context (first 200 chars): "${html.substring(0, 200)}"`);
    console.warn(`   🔗 This content will be sent to Notion. Please verify the page manually after creation.`);
    console.warn(`   💡 Tip: These placeholders should have been protected earlier in processing.`);
  }
  
  // NOW: Strip known HTML tags, BUT preserve content inside __CODE_START__...__CODE_END__ markers
  // Split by code markers to protect code content from HTML stripping
  const codeParts = html.split(/(__CODE_START__|__CODE_END__)/);
  let inCode = false;
  html = codeParts.map(part => {
    if (part === '__CODE_START__') {
      inCode = true;
      return part;
    } else if (part === '__CODE_END__') {
      inCode = false;
      return part;
    } else if (inCode) {
      // Inside code block - preserve ALL content including angle brackets
      return part;
    } else {
      // Outside code block - strip known HTML tags
      // NOTE: dfn intentionally excluded - it's converted to italic markers at line 240
  return part.replace(/<\/?(?:div|span|p|a|img|br|hr|b|i|u|strong|em|code|samp|var|pre|ul|ol|li|table|tr|td|th|tbody|thead|tfoot|h[1-6]|font|center|small|big|sub|sup|abbr|cite|del|ins|mark|s|strike|blockquote|q|address|article|aside|footer|header|main|nav|section|details|summary|figure|figcaption|time|video|audio|source|canvas|svg|path|g|rect|circle|line|polyline|polygon)(?:\s+[^>]*)?>/gi, ' ');
    }
  }).join('');
  
  // Debug: Log if we stripped any span tags
  if (beforeStrip !== html && beforeStrip.includes('<span')) {
    console.log(`🧹 Stripped remaining HTML tags from: "${beforeStrip.substring(0, 100)}"`);
    console.log(`   Result: "${html.substring(0, 100)}"`);
  }
  
  // Clean up excessive whitespace from tag removal, BUT preserve newlines
  html = html.replace(/[^\S\n]+/g, ' '); // Replace consecutive non-newline whitespace with single space
  html = html.replace(/ *\n */g, '\n'); // Clean spaces around newlines

  // Convert __BR_NEWLINE__ markers back to actual newlines
  html = html.replace(/__BR_NEWLINE__/g, '\n');

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
          // CRITICAL FIX: Newlines should NOT inherit code formatting from the current line
          // to prevent code formatting from bleeding through to the next line
          if (i < lines.length - 1) {
            richText.push({
              type: "text",
              text: { content: '\n' },
              annotations: normalizeAnnotations({}), // Use empty annotations for newlines
            });
          }
        }
      }
    }
  }
  
  // Restore placeholders: convert __PLACEHOLDER_N__ markers back to <content>
  richText.forEach(rt => {
    if (rt.type === 'text' && rt.text && typeof rt.text.content === 'string') {
      rt.text.content = rt.text.content.replace(/__PLACEHOLDER_(\d+)__/g, (match, index) => {
        const placeholder = placeholders[parseInt(index)];
        return placeholder ? `<${placeholder}>` : match;
      });
    }
  });
  
  // POST-PROCESSING: Fix split URLs and code blocks
  // When URLs or code content gets split across multiple segments, reassemble them
  const fixedRichText = [];
  let mergeCount = 0;
  
  for (let i = 0; i < richText.length; i++) {
    const current = richText[i];
    
    // Skip non-text segments
    if (current.type !== 'text' || !current.text) {
      fixedRichText.push(current);
      continue;
    }
    
    // Check if we should merge with the previous segment
    if (fixedRichText.length > 0) {
      const prev = fixedRichText[fixedRichText.length - 1];
      
      if (prev.type === 'text' && prev.text) {
        const prevContent = prev.text.content;
        const currentContent = current.text.content;
        
        // CASE 1: Merge consecutive CODE segments (same code annotation)
        // This handles URLs or identifiers that got split: "service-" + "now.com"
        const bothCode = prev.annotations?.code === true && current.annotations?.code === true;
        const sameCodeColor = prev.annotations?.color === current.annotations?.color;
        
        if (bothCode && sameCodeColor && currentContent !== '\n') {
          console.log(`🔧 [MERGE CASE 1] Merging CODE segments: "${prevContent}" + "${currentContent}"`);
          // Merge by removing trailing space from prev and concatenating
          prev.text.content = prevContent.trimEnd() + currentContent.trimStart();
          mergeCount++;
          continue; // Skip adding current, we merged it
        }
        
        // CASE 2: Fix split URLs where part of URL lost CODE annotation
        // Pattern: prev is CODE with URL-like content, current starts with "/" or "?" or "#"
        // Example: prev="https://example.com" (CODE), current="/api" (NOT CODE)
        const prevIsCode = prev.annotations?.code === true;
        const prevLooksLikeUrl = /https?:\/\/[^\s]+/.test(prevContent);
        const currentIsUrlContinuation = /^[/?#]/.test(currentContent.trim());
        
        if (prevIsCode && prevLooksLikeUrl && currentIsUrlContinuation) {
          console.log(`🔧 [MERGE CASE 2] Merging URL continuation: "${prevContent}" + "${currentContent}"`);
          // Merge current into prev and apply CODE annotation to the merged content
          prev.text.content = prevContent.trimEnd() + currentContent.trimStart();
          mergeCount++;
          // Keep prev's CODE annotation
          continue; // Skip adding current, we merged it into prev
        }
        
        // CASE 3: Merge segments with identical annotations and no newlines
        const sameAnnotations = JSON.stringify(prev.annotations) === JSON.stringify(current.annotations);
        const sameLink = (!prev.text.link && !current.text.link) || 
          (prev.text.link && current.text.link && prev.text.link.url === current.text.link.url);
        const notNewline = currentContent !== '\n';
        
        if (sameAnnotations && sameLink && notNewline) {
          console.log(`🔧 [MERGE CASE 3] Merging same annotations: "${prevContent}" + "${currentContent}"`);
          // Merge content intelligently
          if (prevContent.endsWith(' ') && currentContent.startsWith(' ')) {
            // Both have space at boundary - keep only one
            prev.text.content = prevContent + currentContent.trimStart();
          } else if (prevContent.endsWith(' ') || currentContent.startsWith(' ')) {
            // One has space - keep it
            prev.text.content = prevContent + currentContent;
          } else {
            // No spaces - check if we need one
            // Add space if prev doesn't end with punctuation/newline and current doesn't start with punctuation
            const needsSpace = !/[.,;:!?)\]}>\n-]$/.test(prevContent) && !/^[.,;:!?(\[{<\n-]/.test(currentContent);
            prev.text.content = needsSpace ? prevContent + ' ' + currentContent : prevContent + currentContent;
          }
          mergeCount++;
          continue; // Skip adding current, we merged it
        }
      }
    }
    
    fixedRichText.push(current);
  }
  
  if (mergeCount > 0) {
    console.log(`✅ [POST-PROCESS] Merged ${mergeCount} segments: ${richText.length} → ${fixedRichText.length}`);
  }
  
  return fixedRichText;
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
  cleanHtmlText,
  /** @type {function(): Array} Get accumulated placeholder warnings */
  getAndClearPlaceholderWarnings,
  /** @type {function(Array, string): void} Add a placeholder warning */
  addPlaceholderWarning
};
