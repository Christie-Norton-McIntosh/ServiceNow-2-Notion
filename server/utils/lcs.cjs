/**
 * @file LCS coverage with Jaccard shingles fallback for large inputs
 * @module utils/lcs
 * 
 * Provides exact LCS (Longest Common Subsequence) coverage calculation with
 * a Jaccard shingles fallback for very large inputs that would exceed memory.
 * 
 * LCS algorithm: O(n*m) dynamic programming with backtracking
 * Jaccard fallback: Order-insensitive k-word shingles for scalability
 * 
 * References:
 * - LCS DP: https://www.numberanalytics.com/blog/lcs-ultimate-algorithm-guide
 * - Jaccard shingles: https://skeptric.com/shingle-inequality/
 */

/**
 * Calculate LCS coverage with exact missing spans
 * @param {string[]} srcTokens - Source tokens to check coverage for
 * @param {string[]} dstTokens - Destination tokens to compare against
 * @param {Object} opts - Options
 * @param {number} opts.maxCells - Maximum DP table cells (guardrail)
 * @param {number} opts.minMissingSpanTokens - Minimum tokens to report a missing span
 * @returns {Object} Coverage result with method, coverage %, matched mask, spans, and lcsLength
 */
function lcsCoverage(srcTokens, dstTokens, opts = {}) {
  const { maxCells = 50_000_000, minMissingSpanTokens = 40 } = opts;
  const n = srcTokens.length, m = dstTokens.length;
  
  if (n === 0) return { coverage: 1, matchedMask: [], spans: [], lcsLength: 0, method: 'lcs' };
  if (m === 0) return { coverage: 0, matchedMask: Array(n).fill(false), spans: [[0, n]], lcsLength: 0, method: 'lcs' };

  // Check if DP table would exceed memory guardrail
  if ((n + 1) * (m + 1) > maxCells) {
    const { coverage, spans } = jaccardCoverage(srcTokens, dstTokens, { k: 5, minMissingSpanTokens });
    return { coverage, matchedMask: [], spans, lcsLength: Math.round(coverage * n), method: 'jaccard' };
  }

  // DP table: O(n*m) - see references in module documentation
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);

  // Fill DP table
  for (let i = 0; i < n; i++) {
    const si = srcTokens[i];
    for (let j = 0; j < m; j++) {
      dp[i + 1][j + 1] = (si === dstTokens[j]) ? dp[i][j] + 1 : Math.max(dp[i][j + 1], dp[i + 1][j]);
    }
  }

  // Backtrack to find matched tokens
  const matchedMask = new Array(n).fill(false);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (srcTokens[i - 1] === dstTokens[j - 1]) { 
      matchedMask[i - 1] = true; 
      i--; 
      j--; 
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Extract contiguous unmatched spans
  const spans = [];
  for (let k = 0; k < n;) {
    if (!matchedMask[k]) {
      const s = k;
      while (k < n && !matchedMask[k]) k++;
      spans.push([s, k]);
    } else {
      k++;
    }
  }

  const lcsLength = dp[n][m];
  const coverage = lcsLength / n;
  const reportSpans = spans.filter(([s, e]) => (e - s) >= minMissingSpanTokens);
  
  return { coverage, matchedMask, spans: reportSpans, lcsLength, method: 'lcs' };
}

/**
 * Jaccard fallback: order-insensitive k-word shingles
 * @param {string[]} srcTokens - Source tokens
 * @param {string[]} dstTokens - Destination tokens
 * @param {Object} opts - Options
 * @param {number} opts.k - Shingle size (default: 5)
 * @param {number} opts.minMissingSpanTokens - Minimum tokens to report
 * @returns {Object} Coverage and approximate missing spans
 */
function jaccardCoverage(srcTokens, dstTokens, { k = 5, minMissingSpanTokens = 40 } = {}) {
  const srcSh = buildShingles(srcTokens, k);
  const dstSh = buildShingles(dstTokens, k);
  const inter = countIntersection(srcSh, dstSh);
  const coverage = srcSh.size ? (inter / srcSh.size) : 1;
  const matched = markApproxMatches(srcTokens, dstTokens);
  const spans = contiguousUnmatched(matched).filter(([s, e]) => (e - s) >= minMissingSpanTokens);
  return { coverage, spans };
}

/**
 * Build k-word shingles from tokens
 * @param {string[]} tokens - Token array
 * @param {number} k - Shingle size
 * @returns {Set<string>} Set of shingles
 */
function buildShingles(tokens, k) {
  const set = new Set();
  if (tokens.length < k) return set;
  for (let i = 0; i <= tokens.length - k; i++) {
    set.add(tokens.slice(i, i + k).join(' '));
  }
  return set;
}

/**
 * Count intersection of two sets
 * @param {Set} a - First set
 * @param {Set} b - Second set
 * @returns {number} Intersection count
 */
function countIntersection(a, b) {
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  return inter;
}

/**
 * Mark approximate matches using greedy forward matching
 * @param {string[]} srcTokens - Source tokens
 * @param {string[]} dstTokens - Destination tokens
 * @returns {boolean[]} Matched mask
 */
function markApproxMatches(srcTokens, dstTokens) {
  const buckets = new Map();
  for (let i = 0; i < dstTokens.length; i++) {
    const t = dstTokens[i];
    const arr = buckets.get(t);
    if (arr) arr.push(i);
    else buckets.set(t, [i]);
  }
  
  let last = -1;
  const matched = new Array(srcTokens.length).fill(false);
  for (let i = 0; i < srcTokens.length; i++) {
    const cand = buckets.get(srcTokens[i]);
    if (!cand) continue;
    const next = cand.find(idx => idx > last);
    if (next !== undefined) {
      matched[i] = true;
      last = next;
    }
  }
  return matched;
}

/**
 * Extract contiguous unmatched spans
 * @param {boolean[]} mask - Matched mask
 * @returns {Array<[number, number]>} Array of [start, end] spans
 */
function contiguousUnmatched(mask) {
  const spans = [];
  for (let i = 0; i < mask.length;) {
    if (!mask[i]) {
      const s = i;
      while (i < mask.length && !mask[i]) i++;
      spans.push([s, i]);
    } else {
      i++;
    }
  }
  return spans;
}

module.exports = { lcsCoverage };
