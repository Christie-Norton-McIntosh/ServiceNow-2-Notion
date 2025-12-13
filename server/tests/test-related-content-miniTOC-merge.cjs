#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Provide minimal globals expected by extractContentFromHtml
global.isValidImageUrl = function(url) { return !!url && url.startsWith('http'); };
global.downloadAndUploadImage = async function(url) { return 'mock-upload-id'; };
global.normalizeUrl = function(url) { return url; };
global.log = console.log;
global.normalizeAnnotations = function(){return {};};
global.getExtraDebug = function(){return false;};

const assert = require('assert');
const { extractContentFromHtml } = require('../services/servicenow.cjs');
(async () => {
  const samplePath = path.join(__dirname, '..', '..', 'sample-Sourcing-items.html');
  const html = fs.readFileSync(samplePath, 'utf8');
  const res = await extractContentFromHtml(html);
  const blocks = res.blocks || [];

  // Find heading 3 'Related Content'
  const headingIndex = blocks.findIndex(b => b.type === 'heading_3' && ((b.heading_3 || {}).rich_text || []).map(rt => rt.text.content).join('').trim().toLowerCase() === 'related content');
  assert(headingIndex >= 0, 'Missing Related Content heading');

  // Ensure that the next blocks are bulleted list items + paragraphs or link description
  const afterHeading = blocks.slice(headingIndex + 1, headingIndex + 20);
  const bulletCount = afterHeading.filter(b => b.type === 'bulleted_list_item').length;
  const paraCount = afterHeading.filter(b => b.type === 'paragraph').length;
  console.log('Bullets after heading:', bulletCount, 'Paragraphs after heading:', paraCount);
  assert(bulletCount >= 1, 'Expected at least one bulleted list item after Related Content heading');
  assert(paraCount >= 1, 'Expected description paragraphs after related list items');

  // Validate we don't see the 'On this page' titles under related content by checking the H2 headings are not part of the bullet items
  const h2Headings = blocks.filter(b => b.type === 'heading_2').map(h => h.heading_2.rich_text.map(rt => rt.text.content).join('').trim());
  const bulletTexts = afterHeading.filter(b => b.type === 'bulleted_list_item').map(b => b.bulleted_list_item.rich_text.map(rt => rt.text.content).join('').trim());
  console.log('H2 headings:', JSON.stringify(h2Headings, null, 2));
  console.log('Bullet texts:', JSON.stringify(bulletTexts, null, 2));
  // Intersection should be empty
  const intersection = h2Headings.filter(h => bulletTexts.includes(h));
  if (intersection.length > 0) {
    console.error('Found H2 headings present in Related Content bullets:', intersection);
    process.exitCode = 1;
    return;
  }

  console.log('✅ test-related-content-miniTOC-merge passed');
})();
