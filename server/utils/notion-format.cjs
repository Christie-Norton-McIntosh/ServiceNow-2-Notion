/**
 * Notion formatting helpers extracted from monolith.
 * Keep exports compatible with existing consumers.
 */

/** @type {Set<string>} */
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
 * Normalize a Notion annotations object, ensuring default values and
 * whitelisted colors to avoid API errors.
 * @param {any} annotations
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
 * Cleans HTML text by removing tags and decoding entities
 * @param {string} html - HTML string to clean
 * @returns {string} Clean text
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

module.exports = { VALID_RICH_TEXT_COLORS, normalizeAnnotations, cleanHtmlText };
