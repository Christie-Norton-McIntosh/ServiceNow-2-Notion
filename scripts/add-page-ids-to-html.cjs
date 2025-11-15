#!/usr/bin/env node
/**
 * Add Page ID metadata to HTML files by searching Notion
 * 
 * This script:
 * 1. Reads HTML files from patch/pages-to-update/
 * 2. Extracts title from filename
 * 3. Searches Notion database for matching page
 * 4. Adds <!-- Page ID: xxx --> comment to top of HTML file
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = '282a89fe-dba5-815e-91f0-db972912ef9f';
const PAGES_DIR = path.join(__dirname, '..', 'patch', 'pages-to-update');

// Helper: Extract title from filename
function extractTitle(filename) {
  // Remove timestamp suffix and .html extension
  // Example: "computer-cmdb-ci-computer-class-2025-11-13T14-32-36.html" 
  // → "Computer CMDB CI Computer class"
  const title = filename
    .replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.html$/, '')
    .replace(/-/g, ' ');
  
  // Capitalize first letter of each word (ServiceNow standard)
  return title.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Helper: Extract search keywords (first 4-5 words for better matching)
function extractKeywords(title) {
  const words = title.split(' ').filter(w => w.length > 0);
  // Take first 4-5 words as keywords
  return words.slice(0, Math.min(5, words.length)).join(' ');
}

// Helper: Search Notion for page by title (case-insensitive partial match)
async function findPageByTitle(title) {
  try {
    // Try exact match first
    let response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          equals: title
        }
      }
    });
    
    if (response.results.length > 0) {
      return { id: response.results[0].id, exact: true };
    }
    
    // Try contains match (case-insensitive)
    response = await notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        property: 'Name',
        title: {
          contains: title
        }
      }
    });
    
    if (response.results.length > 0) {
      // Return first result with its actual title for confirmation
      const page = response.results[0];
      const actualTitle = page.properties.Name.title[0]?.plain_text || 'Unknown';
      return { id: page.id, exact: false, actualTitle };
    }
    
    return null;
  } catch (error) {
    console.error(`  Error searching for "${title}":`, error.message);
    return null;
  }
}

// Helper: Add page ID comment to HTML file
function addPageIdToHtml(filepath, pageId) {
  const content = fs.readFileSync(filepath, 'utf-8');
  
  // Check if page ID already exists
  if (content.includes('<!-- Page ID:')) {
    console.log('  ⏩ Page ID already exists in file');
    return false;
  }
  
  // Add page ID comment at the top
  const newContent = `<!-- Page ID: ${pageId} -->\n${content}`;
  fs.writeFileSync(filepath, newContent, 'utf-8');
  
  return true;
}

// Main execution
async function main() {
  console.log('\n📋 Adding Page IDs to HTML Files\n');
  console.log('================================================\n');
  
  const files = fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.html'));
  
  console.log(`Found ${files.length} HTML files\n`);
  
  let found = 0;
  let notFound = 0;
  let added = 0;
  let skipped = 0;
  
  for (const filename of files) {
    const filepath = path.join(PAGES_DIR, filename);
    const title = extractTitle(filename);
    
    console.log(`📄 ${filename}`);
    console.log(`  ↳ Full title: "${title}"`);
    
    // Try full title first
    let result = await findPageByTitle(title);
    
    // If not found, try with keywords
    if (!result) {
      const keywords = extractKeywords(title);
      console.log(`  ↳ Trying keywords: "${keywords}"`);
      result = await findPageByTitle(keywords);
    }
    
    if (result) {
      if (result.exact) {
        console.log(`  ↳ ✅ Found (exact match): ${result.id}`);
      } else {
        console.log(`  ↳ ✅ Found (partial match): ${result.id}`);
        console.log(`  ↳ Actual title: "${result.actualTitle}"`);
      }
      found++;
      
      // Add to HTML file
      const wasAdded = addPageIdToHtml(filepath, result.id);
      if (wasAdded) {
        console.log(`  ↳ ✅ Added page ID to file`);
        added++;
      } else {
        skipped++;
      }
    } else {
      console.log(`  ↳ ❌ Not found in Notion database`);
      notFound++;
    }
    
    console.log();
    
    // Rate limit protection
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('================================================\n');
  console.log('📊 Summary:\n');
  console.log(`  Total files:        ${files.length}`);
  console.log(`  ✅ Found in Notion:  ${found}`);
  console.log(`  ❌ Not found:        ${notFound}`);
  console.log(`  ✅ IDs added:        ${added}`);
  console.log(`  ⏩ Already had ID:   ${skipped}`);
  console.log();
  
  if (notFound > 0) {
    console.log('⚠️  Note: Some files were not found in Notion.');
    console.log('   These may be new pages that need to be created first.\n');
  }
  
  if (added > 0) {
    console.log('✅ Page IDs have been added to HTML files.');
    console.log('   You can now run the PATCH script:\n');
    console.log('   cd patch/pages-to-update && bash patch-and-move.sh\n');
  }
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
