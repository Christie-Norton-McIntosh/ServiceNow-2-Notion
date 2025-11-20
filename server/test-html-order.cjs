#!/usr/bin/env node
const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/extend-servicenow-ai-platform-capabilities-2025-11-19T03-57-51.html', 'utf-8');
const $ = cheerio.load(html);

// Remove script, style, nav
$('script, style, nav').remove();

const $body = $('.zDocsTopicPageBody').first();
const snippets = [];

function walkNodes($elem) {
  if (snippets.length >= 15) return;
  
  const children = $elem.contents().toArray();
  for (const child of children) {
    if (snippets.length >= 15) break;
    
    if (child.type === 'text') {
      const text = $(child).text().trim();
      const pattern = /^(Note|Warning|Tip|Related Links|Caution|Important)$/i;
      if (text && text.length > 10 && !pattern.test(text)) {
        snippets.push(text);
      }
    } else if (child.type === 'tag') {
      walkNodes($(child));
    }
  }
}

walkNodes($body);

console.log('🔍 First 15 text snippets from HTML (in document order):\n');
snippets.forEach((text, i) => {
  const preview = text.substring(0, 100).replace(/\n/g, ' ');
  console.log(`${(i + 1).toString().padStart(2, ' ')}. ${preview}${text.length > 100 ? '...' : ''}`);
});
