/**
 * @file Text canonicalization utilities for completeness comparison
 * @module utils/canonicalize
 * 
 * Provides consistent text normalization for comparing ServiceNow HTML content
 * with Notion page content. Handles Unicode normalization, punctuation mapping,
 * and whitespace normalization.
 * 
 * Canonicalization spec: canon-v1.4
 */

/**
 * Canonicalize text for comparison
 * @param {string} input - Raw text input
 * @param {Object} options - Canonicalization options
 * @param {boolean} options.lower - Convert to lowercase (default: true)
 * @returns {string} Canonicalized text
 */
function canonicalizeText(input, { lower = true } = {}) {
  let s = (input || '').normalize('NFKC');       // Unicode normalization
  s = s.replace(/\u00A0/g, ' ');                 // nbsp -> space
  
  // Punctuation normalization
  s = s.replace(/[""]/g, '"')
       .replace(/['']/g, "'")
       .replace(/—|–/g, '-')
       .replace(/…/g, '...')
       .replace(/[(){}\[\];:•·]/g, '');
  
  // Whitespace normalization
  s = s.replace(/\s+/g, ' ').trim();
  
  return lower ? s.toLowerCase() : s;
}

/**
 * Tokenize text into words
 * @param {string} s - Text to tokenize
 * @returns {string[]} Array of word tokens
 */
function tokenizeWords(s) {
  return (s || '').split(/\s+/).filter(Boolean);
}

module.exports = { canonicalizeText, tokenizeWords };
