#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');

(async () => {
  try {
    const base = process.env.SN2N_PROXY_URL || 'http://localhost:3004/api/W2N';
    const htmlPath = path.join(__dirname, '..', 'tmp', 'Add-or-modify.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const payload = {
      title: 'Risk Conditions - Add or modify (dryRun)',
      contentHtml: html,
      dryRun: true
    };
    console.log('POST', base, 'with', html.length, 'chars');
    const res = await axios.post(base, payload, { timeout: 120000 });
    const data = res.data;
    // Normalize children shape
    const children = data?.data?.children || data?.children || data;
    const blocks = Array.isArray(children) ? children : [];
    console.log('Blocks:', blocks.length);

    // Print compact ordered summary (first 20)
    function rt(b, key) {
      try {
        const arr = b?.[key]?.rich_text || [];
        return arr.map(rt => rt?.text?.content || '').join('');
      } catch { return ''; }
    }
    blocks.slice(0, 20).forEach((b, i) => {
      const type = b?.type || 'unknown';
      let txt = '';
      if (type === 'paragraph') txt = rt(b, 'paragraph');
      else if (type === 'numbered_list_item') txt = rt(b, 'numbered_list_item');
      else if (type === 'bulleted_list_item') txt = rt(b, 'bulleted_list_item');
      else if (type === 'callout') txt = rt(b, 'callout');
      else if (type.startsWith('heading_')) txt = rt(b, type);
      console.log(String(i).padStart(3,'0'), type, txt ? ('- ' + txt.slice(0, 100)) : '');
    });

    // Look for expected ordering around second table and example paragraph
    const idxSecondTable = blocks.findIndex((b, idx) => b.type === 'table' && idx > 0);
    const after = idxSecondTable >= 0 ? blocks.slice(idxSecondTable, idxSecondTable + 4) : [];
    console.log('\nContext around 2nd table (up to 4 blocks):');
    after.forEach((b, i) => {
      const type = b?.type;
      const text = (b?.paragraph?.rich_text || b?.callout?.rich_text || b?.numbered_list_item?.rich_text || [])
        .map(rt => rt?.text?.content || '').join('');
      console.log(`  +${i}:`, type, '-', text.slice(0, 140));
    });

  } catch (e) {
    console.error('DryRun failed:', e?.message || e);
    process.exit(1);
  }
})();
