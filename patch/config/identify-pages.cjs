#!/usr/bin/env node
/**
 * Identify HTML files by Page ID and match them to the pages needing updates
 * Usage: node identify-pages.cjs [directory]
 */

const fs = require('fs');
const path = require('path');

// Pages that need updating (from revalidation)
const targetPages = {
  '2b0a89fedba581db9adaee70908ffb12': {
    title: 'Create a CMDB 360 Compare Attribute Values query',
    markers: 2
  },
  '2b0a89fedba5819abeb0eb84b5e65626': {
    title: 'Schedule a CMDB 360 query for a report',
    markers: 1
  },
  '2b0a89fedba581138783c5e7c5611856': {
    title: 'Hardware [cmdb_ci_hardware] class',
    markers: 6
  }
};

function extractPageId(htmlContent) {
  // Try multiple patterns
  const patterns = [
    /Page ID:\s*([a-f0-9-]{32,36})/i,
    /pageId["\s:]+([a-f0-9-]{32,36})/i,
    /notion\.so\/([a-f0-9]{32})/i
  ];
  
  for (const pattern of patterns) {
    const match = htmlContent.match(pattern);
    if (match) {
      return match[1].replace(/-/g, '');
    }
  }
  return null;
}

function scanDirectory(dirPath) {
  console.log(`\n🔍 Scanning: ${dirPath}\n`);
  
  if (!fs.existsSync(dirPath)) {
    console.error(`❌ Directory not found: ${dirPath}`);
    return;
  }
  
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.html'));
  console.log(`Found ${files.length} HTML files\n`);
  
  const matches = [];
  const others = [];
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const pageId = extractPageId(content);
      
      if (pageId && targetPages[pageId]) {
        matches.push({
          file,
          pageId,
          info: targetPages[pageId]
        });
      } else {
        others.push({ file, pageId });
      }
    } catch (error) {
      console.error(`⚠️  Error reading ${file}: ${error.message}`);
    }
  }
  
  // Report matches
  if (matches.length > 0) {
    console.log('✅ MATCHES FOUND:\n');
    matches.forEach(({ file, pageId, info }) => {
      console.log(`📄 ${file}`);
      console.log(`   Page ID: ${pageId}`);
      console.log(`   Title: ${info.title}`);
      console.log(`   Markers: ${info.markers}`);
      console.log(`   ➡️  Ready to PATCH\n`);
    });
  } else {
    console.log('❌ No matching files found for the 3 target pages\n');
  }
  
  // Report other files
  if (others.length > 0) {
    console.log(`\nℹ️  Other HTML files (${others.length}):\n`);
    others.forEach(({ file, pageId }) => {
      console.log(`   ${file}`);
      if (pageId) {
        console.log(`      Page ID: ${pageId}`);
      }
    });
  }
  
  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary: ${matches.length}/3 target pages found`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (matches.length === 3) {
    console.log('✅ All 3 pages found! Ready to run batch PATCH.\n');
  } else if (matches.length > 0) {
    console.log(`⚠️  Still need ${3 - matches.length} more page(s).\n`);
  }
}

// Main
const targetDir = process.argv[2] || path.join(__dirname, '../pages/pages-to-update');
scanDirectory(targetDir);
