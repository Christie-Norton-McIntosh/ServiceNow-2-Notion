#!/usr/bin/env node
// scripts/headless-extract.cjs
// Usage: node scripts/headless-extract.cjs <url>

const url = process.argv[2] || 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/procurement/task/t_ActivateProcurement.html';
const target = process.env.SN2N_PROXY_URL || 'http://localhost:3004/api/W2N';
// Use a safe dummy pageId for PATCH dry-run. The server validates a 32-char UUID (hyphens allowed).
const pageId = process.argv[3] || '00000000-0000-0000-0000-000000000000';

(async () => {
  try {
    const puppeteer = require('puppeteer');
    console.log('Launching headless browser...');
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60000);
    console.log('Navigating to', url);
    await page.goto(url, { waitUntil: 'networkidle2' });
  // give client JS a small extra pause to populate dynamic sections (use networkidle2 above)
  // some puppeteer versions may not have waitForTimeout; rely on networkidle2

    // Try to grab contentPlaceholder or the topic body
    const content = await page.evaluate(() => {
      const sel = document.querySelector('.zDocsTopicPageBody');
      if (sel) return sel.outerHTML;
      return document.documentElement.outerHTML;
    });

    await browser.close();
    console.log('Rendered HTML length:', content.length);

    // PATCH to local proxy dryRun endpoint (server requires dryRun on PATCH, not POST)
    const payload = {
      title: 'headless-extract-dryrun',
      contentHtml: content,
      dryRun: true
    };

    const patchUrl = `${target}/${pageId}`;
    console.log('Patching rendered HTML to', patchUrl, 'with dryRun=true');

    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    console.log('Server response status:', resp.status);
    console.log('Server response (truncated):');
    const pretty = JSON.stringify(data, null, 2);
    console.log(pretty.substring(0, 2000));

    // Print extracted children titles/types summary if present
    if (data && data.children) {
      console.log('\nConverted blocks (type -> preview):');
      data.children.forEach((b, i) => {
        const t = b.type || b.object || 'unknown';
        let preview = '';
        try {
          if (b.paragraph && b.paragraph.rich_text && b.paragraph.rich_text[0]) preview = b.paragraph.rich_text.map(r=>r.text?.content||'').join(' ').slice(0,120);
          if (b.bulleted_list_item && b.bulleted_list_item.rich_text) preview = b.bulleted_list_item.rich_text.map(r=>r.text?.content||'').join(' ').slice(0,120);
          if (b.callout && b.callout.rich_text) preview = b.callout.rich_text.map(r=>r.text?.content||'').join(' ').slice(0,120);
        } catch (e){}
        console.log(i+1, t, '->', preview);
      });
    }

  } catch (e) {
    console.error('Error in headless-extract:', e);
    process.exit(2);
  }
})();
