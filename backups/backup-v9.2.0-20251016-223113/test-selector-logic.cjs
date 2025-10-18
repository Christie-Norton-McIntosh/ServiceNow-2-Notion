#!/usr/bin/env node

const cheerio = require('./server/node_modules/cheerio');
const fs = require('fs');
const path = require('path');

// Read the test HTML
const html = fs.readFileSync(path.join(__dirname, 'test-related-content.html'), 'utf8');

// Load with cheerio
const $ = cheerio.load(html);

console.log('\n=== Test: Selector Detection ===');
console.log('Has .zDocsTopicPageBody?', $('.zDocsTopicPageBody').length > 0);
console.log('Has article.dita?', $('article.dita').length > 0);
console.log('Has .contentPlaceholder?', $('.contentPlaceholder').length > 0);

console.log('\n=== Test: Content Extraction ===');
if ($('.zDocsTopicPageBody').length > 0) {
  const children = $('.zDocsTopicPageBody').children().toArray();
  console.log(`Children of .zDocsTopicPageBody: ${children.length}`);
  children.forEach((child, i) => {
    console.log(`  ${i + 1}. <${child.name}> class="${$(child).attr('class') || 'none'}"`);
  });
}

console.log('\n=== Test: contentPlaceholder Content ===');
const $placeholder = $('.contentPlaceholder');
if ($placeholder.length > 0) {
  const placeholderChildren = $placeholder.children().toArray();
  console.log(`contentPlaceholder has ${placeholderChildren.length} children`);
  
  // Check for meaningful content
  const hasHeading = $placeholder.find('h1, h2, h3, h4, h5, h6').length > 0;
  const hasList = $placeholder.find('ul, ol').length > 0;
  const hasLinks = $placeholder.find('a').length > 0;
  
  console.log(`Has headings: ${hasHeading}`);
  console.log(`Has lists: ${hasList}`);
  console.log(`Has links: ${hasLinks}`);
  
  if (hasHeading) {
    const heading = $placeholder.find('h5').first();
    console.log(`Heading text: "${heading.text()}"`);
  }
  
  if (hasList) {
    const listItems = $placeholder.find('li').toArray();
    console.log(`List items: ${listItems.length}`);
    listItems.forEach((li, i) => {
      const $li = $(li);
      const link = $li.find('a').first().text().trim();
      const desc = $li.find('p').first().text().trim();
      console.log(`  ${i + 1}. Link: "${link}"`);
      console.log(`     Desc: "${desc.substring(0, 50)}..."`);
    });
  }
}

console.log('\n');
