const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const pageId = '2bfa89fedba581ae87f5ffd9c0b08bfe';

async function analyzePage() {
  console.log('📄 Analyzing Predictive Intelligence for Incident Management page...\n');
  
  // Fetch all blocks
  const blocks = [];
  let cursor;
  
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100
    });
    blocks.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);
  
  console.log(`Found ${blocks.length} blocks in Notion\n`);
  
  // Count block types
  const blockTypes = {};
  blocks.forEach(b => {
    blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
  });
  
  console.log('📊 Block type distribution:');
  Object.entries(blockTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });
  
  // Calculate total text content
  let totalChars = 0;
  blocks.forEach(block => {
    if (block[block.type]?.rich_text) {
      const text = block[block.type].rich_text.map(rt => rt.plain_text).join('');
      totalChars += text.length;
    }
  });
  
  console.log(`\n📝 Total characters in Notion: ${totalChars}`);
  
  // Look for the HTML file
  const searchDirs = [
    '../patch/pages/pages-to-update',
    '../patch/pages/updated-pages',
    '../patch/pages/validation-order-issues'
  ];
  
  let htmlFile = null;
  for (const dir of searchDirs) {
    const files = fs.readdirSync(path.join(__dirname, dir));
    const match = files.find(f => f.includes('predictive-intelligence-for-incident-management'));
    if (match) {
      htmlFile = path.join(__dirname, dir, match);
      break;
    }
  }
  
  if (htmlFile && fs.existsSync(htmlFile)) {
    const html = fs.readFileSync(htmlFile, 'utf8');
    const textContent = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`\n📄 HTML source characters: ${textContent.length}`);
    console.log(`\n⚠️  Missing: ${textContent.length - totalChars} characters (${Math.round((1 - totalChars/textContent.length) * 100)}%)`);
    
    // Show first few blocks
    console.log(`\n📋 First 10 blocks in Notion:`);
    blocks.slice(0, 10).forEach((block, idx) => {
      const text = block[block.type]?.rich_text?.map(rt => rt.plain_text).join('') || '';
      const preview = text.substring(0, 80).replace(/\n/g, '\\n');
      console.log(`   [${idx}] ${block.type}: ${preview}${text.length > 80 ? '...' : ''}`);
    });
  }
}

analyzePage().catch(console.error);
