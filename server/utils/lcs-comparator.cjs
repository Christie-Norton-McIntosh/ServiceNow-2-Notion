/**
 * Token-Level Presence Comparator
 * 
 * Implements the canonical text pipeline with:
 * - Full canonicalization (Unicode NFKC, whitespace, punctuation, case folding)
 * - Token-level presence comparison (order-insensitive coverage)
 * - Jaccard/shingle fallback for large inputs
 * - Missing span detection
 * 
 * @author Copilot (2025-12-10)
 * @version 1.0.0
 */

/**
 * Full canonicalization following the specification:
 * - Unicode NFKC normalization (folds compatibility chars & smart punctuation)
 * - HTML entity decoding (done upstream by Cheerio)
 * - Whitespace collapse (multiple spaces → single space)
 * - Punctuation normalization (quotes, dashes, ellipsis)
 * - Case folding (lowercase)
 */
function canonicalizeText(text, { lowerCase = true } = {}) {
  if (!text || typeof text !== 'string') return '';

  let s = text;

  // 1. Unicode normalization (NFKC folds compatibility chars)
  s = s.normalize('NFKC');

  // 2. Punctuation normalization & removal
  s = s
    .replace(/[""]/g, '')             // smart quotes → remove
    .replace(/['']/g, '')             // smart single quotes → remove
    .replace(/—|–/g, ' ')             // em dash, en dash → space
    .replace(/…/g, '...')             // ellipsis → three dots
    .replace(/[•·]/g, ' ')            // bullets → space
    .replace(/[.,!?;:\-_(){}[\]"']/g, '') // remove all other common punctuation

  // 3. Whitespace normalization
  s = s.replace(/\u00A0/g, ' ')      // non-breaking space → space
    .replace(/\s+/g, ' ')             // collapse whitespace
    .trim();

  // 4. Case folding
  return lowerCase ? s.toLowerCase() : s;
}

/**
 * Tokenize text into words (whitespace-separated)
 */
function tokenizeWords(text) {
  return (text || '')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Compute token presence coverage (order-insensitive)
 * 
 * Checks how many of the source tokens appear *anywhere* in the destination tokens.
 * Much more lenient than LCS for reordered or lightly edited content.
 * 
 * @param {string[]} srcTokens - Source tokens (HTML)
 * @param {string[]} dstTokens - Destination tokens (Notion)
 * @param {object} opts - Options
 * @param {number} opts.minMissingSpanTokens - Min tokens to report missing span (default: 40)
 * @returns {object} { coverage, spans, method }
 */
function tokenPresenceCoverage(srcTokens, dstTokens, opts = {}) {
  const { minMissingSpanTokens = 40 } = opts;

  if (srcTokens.length === 0) {
    return { coverage: 1, spans: [], method: 'presence' };
  }
  if (dstTokens.length === 0) {
    return { 
      coverage: 0, 
      spans: srcTokens.length > 0 ? [[0, srcTokens.length]] : [],
      method: 'presence'
    };
  }

  // Create a set of destination tokens for O(1) lookup
  const dstSet = new Set(dstTokens);

  // Track which source tokens are matched
  const matched = srcTokens.map(token => dstSet.has(token));

  // Count matched tokens
  const matchedCount = matched.filter(m => m).length;
  const coverage = matchedCount / srcTokens.length;

  // Find contiguous spans of unmatched tokens
  const spans = [];
  let inSpan = false;
  let spanStart = 0;

  for (let i = 0; i < matched.length; i++) {
    if (!matched[i]) {
      if (!inSpan) {
        inSpan = true;
        spanStart = i;
      }
    } else {
      if (inSpan) {
        const spanLength = i - spanStart;
        if (spanLength >= minMissingSpanTokens) {
          spans.push([spanStart, i]);
        }
        inSpan = false;
      }
    }
  }

  // Handle trailing unmatch span
  if (inSpan) {
    const spanLength = matched.length - spanStart;
    if (spanLength >= minMissingSpanTokens) {
      spans.push([spanStart, matched.length]);
    }
  }

  return { coverage: Number(coverage.toFixed(6)), spans, method: 'presence' };
}

/**
 * Compute Jaccard similarity using k-word shingles
 * Used as fallback when token lists are very large
 * 
 * @param {string[]} srcTokens - Source tokens
 * @param {string[]} dstTokens - Destination tokens
 * @param {object} opts - Options
 * @param {number} opts.k - Shingle size (default: 5)
 * @returns {object} { coverage, spans, method }
 */
function jaccardCoverage(srcTokens, dstTokens, opts = {}) {
  const { k = 5 } = opts;

  const srcShingles = buildShingles(srcTokens, k);
  const dstShingles = buildShingles(dstTokens, k);

  // Jaccard: |intersection| / |union|
  const intersection = new Set([...srcShingles].filter(s => dstShingles.has(s)));
  const union = new Set([...srcShingles, ...dstShingles]);

  const coverage = union.size > 0 ? intersection.size / union.size : 0;

  // For Jaccard, we can't precisely identify missing spans, so return empty
  return { coverage: Number(coverage.toFixed(6)), spans: [], method: 'jaccard' };
}

/**
 * Build k-word shingles from tokens
 * @param {string[]} tokens 
 * @param {number} k 
 * @returns {Set<string>}
 */
function buildShingles(tokens, k) {
  const shingles = new Set();
  for (let i = 0; i <= tokens.length - k; i++) {
    const shingle = tokens.slice(i, i + k).join(' ');
    shingles.add(shingle);
  }
  return shingles;
}

/**
 * Compare two text bodies (HTML and Notion) using the full pipeline
 * 
 * @param {string} htmlText - Extracted HTML text (already filtered)
 * @param {string} notionText - Extracted Notion text (already joined)
 * @param {object} opts - Options
 * @returns {object} Comparison result
 */
function compareTexts(htmlText, notionText, opts = {}) {
  const {
    minMissingSpanTokens = 40,
    maxCells = 50000000,
  } = opts;

  // Canonicalize both texts identically
  const canonHtml = canonicalizeText(htmlText);
  const canonNotion = canonicalizeText(notionText);

  const htmlTokens = tokenizeWords(canonHtml);
  const notionTokens = tokenizeWords(canonNotion);

  // For very large inputs, use Jaccard shingles instead of token presence
  if ((htmlTokens.length * notionTokens.length) > maxCells) {
    console.log(`[TOKEN-PRESENCE-FALLBACK] Input too large (${htmlTokens.length}x${notionTokens.length}). Using Jaccard shingles.`);
    const result = jaccardCoverage(htmlTokens, notionTokens, { k: 5 });
    return {
      coverage: result.coverage,
      lcsLength: Math.round(result.coverage * htmlTokens.length),
      srcTokenCount: htmlTokens.length,
      dstTokenCount: notionTokens.length,
      missingSpans: [],
      method: result.method,
    };
  }

  // Simple token presence comparison (order-insensitive)
  const { coverage, spans } = tokenPresenceCoverage(htmlTokens, notionTokens, {
    minMissingSpanTokens
  });

  return {
    coverage,
    lcsLength: Math.round(coverage * htmlTokens.length),
    srcTokenCount: htmlTokens.length,
    dstTokenCount: notionTokens.length,
    missingSpans: spans.map(([s, e]) => ({
      startIdx: s,
      endIdx: e,
      snippet: htmlTokens.slice(Math.max(0, s - 10), Math.min(htmlTokens.length, e + 10)).join(' ').slice(0, 240),
    })),
    method: 'presence',
  };
}

module.exports = {
  canonicalizeText,
  tokenizeWords,
  tokenPresenceCoverage,
  jaccardCoverage,
  buildShingles,
  compareTexts,
};
