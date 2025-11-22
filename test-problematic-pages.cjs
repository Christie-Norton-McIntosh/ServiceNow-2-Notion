#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// Test the survey question page
const surveyFile = path.join(__dirname, 'patch/pages/problematic-files/survey-question-data-types-2025-11-21T08-57-30.html');
const surveyHtml = fs.readFileSync(surveyFile, 'utf-8');

// Extract just the body content
const $ = cheerio.load(surveyHtml);
const bodyContent = $('.zDocsTopicPageBodyContent').html() || surveyHtml;

console.log('\n=== SURVEY QUESTION DATA TYPES PAGE ===');
console.log(`Total HTML length: ${surveyHtml.length} characters`);
console.log(`Body content length: ${bodyContent.length} characters`);
console.log(`\nHTML structure:`);
console.log(`- Images: ${$('img').length}`);
console.log(`- Tables: ${$('table').length}`);
console.log(`- Sections: ${$('section').length}`);
console.log(`- Headings (h2): ${$('h2').length}`);
console.log(`- Paragraphs: ${$('p').length}`);
console.log(`- Lists (ul): ${$('ul').length}`);
console.log(`- Lists (ol): ${$('ol').length}`);
console.log(`- Notes/callouts (.note): ${$('.note').length}`);

// Check for miniTOC
console.log(`- miniTOC elements: ${$('.miniTOC').length}`);
console.log(`- zDocsSideBoxes: ${$('.zDocsSideBoxes').length}`);

console.log('\n✅ HTML appears well-formed and complete');
console.log('❓ Question: Why would this produce 0 blocks in Notion?');
