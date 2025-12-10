#!/usr/bin/env node
// Telemetry sweep for group matching and single-segment token-overlap behavior
// Generates synthetic cases and measures detection rates and confidence distribution

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

const MAX_GROUP = parseInt(process.env.SN2N_GROUP_MAX || '6', 10) || 6;
const LEV_RATIO = parseFloat(process.env.SN2N_LEV_RATIO || '0.90') || 0.90;
const TOKEN_OVERLAP = parseFloat(process.env.SN2N_TOKEN_OVERLAP || '0.80') || 0.80;

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findGroupMatches(missing, extra) {
  const matches = [];
  // exact consecutive groups
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
  // fuzzy groups
  const matchedExtra = new Set(matches.filter(m => m.extraSegment).map(m => m.extraSegment.normalized));
  const matchedMissing = new Set(matches.flatMap(m => (m.missingGroup || []).map(s => s.normalized)).concat(matches.filter(m => m.missingSegment).map(m => m.missingSegment.normalized)));
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

// Synthetic generator helpers
const samplePhrases = [
  'The quick brown fox', 'jumps over the lazy dog', 'ServiceNow table conversion', 'Notion block extraction',
  'This is a sample paragraph', 'Figure 1.', 'Click here for details', 'Configuration and setup guide', 'Alpha', 'Beta', 'Gamma'
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
  // combine with a space, sometimes add small punctuation/noise
  let t = group.map(s => s.text).join(' ');
  if (Math.random() < 0.3) t = t.replace(/ /g, ' ');
  if (Math.random() < 0.2) t = t + '.';
  return { text: t, normalized: normalize(t), length: t.length };
}

// Run trials
const TRIALS = parseInt(process.env.SN2N_TELEMETRY_TRIALS || '500', 10) || 500;
let totalCases = 0;
let detected = 0;
const confidences = [];
for (let t = 0; t < TRIALS; t++) {
  // randomly choose group size 2-4
  const groupSize = 2 + Math.floor(Math.random() * 3);
  const missingGroup = buildMissingGroup(groupSize);
  const extra = [buildExtraFromMissingGroup(missingGroup)];
  // add some extra unrelated segments
  const missingExtras = pick(2).map(s => ({ text: s, normalized: normalize(s), length: s.length }));
  const extraExtras = pick(2).map(s => ({ text: s, normalized: normalize(s), length: s.length }));
  const missing = [...missingGroup, ...missingExtras];
  const extraAll = [...extra, ...extraExtras];

  const matches = findGroupMatches(missing, extraAll);
  totalCases++;
  if (matches && matches.length > 0) {
    // consider detected if any missing_to_extra or fuzzy_single or fuzzy_missing_to_extra found
    const found = matches.some(m => m.type === 'missing_to_extra' || m.type === 'fuzzy_missing_to_extra' || m.type === 'fuzzy_single_missing_to_extra');
    if (found) {
      detected++;
      matches.forEach(m => { if (m.confidence) confidences.push(m.confidence); });
    }
  }
}

console.log(`Telemetry trials: ${TRIALS}`);
console.log(`Detected matches: ${detected} / ${totalCases} (${((detected/totalCases)*100).toFixed(1)}%)`);
if (confidences.length > 0) {
  const avg = confidences.reduce((s,x) => s+x,0)/confidences.length;
  console.log(`Confidence samples: count=${confidences.length}, avg=${avg.toFixed(3)}, min=${Math.min(...confidences).toFixed(3)}, max=${Math.max(...confidences).toFixed(3)}`);
} else {
  console.log('No fuzzy confidences recorded in this run');
}

console.log(`Config: MAX_GROUP=${MAX_GROUP}, LEV_RATIO=${LEV_RATIO}, TOKEN_OVERLAP=${TOKEN_OVERLAP}`);
