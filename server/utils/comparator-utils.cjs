/**
 * @file Utility functions for text completeness comparator
 * @module utils/comparator-utils
 */

/**
 * Convert a span [start, end] to canonical text
 * @param {string[]} tokens - Token array
 * @param {Array<number>} span - [start, end] indices
 * @returns {string} Canonical text for the span
 */
function spanToCanonicalText(tokens, span) {
  const [s, e] = span;
  return tokens.slice(s, e).join(' ');
}

module.exports = { spanToCanonicalText };
