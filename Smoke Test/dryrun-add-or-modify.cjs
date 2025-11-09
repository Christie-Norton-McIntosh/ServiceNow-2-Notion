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
      console.log('\nContext around 2nd table (top-level - should be EMPTY if reassignment worked):');
      if (after.length > 0) {
        console.log('  ⚠️  FOUND TOP-LEVEL TABLE at index', idxSecondTable, '- reassignment did not work!');
        after.forEach((b, i) => {
          const type = b?.type;
          const text = (b?.paragraph?.rich_text || b?.callout?.rich_text || b?.numbered_list_item?.rich_text || [])
            .map(rt => rt?.text?.content || '').join('');
          console.log(`  +${i}:`, type, '-', text.slice(0, 140));
        });
      } else {
        console.log('  ✅ No top-level table found after block 009 - reassignment succeeded!');
      }

      // Check block 010 (should be "Specify the rule..." list item with table as child)
      const block010 = blocks[10];
      if (block010) {
        console.log('\nBlock 010 structure:');
        console.log('  Type:', block010.type);
        const text010 = rt(block010, 'numbered_list_item');
        console.log('  Text:', text010.slice(0, 100));
        const children = block010?.numbered_list_item?.children || [];
        console.log('  Children count:', children.length);
        if (children.length > 0) {
          console.log('  Children:');
          children.forEach((child, i) => {
            const childType = child?.type || 'unknown';
            const childText = (child?.paragraph?.rich_text || child?.table?.table_width || '')
              .toString().slice(0, 80);
            console.log(`    [${i}] ${childType}${childText ? ' - ' + childText : ''}`);
          });
        }
      }

  } catch (e) {
    console.error('DryRun failed:', e?.message || e);
    process.exit(1);
  }
})();
