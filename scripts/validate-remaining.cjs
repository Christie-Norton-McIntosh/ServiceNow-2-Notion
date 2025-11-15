#!/usr/bin/env node
/* Validate remaining pages in pages-to-update via dryRun and summarize errors */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'patch', 'pages-to-update');
const LOG_DIR = path.join(SRC_DIR, 'log');
const OUT_PATH = path.join(LOG_DIR, 'remaining-validation-summary.json');

function postJson(url, data, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const { hostname, port, pathname } = new URL(url);
    const body = JSON.stringify(data);
    const req = http.request({ hostname, port, path: pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs }, res => {
      let chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        try {
          const json = JSON.parse(text);
          resolve({ status: res.statusCode, json });
        } catch (e) {
          resolve({ status: res.statusCode, text });
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter(f => f.endsWith('.html'));
  const results = [];
  for (const f of files) {
    const full = path.join(SRC_DIR, f);
    const html = fs.readFileSync(full, 'utf8');
    let res;
    try {
      res = await postJson('http://localhost:3004/api/W2N', {
        title: 'test',
        databaseId: '178f8dc43e2780d09be1c568a04d7bf3',
        content: html,
        url: 'https://test.com',
        dryRun: true,
      }, 60000);
    } catch (e) {
      results.push({ file: f, error: String(e) });
      continue;
    }
    if (res.json) {
      const vr = res.json.validationResult || {};
      results.push({
        file: f,
        status: res.status,
        hasErrors: !!vr.hasErrors,
        errorCount: Array.isArray(vr.errors) ? vr.errors.length : 0,
        firstError: Array.isArray(vr.errors) && vr.errors[0] ? vr.errors[0] : null,
      });
    } else {
      results.push({ file: f, status: res.status, text: (res.text || '').slice(0, 500) });
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  const failing = results.filter(r => r.hasErrors);
  console.log(`Failing: ${failing.length}`);
  for (const r of failing) {
    console.log(`- ${r.file}: ${r.firstError ? r.firstError.message : 'Unknown error'}`);
  }
})();
