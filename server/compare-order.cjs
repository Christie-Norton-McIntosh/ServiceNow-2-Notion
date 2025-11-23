/**
 * Compare the order of content between HTML source and Notion page
 * Usage: node compare-order.cjs <pageId> <htmlFile>
 */

const { Client } = require('@notionhq/client');
const cheerio = require('cheerio');
const fs = require('fs');
require('dotenv').config({ path: '.env' });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/**
 * Extract ordered text snippets from HTML
 */
function extractHtmlOrder(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(html);
  
  const items = [];
  let index = 0;
  
  // Walk the DOM in order, collecting text from block elements
  function walk($elem, depth = 0) {
    const tagName = $elem.get(0)?.tagName?.toLowerCase();
    
    // Skip script, style, metadata
    if (['script', 'style', 'meta', 'link'].includes(tagName)) {
      return;
    }
    
    // Block elements to track
    const blockElements = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'div', 'table', 'figure', 'pre'];
    
    if (blockElements.includes(tagName)) {
      // Get direct text (not nested in child block elements)
      let text = '';
      
      if (tagName === 'table') {
        text = '[TABLE]';
      } else if (tagName === 'figure') {
        text = '[IMAGE]';
      } else {
        // Get text from this element's direct children (text nodes and inline elements)
        $elem.contents().each((i, node) => {
          if (node.type === 'text') {
            text += $(node).text();
          } else if (node.tagName && !blockElements.includes(node.tagName.toLowerCase())) {
            text += $(node).text();
          }
        });
      }
      
      text = text.trim().replace(/\s+/g, ' ');
      
      if (text && text.length > 0) {
        items.push({
          index: index++,
          type: tagName,
          depth: depth,
          text: text.substring(0, 80),
          fullText: text
        });
      }
    }
    
    // Recurse into children
    $elem.children().each((i, child) => {
      walk($(child), depth + 1);
    });
  }
  
  // Start from body or main content
  const $body = $('body').length ? $('body') : $.root();
  walk($body);
  
  return items;
}

/**
 * Extract ordered text snippets from Notion page
 */
async function extractNotionOrder(pageId) {
  const items = [];
  let index = 0;
  
  async function walkBlocks(blockId, depth = 0) {
    const response = await notion.blocks.children.list({ 
      block_id: blockId,
      page_size: 100 
    });
    
    for (const block of response.results) {
      const type = block.type;
      let text = '';
      
      if (type === 'table') {
        text = '[TABLE]';
      } else if (type === 'image') {
        text = '[IMAGE]';
      } else if (block[type]?.rich_text) {
        text = block[type].rich_text.map(rt => rt.plain_text).join('');
      } else if (block[type]?.caption) {
        text = block[type].caption.map(rt => rt.plain_text).join('');
      }
      
      text = text.trim().replace(/\s+/g, ' ');
      
      if (text && text.length > 0) {
        items.push({
          index: index++,
          type: type,
          depth: depth,
          text: text.substring(0, 80),
          fullText: text,
          blockId: block.id
        });
      }
      
      // Recurse into children
      if (block.has_children) {
        await walkBlocks(block.id, depth + 1);
      }
    }
  }
  
  await walkBlocks(pageId);
  return items;
}

/**
 * Compare two ordered lists and find mismatches
 */
function compareOrders(htmlItems, notionItems) {
  console.log('\n' + '='.repeat(80));
  console.log('ORDER COMPARISON');
  console.log('='.repeat(80));
  console.log(`\nHTML items: ${htmlItems.length}`);
  console.log(`Notion items: ${notionItems.length}\n`);
  
  const matches = [];
  const mismatches = [];
  
  let htmlIdx = 0;
  let notionIdx = 0;
  
  while (htmlIdx < htmlItems.length || notionIdx < notionItems.length) {
    const htmlItem = htmlItems[htmlIdx];
    const notionItem = notionItems[notionIdx];
    
    if (!htmlItem && notionItem) {
      mismatches.push({
        type: 'extra_notion',
        notionIdx,
        notion: notionItem
      });
      notionIdx++;
      continue;
    }
    
    if (htmlItem && !notionItem) {
      mismatches.push({
        type: 'missing_notion',
        htmlIdx,
        html: htmlItem
      });
      htmlIdx++;
      continue;
    }
    
    // Try to match by text similarity
    const similarity = textSimilarity(htmlItem.fullText, notionItem.fullText);
    
    if (similarity > 0.8) {
      matches.push({
        htmlIdx,
        notionIdx,
        html: htmlItem,
        notion: notionItem,
        similarity
      });
      htmlIdx++;
      notionIdx++;
    } else {
      // Look ahead to see if we can find a match
      let foundMatch = false;
      
      // Search next 5 items in each direction
      for (let i = 1; i <= 5 && !foundMatch; i++) {
        // Check if current HTML matches future Notion
        if (notionIdx + i < notionItems.length) {
          const futureNotion = notionItems[notionIdx + i];
          if (textSimilarity(htmlItem.fullText, futureNotion.fullText) > 0.8) {
            // Items were reordered - Notion items came earlier
            for (let j = 0; j < i; j++) {
              mismatches.push({
                type: 'reordered_notion_early',
                htmlIdx,
                notionIdx: notionIdx + j,
                html: htmlItem,
                notion: notionItems[notionIdx + j]
              });
            }
            notionIdx += i;
            foundMatch = true;
            break;
          }
        }
        
        // Check if current Notion matches future HTML
        if (htmlIdx + i < htmlItems.length) {
          const futureHtml = htmlItems[htmlIdx + i];
          if (textSimilarity(futureHtml.fullText, notionItem.fullText) > 0.8) {
            // Items were reordered - HTML items came earlier
            for (let j = 0; j < i; j++) {
              mismatches.push({
                type: 'reordered_html_early',
                htmlIdx: htmlIdx + j,
                notionIdx,
                html: htmlItems[htmlIdx + j],
                notion: notionItem
              });
            }
            htmlIdx += i;
            foundMatch = true;
            break;
          }
        }
      }
      
      if (!foundMatch) {
        mismatches.push({
          type: 'mismatch',
          htmlIdx,
          notionIdx,
          html: htmlItem,
          notion: notionItem
        });
        htmlIdx++;
        notionIdx++;
      }
    }
  }
  
  return { matches, mismatches };
}

/**
 * Simple text similarity score (0-1)
 */
function textSimilarity(a, b) {
  if (!a || !b) return 0;
  
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normA = normalize(a);
  const normB = normalize(b);
  
  if (normA === normB) return 1.0;
  
  // Check if one contains the other
  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = Math.min(normA.length, normB.length);
    const longer = Math.max(normA.length, normB.length);
    return shorter / longer;
  }
  
  // Character overlap
  const setA = new Set(normA.split(''));
  const setB = new Set(normB.split(''));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  
  return intersection.size / union.size;
}

/**
 * Display results
 */
function displayResults(results) {
  const { matches, mismatches } = results;
  
  console.log(`\n✅ Matches: ${matches.length}`);
  console.log(`❌ Mismatches: ${mismatches.length}\n`);
  
  if (mismatches.length > 0) {
    console.log('MISMATCHES:');
    console.log('-'.repeat(80));
    
    mismatches.forEach((mm, i) => {
      console.log(`\n[${i + 1}] ${mm.type.toUpperCase()}`);
      
      if (mm.html) {
        console.log(`  HTML [${mm.htmlIdx}]: ${mm.html.type} | "${mm.html.text}"`);
      }
      
      if (mm.notion) {
        console.log(`  Notion [${mm.notionIdx}]: ${mm.notion.type} | "${mm.notion.text}"`);
      }
    });
  }
  
  // Summary by type
  console.log('\n' + '='.repeat(80));
  console.log('MISMATCH SUMMARY');
  console.log('='.repeat(80));
  
  const typeCounts = {};
  mismatches.forEach(mm => {
    typeCounts[mm.type] = (typeCounts[mm.type] || 0) + 1;
  });
  
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  
  console.log('\n');
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node compare-order.cjs <pageId> <htmlFile>');
    console.error('Example: node compare-order.cjs 2b4a89fedba5818aa350cb8e1a3c8369 test.html');
    process.exit(1);
  }
  
  const [pageId, htmlFile] = args;
  
  console.log('Extracting HTML order...');
  const htmlItems = extractHtmlOrder(htmlFile);
  
  console.log('Extracting Notion order...');
  const notionItems = await extractNotionOrder(pageId);
  
  console.log('Comparing orders...');
  const results = compareOrders(htmlItems, notionItems);
  
  displayResults(results);
}

main().catch(console.error);
