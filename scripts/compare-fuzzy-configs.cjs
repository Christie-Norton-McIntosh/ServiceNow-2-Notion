#!/usr/bin/env node
// Compare two fuzzy configs (A and B) on many synthetic trials and output compact JSON
const TRIALS = parseInt(process.env.SN2N_COMPARE_TRIALS || '500', 10) || 500;

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length; const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const v0 = new Array(bl + 1).fill(0);
  const v1 = new Array(bl + 1).fill(0);
  for (let j = 0; j <= bl; j++) v0[j] = j;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    const ai = a.charAt(i);
    for (let j = 0; j < bl; j++) {
      const cost = ai === b.charAt(j) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bl; j++) v0[j] = v1[j];
  }
  return v1[bl];
}
function levenshteinRatio(a, b) {
  const d = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - d / maxLen;
}
function tokenOverlap(a, b) {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  const inter = [...sa].filter(x => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size || 1;
  return inter / union;
}
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Config baseline (used for A except threshold)
const BASE = {
  MAX_GROUP: 8,
  LEV_RATIO: 0.88,
  TOKEN_OVERLAP: 0.65
};

// A: threshold-only
const A = {
  ...BASE,
  FUZZY_THRESHOLD: 0.85
};
// B: more permissive
const B = {
  MAX_GROUP: 8,
  LEV_RATIO: 0.86,
  TOKEN_OVERLAP: 0.60,
  FUZZY_THRESHOLD: 0.85
};

function findGroupMatches(missing, extra, opts) {
  const matches = [];
  const MAX_GROUP = opts.MAX_GROUP;
  const LEV_RATIO = opts.LEV_RATIO;
  const TOKEN_OVERLAP = opts.TOKEN_OVERLAP;

  // exact pass (group sizes up to 4 for exact as before)
  for (let i = 0; i < extra.length; i++) {
    const extraSeg = extra[i];
    const extraText = extraSeg.normalized;
    for (let start = 0; start < missing.length; start++) {
      for (let count = 2; count <= Math.min(4, missing.length - start); count++) {
        const group = missing.slice(start, start + count);
        const combinedText = group.map(s => s.normalized).join(' ').replace(/\s+/g, ' ').trim();
        if (combinedText === extraText) {
          matches.push({ type: 'missing_to_extra', extraSegment: extraSeg, missingGroup: group });
          start += count - 1;
          break;
        }
      }
    }
  }
  for (let i = 0; i < missing.length; i++) {
    const missingSeg = missing[i];
    const missingText = missingSeg.normalized;
    for (let start = 0; start < extra.length; start++) {
      for (let count = 2; count <= Math.min(4, extra.length - start); count++) {
        const group = extra.slice(start, start + count);
        const combinedText = group.map(s => s.normalized).join(' ').replace(/\s+/g, ' ').trim();
        if (combinedText === missingText) {
          matches.push({ type: 'extra_to_missing', missingSegment: missingSeg, extraGroup: group });
          start += count - 1;
          break;
        }
      }
    }
  }

  // fuzzy pass
  const matchedExtra = new Set(matches.filter(m => m.extraSegment).map(m => m.extraSegment.normalized));
  const matchedMissing = new Set(matches.flatMap(m => (m.missingGroup || []).map(s => s.normalized)).concat(matches.filter(m => m.missingSegment).map(m => m.missingSegment.normalized)));

  // missing -> extra fuzzy
  for (let i = 0; i < extra.length; i++) {
    const extraSeg = extra[i];
    const extraText = extraSeg.normalized;
    if (matchedExtra.has(extraText)) continue;
    for (let start = 0; start < missing.length; start++) {
      for (let count = 2; count <= Math.min(MAX_GROUP, missing.length - start); count++) {
        const group = missing.slice(start, start + count);
        const combinedText = group.map(s => s.normalized).join(' ').replace(/\s+/g, ' ').trim();
        const lenRatio = combinedText.length / (extraText.length || 1);
        if (lenRatio < 0.75 || lenRatio > 1.25) continue;
        const lev = levenshteinRatio(combinedText, extraText);
        const tok = tokenOverlap(combinedText, extraText);
        if (lev >= LEV_RATIO || tok >= TOKEN_OVERLAP) {
          matches.push({ type: 'fuzzy_missing_to_extra', extraSegment: extraSeg, missingGroup: group, confidence: Math.max(lev, tok) });
          matchedExtra.add(extraText);
          group.forEach(s => matchedMissing.add(s.normalized));
          start += count - 1;
          break;
        }
      }
    }
  }
  // extra -> missing fuzzy
  for (let i = 0; i < missing.length; i++) {
    const missingSeg = missing[i];
    const missingText = missingSeg.normalized;
    if (matchedMissing.has(missingText)) continue;
    for (let start = 0; start < extra.length; start++) {
      for (let count = 2; count <= Math.min(MAX_GROUP, extra.length - start); count++) {
        const group = extra.slice(start, start + count);
        const combinedText = group.map(s => s.normalized).join(' ').replace(/\s+/g, ' ').trim();
        const lenRatio = combinedText.length / (missingText.length || 1);
        if (lenRatio < 0.75 || lenRatio > 1.25) continue;
        const lev = levenshteinRatio(combinedText, missingText);
        const tok = tokenOverlap(combinedText, missingText);
        if (lev >= LEV_RATIO || tok >= TOKEN_OVERLAP) {
          matches.push({ type: 'fuzzy_extra_to_missing', missingSegment: missingSeg, extraGroup: group, confidence: Math.max(lev, tok) });
          matchedMissing.add(missingText);
          group.forEach(s => matchedExtra.add(s.normalized));
          start += count - 1;
          break;
        }
      }
    }
  }

  // single-segment fuzzy
  const remainingMissing = missing.filter(s => s && !matchedMissing.has(s.normalized));
  const remainingExtra = extra.filter(s => s && !matchedExtra.has(s.normalized));
  for (const mSeg of remainingMissing) {
    for (const eSeg of remainingExtra) {
      if (!mSeg || !eSeg) continue;
      const missingText = mSeg.normalized;
      const extraText = eSeg.normalized;
      const lenRatio = missingText.length / (extraText.length || 1);
      if (lenRatio < 0.6 || lenRatio > 1.4) continue;
      const lev = levenshteinRatio(missingText, extraText);
      const tok = tokenOverlap(missingText, extraText);
      if (lev >= LEV_RATIO || tok >= TOKEN_OVERLAP) {
        matches.push({ type: 'fuzzy_single_missing_to_extra', missingSegment: mSeg, extraSegment: eSeg, confidence: Math.max(lev, tok) });
        matchedMissing.add(missingText);
        matchedExtra.add(extraText);
        break;
      }
    }
  }

  return matches;
}

// Synthetic data helpers
const samplePhrases = [
  'The quick brown fox', 'jumps over the lazy dog', 'ServiceNow table conversion', 'Notion block extraction',
  'This is a sample paragraph', 'Figure 1.', 'Click here for details', 'Configuration and setup guide', 'Alpha', 'Beta', 'Gamma',
  'The ITSM solution can help increase your agents productivity', 'ServiceNow AI Platform', 'Automate support for common requests with virtual agents powered by natural language understanding (NLU)'
];
function pick(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(samplePhrases[Math.floor(Math.random() * samplePhrases.length)]);
  return out;
}
function buildMissingGroup(count) {
  const segs = pick(count).map(t => ({ text: t, normalized: normalize(t), length: t.length }));
  return segs;
}
function buildExtraFromMissingGroup(group) {
  let t = group.map(s => s.text).join(' ');
  if (Math.random() < 0.3) t = t.replace(/ /g, ' ');
  if (Math.random() < 0.2) t = t + '.';
  return { text: t, normalized: normalize(t), length: t.length };
}

function runTrials(trials, config) {
  const results = [];
  for (let t = 0; t < trials; t++) {
    const groupSize = 2 + Math.floor(Math.random() * 3); // 2-4
    const missingGroup = buildMissingGroup(groupSize);
    const extra = [buildExtraFromMissingGroup(missingGroup)];
    const missingExtras = pick(2).map(s => ({ text: s, normalized: normalize(s), length: s.length }));
    const extraExtras = pick(2).map(s => ({ text: s, normalized: normalize(s), length: s.length }));
    const missing = [...missingGroup, ...missingExtras];
    const extraAll = [...extra, ...extraExtras];
    const matches = findGroupMatches(missing, extraAll, config);

    // Determine counted matches under the fuzzy threshold
    let fuzzyMatchedChars = 0;
    const countedMatches = [];
    for (const m of matches) {
      let conf = m.confidence || 1.0; // exact matches count as confidence 1
      const counted = (m.type === 'missing_to_extra' || m.type === 'extra_to_missing') || (typeof m.confidence === 'number' && m.confidence >= config.FUZZY_THRESHOLD) || (m.type && m.type.startsWith('fuzzy_single') && (m.confidence || 0) >= config.FUZZY_THRESHOLD);
      if (counted) {
        countedMatches.push(m);
        if (m.missingGroup && Array.isArray(m.missingGroup)) {
          fuzzyMatchedChars += m.missingGroup.reduce((s, seg) => s + (seg.length || 0), 0);
        } else if (m.missingSegment && m.missingSegment.length) {
          fuzzyMatchedChars += m.missingSegment.length;
        }
      }
    }

    // Compute a notional adjusted coverage: assume source total length = sum of missing lengths + some base
    const totalSourceLength = missing.reduce((s, x) => s + (x.length || 0), 0) + 50; // add 50 chars for other content
    const notionTextLength = extraAll.reduce((s, x) => s + (x.length || 0), 0);
    const adjustedNotion = notionTextLength + fuzzyMatchedChars;
    const adjustedCoverage = parseFloat((adjustedNotion / totalSourceLength * 100).toFixed(1));

    results.push({
      missingCount: missing.length,
      extraCount: extraAll.length,
      matchesCount: matches.length,
      matches,
      countedMatchesCount: countedMatches.length,
      fuzzyMatchedChars,
      adjustedCoverage
    });
  }
  return results;
}

// Run both configs
const resultsA = runTrials(TRIALS, A);
const resultsB = runTrials(TRIALS, B);

// Summarize
function summarize(results, configName, config) {
  let totalCases = results.length;
  let totalMatches = results.reduce((s, r) => s + (r.matchesCount || 0), 0);
  let totalCounted = results.reduce((s, r) => s + (r.countedMatchesCount || 0), 0);
  let totalFuzzyChars = results.reduce((s, r) => s + (r.fuzzyMatchedChars || 0), 0);
  let avgAdjusted = results.reduce((s, r) => s + (r.adjustedCoverage || 0), 0) / totalCases;
  return { configName, config, totalCases, totalMatches, totalCounted, totalFuzzyChars, avgAdjustedCoverage: parseFloat(avgAdjusted.toFixed(2)) };
}

const summaryA = summarize(resultsA, 'A_threshold_only', A);
const summaryB = summarize(resultsB, 'B_more_permissive', B);

const out = { TRIALS, A: { config: A, summary: summaryA, sample: resultsA.slice(0,5) }, B: { config: B, summary: summaryB, sample: resultsB.slice(0,5) } };
console.log(JSON.stringify(out, null, 2));
