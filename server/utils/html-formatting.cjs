/**
 * Shared HTML Formatting Utilities
 * 
 * Common logic for processing HTML elements and detecting technical content
 * Used by both servicenow.cjs (paragraphs) and rich-text.cjs (table cells)
 */

/**
 * Technical content detection patterns
 * Consolidated from servicenow.cjs and rich-text.cjs
 * Note: URLs are handled by <kbd> tag processing, not pattern matching
 */
const TECHNICAL_PATTERNS = {
  // File paths (Unix/Windows)
  path: /^[\/~\\]/i,
  
  // Placeholder syntax like <instance-name>, <value>
  placeholder: /<[^>]+>/i,
  
  // Domain extensions
  domain: /\.(com|net|org|io|dev|gov|edu|mil|info|biz|tech|app|co|us|uk)/i,
  
  // Dotted identifiers (e.g., table.field.value, my.package.Class)
  dottedIdentifier: /^[\w\-]+\.[\w\-]+\./,
  
  // ALL_CAPS constants (4+ characters, allowing underscores)
  constant: /^[A-Z_]{4,}$/,
  
  // Code characters that indicate technical content
  codeChars: /[\[\]{}();]/,
  
  // Programming identifier (snake_case or camelCase)
  programmingId: /^[a-z_][a-z0-9_]*$/i,
  
  // Additional check for programming identifiers
  hasUnderscore: /_/,
  isCamelCase: /[a-z][A-Z]/
};

/**
 * Determine if content is technical (should be formatted as code)
 * or a UI label (should be formatted as bold)
 * 
 * @param {string} content - Text content to analyze
 * @returns {boolean} True if technical content, false if UI label
 */
function isTechnicalContent(content) {
  if (!content || typeof content !== 'string') return false;
  
  const trimmed = content.trim();
  if (!trimmed) return false;
  
  // Check each technical pattern
  // Note: URL detection removed - URLs are handled by <kbd> tag processing
  if (TECHNICAL_PATTERNS.path.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.placeholder.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.domain.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.dottedIdentifier.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.constant.test(trimmed)) return true;
  if (TECHNICAL_PATTERNS.codeChars.test(trimmed)) return true;
  
  // Programming identifier check (must have underscore or camelCase)
  if (TECHNICAL_PATTERNS.programmingId.test(trimmed)) {
    return TECHNICAL_PATTERNS.hasUnderscore.test(trimmed) || 
           TECHNICAL_PATTERNS.isCamelCase.test(trimmed);
  }
  
  return false;
}

/**
 * Process <kbd> tag content with intelligent detection
 * 
 * @param {string} content - Content inside <kbd> tag (already decoded)
 * @returns {string} Formatted content with appropriate markers
 */
function processKbdContent(content) {
  if (isTechnicalContent(content)) {
    return `__CODE_START__${content}__CODE_END__`;
  } else {
    return `__BOLD_START__${content}__BOLD_END__`;
  }
}

/**
 * Check if content is in a CODE block context
 * Used to determine if spans should be treated as technical even if they don't match patterns
 * 
 * @param {Object} options - Processing options
 * @param {Array} options.activeBlocks - Stack of active block types
 * @returns {boolean} True if in a code block
 */
function isInCodeBlock(options) {
  if (!options || !options.activeBlocks) return false;
  return options.activeBlocks.some(block => block.type === 'code');
}

/**
 * Decode common HTML entities
 * 
 * @param {string} html - HTML string with entities
 * @returns {string} Decoded string
 */
function decodeHtmlEntities(html) {
  if (!html || typeof html !== 'string') return html;
  
  return html
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Process technical identifier spans (ph, keyword, parmname, codeph)
 * Simplified logic that consolidates both processing paths
 * 
 * @param {string} content - Span content
 * @param {Object} options - Processing options (including activeBlocks)
 * @returns {string} Formatted content
 */
function processTechnicalSpan(content, options = {}) {
  const cleanContent = typeof content === 'string' ? content.trim() : '';
  if (!cleanContent) return ' '; // Return space for empty content
  
  // If already contains placeholder markers, return as-is
  if (cleanContent.includes('__') && 
      (cleanContent.includes('_START__') || cleanContent.includes('_END__') || 
       cleanContent.includes('_PLACEHOLDER_'))) {
    return content;
  }
  
  // Check if in CODE block context - if so, treat as technical
  if (isInCodeBlock(options)) {
    return `__CODE_START__${cleanContent}__CODE_END__`;
  }
  
  // Use simplified technical detection
  if (isTechnicalContent(cleanContent)) {
    return `__CODE_START__${cleanContent}__CODE_END__`;
  }
  
  // Not technical - return plain content (let parent formatting apply)
  return cleanContent;
}

/**
 * Standard marker patterns used throughout the system
 */
const MARKERS = {
  BOLD: { START: '__BOLD_START__', END: '__BOLD_END__' },
  ITALIC: { START: '__ITALIC_START__', END: '__ITALIC_END__' },
  CODE: { START: '__CODE_START__', END: '__CODE_END__' },
  UNDERLINE: { START: '__UNDERLINE_START__', END: '__UNDERLINE_END__' },
  STRIKETHROUGH: { START: '__STRIKETHROUGH_START__', END: '__STRIKETHROUGH_END__' },
  BOLD_BLUE: { START: '__BOLD_BLUE_START__', END: '__BOLD_BLUE_END__' },
};

/**
 * Wrap content with markers
 * 
 * @param {string} content - Content to wrap
 * @param {string} markerType - Type of marker (BOLD, ITALIC, CODE, etc.)
 * @returns {string} Wrapped content
 */
function wrapWithMarkers(content, markerType) {
  const marker = MARKERS[markerType];
  if (!marker) return content;
  return `${marker.START}${content}${marker.END}`;
}

module.exports = {
  // Detection functions
  isTechnicalContent,
  isInCodeBlock,
  
  // Processing functions
  processKbdContent,
  processTechnicalSpan,
  decodeHtmlEntities,
  
  // Utilities
  wrapWithMarkers,
  
  // Constants
  MARKERS,
  TECHNICAL_PATTERNS
};
