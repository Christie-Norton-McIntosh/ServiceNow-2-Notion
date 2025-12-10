const fs = require('fs');
const axios = require('axios');

(async () => {
  try {
    const html = fs.readFileSync('patch/pages/pages-to-update/view-ibm-pvu-mappings-for-the-legacy-ibm-pvu-process-pack-failure-2025-12-09T07-43-16.html','utf8');
    const url = 'http://localhost:3004/api/W2N/2c4a89fe-dba5-8133-9d04-ddd550d55bdc';
    console.log('Posting to', url);
    const r = await axios.patch(url, { title: 'DRYRUN', contentHtml: html, dryRun: true }, { timeout: 120000 });
    const data = r.data.data || r.data;
    const children = data.children || [];

    function findImages(blocks, path) {
      let imgs = [];
      for (const [i, b] of blocks.entries()) {
        const p = `${path}/${i}:${b.type}`;
        if (b.type === 'image') {
          imgs.push({ path: p, src: b._sn2n_sourceUrl || (b.image && b.image.external && b.image.external.url) || (b.image && b.image.file_upload && b.image.file_upload.id) || null });
        }
        for (const key of Object.keys(b)) {
          if (Array.isArray(b[key])) imgs = imgs.concat(findImages(b[key], p + `.${key}`));
        }
      }
      return imgs;
    }

    const imgs = findImages(children, 'root');
    console.log('\n=== SUMMARY ===');
    console.log('blocksExtracted:', data.blocksExtracted || children.length);
    console.log('top-level types:', children.map((c,i)=>`${i}:${c.type}`).join(', '));
    console.log('images found count by audit:', data.audit && data.audit.contentAnalysis && data.audit.contentAnalysis.imageCount);
    console.log('images found in returned children:', imgs.length);
    console.log(JSON.stringify(imgs, null, 2));
  } catch (e) {
    console.error('ERR', e.response ? (e.response.data || e.response.status) : e.message);
  }
})();
