#!/usr/bin/env node
/* Proxy smoke test for ServiceNow-2-Notion (CommonJS version)

Usage:
  node server/tests/proxy-smoke-test.cjs

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
  const blocks = result.data.children || result.data.children || result.data;
  const callout = (blocks || []).find(b => b.type === 'callout');
  if (!callout) return false;
  const text = (callout.callout && callout.callout.rich_text || []).map(rt => rt.text && rt.text.content).join(' ');
  if (!/Note:|Note\b/.test(text)) return false;
  const bullets = (blocks || []).filter(b => b.type === 'bulleted_list_item');
  return bullets.length >= 2;
}

function checkDuplicateImageDedup(result) {
  const blocks = result.data.children || result.data.children || result.data;
  const images = (blocks || []).filter(b => b.type === 'image');
  // Only enforce dedupe for uploaded file ids (ServiceNow images). External URLs may be duplicated in dryRun.
  const uploadIds = images.map(i => i.image && i.image.file_upload && i.image.file_upload.id).filter(Boolean);
  const uniq = new Set(uploadIds);
  return uploadIds.length === uniq.size; // pass if no duplicate uploaded ids
}

function checkTableWithFigure(result) {
  const blocks = result.data.children || result.data.children || result.data;
  const hasTable = (blocks || []).some(b => b.type === 'table');
  const hasImage = (blocks || []).some(b => b.type === 'image');
  return hasTable && hasImage;
}

function checkHtmlEntityDecoding(result) {
  const blocks = result.data.children || result.data.children || result.data;
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
      title: 'Test - duplicate images (ServiceNow style)',
      html: `
        <p>Figure repeated below</p>
        <figure><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/image1.png?_LANG=enus" alt="img"/></figure>
        <p>Some text</p>
        <figure><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/image1.png?_LANG=enus" alt="img"/></figure>
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
