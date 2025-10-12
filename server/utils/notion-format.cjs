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

module.exports = { VALID_RICH_TEXT_COLORS, normalizeAnnotations };
