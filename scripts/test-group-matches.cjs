// Quick test script for findGroupMatches logic
const cheerio = require('cheerio');

function extractHtmlTextSegments(htmlContent) {
  const $ = cheerio.load(htmlContent, { decodeEntities: false });
  const segments = [];
  $('script, style, noscript, svg, iframe, .contentPlaceholder').remove();
  function collectSegments($elem, context = '') {
    $elem.contents().each((_, node) => {
      if (node.type === 'text') {
        const text = $(node).text().trim();
        if (text.length > 0) {
          segments.push({ text, context, length: text.length });
        }
      } else if (node.type === 'tag') {
        const $node = $(node);
        collectSegments($node, context);
      }
    });
  }
  collectSegments($('body').length ? $('body') : $.root());
  return segments;
}

function extractNotionTextSegments(blocks) {
  const segments = [];
  function extractFromBlock(block) {
    const blockType = block.type;
    const data = block[blockType];
    if (!data) return;
    if (Array.isArray(data.rich_text)) {
      const text = data.rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('').trim();
      if (text.length > 0) segments.push({ text, blockType, length: text.length });
    }
  }
  blocks.forEach(extractFromBlock);
  return segments;
}

function normalizeText(text) {
  // Remove diagnostic parenthetical annotations like "(342 chars, div > div > p)"
  const stripped = (text || '').replace(/\(\s*\d+\s*chars\s*,\s*[^)]+\)/gi, '');
  return stripped
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findGroupMatches(missing, extra) {
  const matches = [];
  // Implement same fuzzy-enabled logic as server
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
  const MAX_GROUP = parseInt(process.env.SN2N_GROUP_MAX || process.env.SN2N_MAX_GROUP || '6', 10) || 6;
  const LEV_RATIO = parseFloat(process.env.SN2N_LEV_RATIO || '0.90') || 0.90;
  const TOKEN_OVERLAP = parseFloat(process.env.SN2N_TOKEN_OVERLAP || '0.80') || 0.80;

  // exact pass
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
  // single-segment fuzzy pass (mirror server behavior)
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

// Construct a sample where HTML has two small segments that should combine to match a single Notion block
const sampleHtml = `<div><p>Alpha</p><p>Beta</p><p>Gamma</p></div>`;
const sampleBlocks = [
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Alpha Beta' } }] } },
  { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Gamma' } }] } }
];

const htmlSegs = extractHtmlTextSegments(sampleHtml).map(s => ({ ...s, normalized: normalizeText(s.text) }));
const notionSegs = extractNotionTextSegments(sampleBlocks).map(s => ({ ...s, normalized: normalizeText(s.text) }));

console.log('HTML segs:', JSON.stringify(htmlSegs, null, 2));
console.log('Notion segs:', JSON.stringify(notionSegs, null, 2));

const groupMatches = findGroupMatches(htmlSegs, notionSegs);
console.log('\nGroup matches found:');
console.log(groupMatches);

if (groupMatches.length === 0) process.exit(2);
process.exit(0);
