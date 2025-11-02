#!/usr/bin/env node
/* Proxy smoke test for ServiceNow-2-Notion

Usage:
  node server/tests/proxy-smoke-test.js

This script sends several dry-run requests to the local proxy (/api/W2N) and
verifies expected Notion block structures for key scenarios:
 - callout-with-list
 - duplicate-image-dedup
 - table-with-figure
 - html-entity-decoding
 - rich-text-splitting (simulated long content)

It prints PASS/FAIL for each scenario and exits with code 0 if all pass, else 1.
*/

const axios = require('axios');
const assert = require('assert');

const BASE = process.env.SN2N_PROXY_URL || 'http://localhost:3004/api/W2N';

async function postDryRun(title, html) {
  const payload = {
    title,
    contentHtml: html,
    dryRun: true
  };
  try {
    const res = await axios.post(BASE, payload, { timeout: 120000 });
    return res.data;
  } catch (err) {
    throw new Error(`Request failed: ${err.message}`);
  }
}

function checkCalloutWithList(result) {
  // Expect a callout block whose rich_text contains "Note:" and
  // also expect following bulleted_list_item blocks (marker/orchestrator may attach them but in dryRun
  // they are returned in children array as separate blocks).
  const blocks = result.data.children || result.data.children || result.data;
  // find callout
  const callout = (blocks || []).find(b => b.type === 'callout');
  if (!callout) return false;
  const text = (callout.callout && callout.callout.rich_text || []).map(rt => rt.text && rt.text.content).join(' ');
  if (!/Note:|Note\b/.test(text)) return false;
  // Ensure at least two bulleted_list_item blocks exist after
  const bullets = (blocks || []).filter(b => b.type === 'bulleted_list_item');
  return bullets.length >= 2;
}

function checkDuplicateImageDedup(result) {
  const blocks = result.data.children || result.data.children || result.data;
  // Check that there are not duplicated image blocks (simple heuristic: no two image blocks with same external URL)
  const images = (blocks || []).filter(b => b.type === 'image');
  const urls = images.map(i => i.image && (i.image.external && i.image.external.url) || (i.image && i.image.file_upload && i.image.file_upload.id) || '').filter(Boolean);
  const uniq = new Set(urls);
  return urls.length === uniq.size; // pass if no duplicates
}

function checkTableWithFigure(result) {
  const blocks = result.data.children || result.data.children || result.data;
  // Expect at least one table block and one image block (figure extracted)
  const hasTable = (blocks || []).some(b => b.type === 'table');
  const hasImage = (blocks || []).some(b => b.type === 'image');
  return hasTable && hasImage;
}

function checkHtmlEntityDecoding(result) {
  const blocks = result.data.children || result.data.children || result.data;
  // Ensure no text block contains literal '<div' or '&lt;div'
  const textBlocks = (blocks || []).filter(b => b.type === 'paragraph' || b.type === 'callout');
  for (const b of textBlocks) {
    const txt = (b.paragraph && b.paragraph.rich_text || b.callout && b.callout.rich_text || []).map(rt => rt.text && rt.text.content).join(' ');
    if (txt && (txt.includes('<div') || txt.includes('&lt;div') || txt.includes('&lt;ul')) ) {
      return false;
    }
  }
  return true;
}

function checkRichTextSplitting(result) {
  // Simulated: ensure rich_text arrays are not excessively large (we'll check that no single paragraph has > 120 rich text elements)
  const blocks = result.data.children || result.data.children || result.data;
  for (const b of (blocks || [])) {
    try {
      const rt = b.paragraph && b.paragraph.rich_text || b.callout && b.callout.rich_text || [];
      if (Array.isArray(rt) && rt.length > 120) return false;
    } catch (e) {
      // ignore
    }
  }
  return true;
}

async function runAll() {
  const fixtures = [
    {
      id: 'callout-with-list',
      title: 'Test - callout with list',
      html: `
        <div class="note note_note">
          <span class="note__title">Note:</span>
          It takes one to two months for aggregate monthly data to accurately reflect changes made to KPI conditions. For example, changes made within the month include a combination of data:
          <ul class="ul"><li class="li">Data for the previous condition (up until the date the condition was changed)</li><li class="li">Data for the new condition from that date forward</li></ul>
        </div>
      `,
      check: checkCalloutWithList
    },
    {
      id: 'duplicate-image-dedup',
      title: 'Test - duplicate images',
      html: `
        <p>Figure repeated below</p>
        <figure><img src="https://example.com/image1.png" alt="img"/></figure>
        <p>Some text</p>
        <figure><img src="https://example.com/image1.png" alt="img"/></figure>
      `,
      check: checkDuplicateImageDedup
    },
    {
      id: 'table-with-figure',
      title: 'Test - table with figure',
      html: `
        <table class="table"><tr><td>Col1</td><td>Col2</td></tr><tr><td>v1</td><td><figure><img src="https://example.com/image2.png" alt="chart"/></figure></td></tr></table>
      `,
      check: checkTableWithFigure
    },
    {
      id: 'html-entity-decoding',
      title: 'Test - html entity decoding',
      html: `
        <p>Some text &lt;div class="note"&gt;should not render&lt;/div&gt; but be stripped</p>
      `,
      check: checkHtmlEntityDecoding
    },
    {
      id: 'rich-text-splitting',
      title: 'Test - rich text splitting',
      html: (function(){
        // build long content with many spans to simulate many rich text fragments
        let s = '<p>';
        for (let i=0;i<150;i++) s += `<span>word${i}</span> `;
        s += '</p>';
        return s;
      })(),
      check: checkRichTextSplitting
    }
  ];

  let allPassed = true;
  console.log('Running proxy smoke tests against', BASE);

  for (const f of fixtures) {
    process.stdout.write(`- ${f.id} ... `);
    try {
      const res = await postDryRun(f.title, f.html);
      if (!res || !res.success) throw new Error('No success');
      const ok = f.check(res);
      if (ok) {
        console.log('PASS');
      } else {
        console.log('FAIL');
        allPassed = false;
      }
    } catch (err) {
      console.log('ERROR', err.message);
      allPassed = false;
    }
  }

  if (!allPassed) {
    console.log('\nSome tests failed');
    process.exitCode = 1;
  } else {
    console.log('\nAll tests passed');
    process.exitCode = 0;
  }
}

runAll().catch(err => {
  console.error('Test runner failed:', err && err.message);
  process.exit(2);
});
