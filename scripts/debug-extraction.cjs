#!/usr/bin/env node

/**
 * Debug HTML extraction from patch/pages/pages-to-update files
 * Directly tests the servicenow.cjs extraction logic with verbose diagnostics
 */

const fs = require('fs');
const path = require('path');
const cheerio = require(path.join(__dirname, '..', 'server', 'node_modules', 'cheerio'));

// Test file
const testFile = process.argv[2] || 'computer-cmdb-ci-computer-class-2025-11-13T14-32-36.html';
const htmlPath = path.join(__dirname, '..', 'patch', 'pages', 'pages-to-update', testFile);

console.log(`\n🔍 Debug Extraction for: ${testFile}\n`);

// Read HTML
const html = fs.readFileSync(htmlPath, 'utf8');
console.log(`📄 HTML size: ${html.length} bytes`);

// Load with cheerio
const $ = cheerio.load(html);

// Diagnostic checks
console.log(`\n📊 Structure Analysis:`);
console.log(`- .zDocsTopicPageBody elements: ${$('.zDocsTopicPageBody').length}`);
console.log(`- article elements: ${$('article').length}`);
console.log(`- section elements: ${$('section').length}`);
console.log(`- article.dita elements: ${$('article.dita').length}`);
console.log(`- .body.conbody elements: ${$('.body.conbody').length}`);

// Check what the extraction logic would find
console.log(`\n🎯 Extraction Selector Tests:`);

// Test 1: contentPlaceholder
const contentPlaceholders = $('.zDocsTopicPageBody .contentPlaceholder').toArray();
console.log(`\n1. contentPlaceholder elements: ${contentPlaceholders.length}`);

// Test 2: Nested articles
const topLevelChildren = $('.zDocsTopicPageBody').children().toArray();
console.log(`\n2. .zDocsTopicPageBody direct children: ${topLevelChildren.length}`);
topLevelChildren.forEach((child, idx) => {
  const $child = $(child);
  console.log(`   [${idx}] <${child.name} class="${$child.attr('class') || 'none'}" id="${$child.attr('id') || 'none'}">`);
});

// Test 3: Sections
const allSectionsInPage = $('section').toArray();
const allSectionsInBody = $('.zDocsTopicPageBody section').toArray();
console.log(`\n3. Sections:`);
console.log(`   - Total in page: ${allSectionsInPage.length}`);
console.log(`   - Inside .zDocsTopicPageBody: ${allSectionsInBody.length}`);

// Check if sections are outside .zDocsTopicPageBody
const sectionsOutsideBody = allSectionsInPage.filter(s => {
  return $(s).closest('.zDocsTopicPageBody').length === 0;
});
console.log(`   - Outside .zDocsTopicPageBody: ${sectionsOutsideBody.length}`);

if (allSectionsInBody.length > 0) {
  console.log(`\n   First 5 sections in body:`);
  allSectionsInBody.slice(0, 5).forEach((section, idx) => {
    const $section = $(section);
    const id = $section.attr('id') || 'no-id';
    const heading = $section.find('h1, h2, h3, h4').first().text().trim().slice(0, 50);
    const childCount = $section.children().length;
    console.log(`   [${idx}] #${id} - "${heading}" (${childCount} children)`);
  });
}

// Test 4: Check for body tag
const bodyElements = $('body');
console.log(`\n4. <body> elements: ${bodyElements.length}`);

// Test 5: Check for article.dita, .refbody, main, role="main"
const ditaArticle = $('article.dita, .refbody').first();
const fallbackContent = $('.dita, .refbody, article, main, [role="main"]').first();
console.log(`\n5. Content container selectors:`);
console.log(`   - article.dita or .refbody: ${ditaArticle.length}`);
console.log(`   - .dita, .refbody, article, main, [role="main"]: ${fallbackContent.length}`);

if (ditaArticle.length > 0) {
  const children = ditaArticle.find('> *').toArray();
  console.log(`\n   article.dita direct children: ${children.length}`);
  children.slice(0, 10).forEach((child, idx) => {
    const $child = $(child);
    console.log(`   [${idx}] <${child.name} class="${$child.attr('class') || 'none'}">`);
  });
}

// Test 6: Root elements (if none of the above match)
const rootElements = $.root().find('> *').toArray().filter(el => el.type === 'tag');
console.log(`\n6. Root elements (if no other selector): ${rootElements.length}`);

// Determine which branch would be taken
console.log(`\n🚦 Extraction Branch Decision:`);
if (contentPlaceholders.length > 0) {
  console.log(`✅ Would use: contentPlaceholder branch (${contentPlaceholders.length} elements)`);
} else if (topLevelChildren.length > 0 && topLevelChildren.some(c => c.name === 'article')) {
  console.log(`✅ Would use: .zDocsTopicPageBody direct children (${topLevelChildren.length} elements)`);
} else if ($('body').length > 0) {
  console.log(`✅ Would use: <body> branch`);
} else if ($('.dita, .refbody, article, main, [role="main"]').length > 0) {
  console.log(`✅ Would use: content wrapper branch (article.dita, etc.)`);
  if (ditaArticle.length > 0) {
    console.log(`   → Specifically: article.dita or .refbody`);
  } else {
    console.log(`   → Specifically: fallback selector`);
  }
} else {
  console.log(`✅ Would use: root elements branch`);
}

// Show actual content structure
console.log(`\n📦 Actual Content Structure (from article.dita):`);
if (ditaArticle.length > 0) {
  const bodyConbody = ditaArticle.find('.body.conbody').first();
  if (bodyConbody.length > 0) {
    console.log(`\n   Found .body.conbody with ${bodyConbody.children().length} children`);
    const children = bodyConbody.children().toArray();
    children.slice(0, 15).forEach((child, idx) => {
      const $child = $(child);
      const tag = child.name;
      const id = $child.attr('id') || '';
      const cls = $child.attr('class') || '';
      
      if (tag === 'section') {
        const heading = $child.find('h1, h2, h3, h4').first().text().trim().slice(0, 40);
        console.log(`   [${idx}] <${tag} id="${id}"> - "${heading}"`);
      } else if (tag === 'p' && $child.hasClass('shortdesc')) {
        const text = $child.text().trim().slice(0, 60);
        console.log(`   [${idx}] <${tag} class="shortdesc"> - "${text}..."`);
      } else {
        console.log(`   [${idx}] <${tag} id="${id}" class="${cls}">`);
      }
    });
  }
}

console.log(`\n✅ Analysis complete\n`);
