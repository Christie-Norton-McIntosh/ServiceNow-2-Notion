/**
 * Rich Text Converter for Notion blocks
 * Extracted from sn2n-proxy.cjs
 *
 * Exports:
 *   - convertRichTextBlock
 *   - normalizeAnnotations (re-export from utils)
 *   - VALID_RICH_TEXT_COLORS (re-export from utils)
 *
 * Dependencies:
 *   - server/utils/notion-format.cjs
 */

const { normalizeAnnotations, VALID_RICH_TEXT_COLORS } = require('../utils/notion-format.cjs');

/**
 * Converts HTML or plain text to Notion rich_text block array.
 * @param {string|object} input - HTML string or parsed node
 * @param {object} [options] - Conversion options
 * @returns {Array} Notion rich_text block array
 */
function convertRichTextBlock(input, options = {}) {
  // Convert HTML or plain text to Notion rich_text block array
  // This implementation is adapted from htmlToNotionRichText in sn2n-proxy.cjs
  const richText = [];
  let html = typeof input === "string" ? input : "";
  if (!html) return [];

  // Force insert __SOFT_BREAK__ after every closing </a> tag followed by any non-whitespace character
  html = html.replace(/(<a [^>]+>.*?<\/a>)(\s*[^\s<])/gi, (match, aTag, after) => `${aTag}__SOFT_BREAK__${after}`);

  // Handle anchor/link tags
  html = html.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (match, attrs, content) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const href = hrefMatch ? hrefMatch[1] : "";
    return `__LINK__${href}|${content}__`;
  });

  // Handle bold/strong tags
  html = html.replace(/<(b|strong)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => `__BOLD_START__${content}__BOLD_END__`);
  // Handle italic/em tags
  html = html.replace(/<(i|em)([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => `__ITALIC_START__${content}__ITALIC_END__`);
  // Handle inline code tags
  html = html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (match, attrs, content) => `__CODE_START__${content}__CODE_END__`);
  // Handle spans with technical identifier classes (ph, keyword, parmname, codeph, etc.) as inline code
  html = html.replace(/<span[^>]*class=["'][^"']*(?:\bph\b|\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
    const cleanedContent = typeof content === "string" ? content.trim() : "";
    if (!cleanedContent) return match;
    const strictTechnicalTokenRegex = /[A-Za-z0-9][A-Za-z0-9._-]*[._][A-Za-z0-9._-]+/g;
    let replaced = cleanedContent.replace(strictTechnicalTokenRegex, (token) => {
      const bareToken = token.trim();
      if (!bareToken) return token;
      const bareAlphaNumeric = bareToken.replace(/[._-]/g, "");
      if (bareAlphaNumeric && /^[A-Z0-9]+$/.test(bareAlphaNumeric)) return token;
      return `__CODE_START__${bareToken}__CODE_END__`;
    });
    return replaced !== cleanedContent ? replaced : match;
  });
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
  html = html.replace(/([\(\[])[ \t\n\r]*([^\s()[\]]*[_.][^\s()[\]]*)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => `__CODE_START__${code.trim()}__CODE_END__`);

  // Now split by markers and build rich text
  const parts = html.split(/(__BOLD_START__|__BOLD_END__|__ITALIC_START__|__ITALIC_END__|__CODE_START__|__CODE_END__|__LINK__[^_]*__)/);
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
    } else if (part.startsWith("__LINK__")) {
      const linkData = part.replace("__LINK__", "").replace("__", "");
      const [href, content] = linkData.split("|");
      if (content && content.trim()) {
        const rt = {
          type: "text",
          text: { content: content.trim() },
          annotations: normalizeAnnotations(currentAnnotations),
        };
        if (href) {
          rt.text.link = { url: href };
        }
        richText.push(rt);
      }
    } else if (part) {
      const cleanedText = typeof part === "string" ? part : "";
      if (cleanedText.trim()) {
        richText.push({
          type: "text",
          text: { content: cleanedText },
          annotations: normalizeAnnotations(currentAnnotations),
        });
      }
    }
  }
  return richText;
}


/**
 * Deep clone and normalize a Notion rich_text object.
 * @param {object} rt - Notion rich_text object
 * @returns {object|null} Cloned and normalized rich_text
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
 * Sanitize an array of Notion rich_text objects.
 * @param {Array} items - Array of rich_text objects
 * @returns {Array} Sanitized rich_text array
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

module.exports = {
  convertRichTextBlock,
  cloneRichText,
  sanitizeRichTextArray,
  normalizeAnnotations,
  VALID_RICH_TEXT_COLORS
};
