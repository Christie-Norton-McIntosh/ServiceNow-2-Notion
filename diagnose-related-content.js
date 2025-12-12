#!/usr/bin/env node

/**
 * Diagnostic script to help debug Related Content extraction issues
 * Run this in the browser console on a ServiceNow page to see what's happening
 */

console.log('🔍 ServiceNow-2-Notion Related Content Diagnostic Tool');
console.log('==================================================');

// Check for contentPlaceholder elements
const placeholders = document.querySelectorAll('.contentPlaceholder');
console.log(`📊 Found ${placeholders.length} contentPlaceholder elements`);

placeholders.forEach((p, idx) => {
  console.log(`\n🔍 ContentPlaceholder #${idx + 1}:`);
  console.log(`   - Classes: ${p.className}`);
  console.log(`   - Style display: ${p.style.display}`);
  console.log(`   - Inner HTML length: ${p.innerHTML.length}`);

  // Check for headings
  const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');
  console.log(`   - Headings found: ${headings.length}`);

  headings.forEach((h, hidx) => {
    const text = h.textContent.trim();
    const tag = h.tagName.toLowerCase();
    console.log(`     ${hidx + 1}. ${tag.toUpperCase()}: "${text}"`);

    if (text.toLowerCase().includes('related content')) {
      console.log(`     ✅ RELATED CONTENT FOUND!`);
    }
  });

  // Check for links
  const links = p.querySelectorAll('a');
  console.log(`   - Links found: ${links.length}`);

  if (links.length > 0) {
    links.forEach((link, lidx) => {
      const href = link.getAttribute('href');
      const text = link.textContent.trim();
      console.log(`     ${lidx + 1}. "${text}" → ${href}`);
    });
  }

  // Check for Mini TOC indicators
  const hasMiniTocButton = p.querySelector('.zDocsMiniTocCollapseButton') !== null;
  const hasMiniTocText = p.innerHTML.toLowerCase().includes('mini toc');
  const hasOnThisPage = Array.from(headings).some(h => h.textContent.trim().toLowerCase() === 'on this page');

  console.log(`   - Mini TOC indicators:`);
  console.log(`     • Has Mini TOC button: ${hasMiniTocButton}`);
  console.log(`     • Has Mini TOC text: ${hasMiniTocText}`);
  console.log(`     • Has "On this page" heading: ${hasOnThisPage}`);
});

// Check for Related Content in other locations
console.log('\n🔍 Checking other potential Related Content locations...');

// Check in zDocsTopicPageBody
const zDocsBody = document.querySelector('.zDocsTopicPageBody');
if (zDocsBody) {
  const bodyPlaceholders = zDocsBody.querySelectorAll('.contentPlaceholder');
  console.log(`📍 zDocsTopicPageBody contains ${bodyPlaceholders.length} contentPlaceholder elements`);
}

// Check for any element containing "Related Content"
const relatedElements = Array.from(document.querySelectorAll('*')).filter(el =>
  el.textContent && el.textContent.toLowerCase().includes('related content')
);

console.log(`📍 Found ${relatedElements.length} elements containing "Related Content" text:`);
relatedElements.forEach((el, idx) => {
  const text = el.textContent.trim();
  console.log(`   ${idx + 1}. ${el.tagName}.${el.className}: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
});

// Summary
console.log('\n📋 SUMMARY:');
console.log(`   - Total contentPlaceholder elements: ${placeholders.length}`);
const relatedPlaceholders = Array.from(placeholders).filter(p => {
  const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');
  return Array.from(headings).some(h => h.textContent.trim().toLowerCase() === 'related content');
});
console.log(`   - Related Content placeholders: ${relatedPlaceholders.length}`);
console.log(`   - Elements with "Related Content" text: ${relatedElements.length}`);

if (relatedPlaceholders.length === 0) {
  console.log('\n❌ NO RELATED CONTENT PLACEHOLDERS FOUND!');
  console.log('💡 This could mean:');
  console.log('   1. Related Content hasn\'t loaded yet (try waiting a few seconds)');
  console.log('   2. The page doesn\'t have Related Content');
  console.log('   3. The HTML structure is different from expected');
  console.log('   4. Related Content is loaded via JavaScript and not yet available');
} else {
  console.log('\n✅ Related Content placeholders found - extraction should work!');
}

console.log('\n🔧 To extract HTML for testing, run this in console:');
console.log('copy(document.querySelector(\'.zDocsTopicPageBody\')?.outerHTML || document.body.outerHTML)');