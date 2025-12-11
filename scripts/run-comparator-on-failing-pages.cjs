#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const servicenow = require('../server/services/servicenow.cjs');

const dir = path.join(__dirname, '../patch/pages/pages-to-update');
if (!fs.existsSync(dir)) {
  console.error('Pages-to-update dir not found:', dir);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
console.log(`Found ${files.length} HTML files in ${dir}`);

const results = [];
for (const f of files) {
  try {
    const filePath = path.join(dir, f);
    const content = fs.readFileSync(filePath, 'utf8');
    const sidx = content.indexOf('<div');
    const html = sidx > -1 ? content.slice(sidx) : content;
    const res = servicenow.getDetailedTextComparison(html, []);
    const missingCount = Array.isArray(res.missingSegments) ? res.missingSegments.length : 0;
    const extraCount = Array.isArray(res.extraSegments) ? res.extraSegments.length : 0;
    const firstMissing = (res.missingSegments && res.missingSegments[0] && res.missingSegments[0].text) ? res.missingSegments[0].text.replace(/\s+/g,' ').substring(0,200) : '';
    const firstExtra = (res.extraSegments && res.extraSegments[0] && res.extraSegments[0].text) ? res.extraSegments[0].text.replace(/\s+/g,' ').substring(0,200) : '';

    results.push({
      filename: f,
      htmlSegmentCount: res.htmlSegmentCount || 0,
      notionSegmentCount: res.notionSegmentCount || 0,
      missingCount,
      extraCount,
      totalMissingChars: res.totalMissingChars || 0,
      totalExtraChars: res.totalExtraChars || 0,
      firstMissing,
      firstExtra
    });
  } catch (err) {
    console.error('Error processing', f, err && err.message);
    results.push({ filename: f, error: err && err.message });
  }
}

// Write CSV
const csvPath = path.join(__dirname, '../patch/analysis-comparator-results.csv');
const jsonPath = path.join(__dirname, '../patch/analysis-comparator-results.json');

const header = ['filename','htmlSegmentCount','notionSegmentCount','missingCount','extraCount','totalMissingChars','totalExtraChars','firstMissing','firstExtra'];
const lines = [header.join(',')];
for (const r of results) {
  const row = [
    '"' + (r.filename || '').replace(/"/g,'""') + '"',
    r.htmlSegmentCount || 0,
    r.notionSegmentCount || 0,
    r.missingCount || 0,
    r.extraCount || 0,
    r.totalMissingChars || 0,
    r.totalExtraChars || 0,
    '"' + ((r.firstMissing || '').replace(/"/g,'""')) + '"',
    '"' + ((r.firstExtra || '').replace(/"/g,'""')) + '"'
  ].join(',');
  lines.push(row);
}
fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8');
console.log('Wrote', csvPath);
console.log('Wrote', jsonPath);
console.log('Summary: files=', results.length, 'missing total=', results.reduce((s,r)=>s+(r.missingCount||0),0));
process.exit(0);
