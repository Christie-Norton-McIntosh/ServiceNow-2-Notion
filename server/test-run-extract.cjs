#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Provide fallback for globals expected by services/servicenow.cjs when it is
// required directly (outside the full proxy environment). In the normal
// runtime, sn2n-proxy.cjs defines and assigns these to global. The lightweight
// extract harness only needs a minimal image URL validator so block creation
// doesn’t throw.
if (!global.isValidImageUrl) {
  global.isValidImageUrl = function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Accept standard http/https + data URIs used by ServiceNow inline images.
    return /^(https?:\/\/|data:image\/)/i.test(url.trim());
  };
}

(async () => {
  try {
    const inputPath = process.argv[2];
    if (!inputPath) {
      console.error('Usage: node server/test-run-extract.cjs <html-file>');
      process.exit(1);
    }
    const resolved = path.isAbsolute(inputPath)
      ? inputPath
      : path.join(process.cwd(), inputPath);
    const exists = fs.existsSync(resolved);
    if (!exists) {
      console.error('File not found:', resolved);
      process.exit(1);
    }

    const html = fs.readFileSync(resolved, 'utf8');
    const { extractContentFromHtml } = require('./services/servicenow.cjs');

    console.log('🧪 Running extractContentFromHtml on', path.relative(process.cwd(), resolved));
    const t0 = Date.now();
    const result = await extractContentFromHtml(html);
    const dt = Date.now() - t0;
    const blocks = result && result.blocks ? result.blocks : [];
    console.log(`🧪 Done in ${dt}ms. Blocks: ${blocks.length}, hasVideos: ${!!result.hasVideos}`);

    // Print a compact summary of first 30 blocks
    const summary = blocks.slice(0, 30).map((b, i) => {
      const type = b && b.type || 'unknown';
      let text = '';
      try {
        if (type === 'paragraph') {
          text = (b.paragraph.rich_text || []).map(rt => rt.text && rt.text.content || '').join('').slice(0, 80);
        } else if (type === 'numbered_list_item') {
          text = (b.numbered_list_item.rich_text || []).map(rt => rt.text && rt.text.content || '').join('').slice(0, 80);
        } else if (type === 'bulleted_list_item') {
          text = (b.bulleted_list_item.rich_text || []).map(rt => rt.text && rt.text.content || '').join('').slice(0, 80);
        } else if (type === 'callout') {
          text = (b.callout.rich_text || []).map(rt => rt.text && rt.text.content || '').join('').slice(0, 80);
        } else if (type === 'heading_3' || type === 'heading_2' || type === 'heading_1') {
          const key = type;
          text = (b[key].rich_text || []).map(rt => rt.text && rt.text.content || '').join('').slice(0, 80);
        }
      } catch (e) {}
      return `${String(i).padStart(3, '0')} ${type}${text ? `: ${text}` : ''}`;
    });
    console.log(summary.join('\n'));

  } catch (e) {
    console.error('❌ Test run failed:', e && e.message || e);
    process.exit(1);
  }
})();
