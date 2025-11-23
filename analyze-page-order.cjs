#!/usr/bin/env node

const fs = require('fs');

// Read the Notion page blocks
const notionData = JSON.parse(fs.readFileSync('/tmp/notion-page-blocks.json', 'utf8'));

console.log('=== NOTION PAGE BLOCK ORDER ===\n');

function printBlock(block, indent = 0) {
  const prefix = '  '.repeat(indent);
  const type = block.type;
  let text = '';
  
  if (block[type]?.rich_text?.[0]?.plain_text) {
    text = block[type].rich_text[0].plain_text.substring(0, 80);
  } else if (type === 'table') {
    text = `(${block.table?.table_width || 0} cols, has_children: ${block.has_children})`;
  }
  
  console.log(`${prefix}[${type}] ${text}`);
  return { type, text };
}

notionData.results.forEach((block, i) => {
  console.log(`\n${i}. ${printBlock(block).type}`);
  if (block.has_children && block[block.type]?.children) {
    block[block.type].children.forEach((child, j) => {
      console.log(`  ${i}.${j}. ${printBlock(child, 1).type}`);
    });
  }
});

console.log('\n\n=== HTML SOURCE ORDER (key elements) ===\n');

// Read HTML and extract key structural elements
const html = fs.readFileSync('/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/build-a-cmdb-query-using-the-cmdb-query-builder-2025-11-23T01-07-00.html', 'utf8');

// Extract headings
const headingMatches = [...html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi)];
console.log('HEADINGS:');
headingMatches.forEach((m, i) => {
  const level = m[1];
  const text = m[2].replace(/<[^>]*>/g, '').substring(0, 80);
  console.log(`  H${level}: ${text}`);
});

// Extract table captions
console.log('\nTABLES:');
const tableMatches = [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi)];
tableMatches.forEach((m, i) => {
  const captionMatch = m[0].match(/<caption[^>]*>([\s\S]*?)<\/caption>/i);
  let caption = 'NO CAPTION';
  if (captionMatch) {
    caption = captionMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 80);
  }
  const lineNum = html.substring(0, m.index).split('\n').length;
  console.log(`  Table ${i + 1} (line ${lineNum}): ${caption}`);
});

// Extract list structure overview
console.log('\nLIST STRUCTURE (OL/UL):');
const listMatches = [...html.matchAll(/<(ol|ul)[^>]*>/gi)];
listMatches.forEach((m, i) => {
  const type = m[1].toUpperCase();
  const lineNum = html.substring(0, m.index).split('\n').length;
  console.log(`  ${type} at line ${lineNum}`);
});
