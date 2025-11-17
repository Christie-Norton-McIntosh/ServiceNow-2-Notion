#!/usr/bin/env node

/**
 * Split Large Page Script
 * 
 * Splits a large HTML page into multiple smaller pages based on h2 sections.
 * Each section becomes a separate page, reducing complexity and avoiding timeouts.
 * 
 * Usage:
 *   node scripts/split-large-page.cjs <input-html-file> <output-dir>
 * 
 * Example:
 *   node scripts/split-large-page.cjs patch/pages/pages-to-update/generic-policies-in-devops-config-2025-11-11T10-02-11.html patch/pages/pages-to-update/split/
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function parseMetadata(html) {
  const metadataMatch = html.match(/<!--\s*([\s\S]*?)-->/);
  if (!metadataMatch) return null;
  
  const metadataText = metadataMatch[1];
  const metadata = {};
  
  const pageMatch = metadataText.match(/Page:\s*(.+)/);
  const urlMatch = metadataText.match(/URL:\s*(.+)/);
  const capturedMatch = metadataText.match(/Captured:\s*(.+)/);
  const pageIdMatch = metadataText.match(/Page ID:\s*(.+)/);
  
  if (pageMatch) metadata.title = pageMatch[1].trim();
  if (urlMatch) metadata.url = urlMatch[1].trim();
  if (capturedMatch) metadata.captured = capturedMatch[1].trim();
  if (pageIdMatch) metadata.pageId = pageIdMatch[1].trim();
  
  return metadata;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .trim();
}

function splitByH2Sections(htmlFile, outputDir) {
  log(`\n📄 Reading file: ${htmlFile}`, 'cyan');
  
  const html = fs.readFileSync(htmlFile, 'utf8');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  
  // Parse metadata from HTML comment
  const metadata = parseMetadata(html);
  if (!metadata) {
    log('⚠️  No metadata found in HTML file', 'yellow');
  }
  
  // Find all h2 sections
  const h2Elements = Array.from(document.querySelectorAll('h2'));
  log(`\n🔍 Found ${h2Elements.length} h2 sections`, 'bright');
  
  if (h2Elements.length === 0) {
    log('❌ No h2 sections found - cannot split', 'red');
    process.exit(1);
  }
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    log(`📁 Created output directory: ${outputDir}`, 'green');
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const files = [];
  
  // Get the main container
  const mainContainer = $('.zDocsTopicPageBody, article.dita');
  
  // Extract intro content (everything before first h2)
  const firstH2 = h2Elements.first();
  const introContent = [];
  
  // Get all siblings before first h2
  let currentNode = mainContainer.children().first();
  while (currentNode.length && !currentNode.is('section') || !currentNode.find('h2').first().is(firstH2)) {
    const cloned = currentNode.clone();
    // Skip if it contains an h2
    if (!cloned.find('h2').length) {
      introContent.push($.html(cloned));
    }
    currentNode = currentNode.next();
    if (currentNode.find('h2').first().is(firstH2)) break;
  }
  
  // Process each h2 section
  h2Elements.each((index, element) => {
    const $h2 = $(element);
    const sectionTitle = $h2.text().trim();
    const sectionId = $h2.attr('id') || `section-${index + 1}`;
    
    log(`\n  ${index + 1}. ${sectionTitle}`, 'blue');
    
    // Find the parent section element
    const $section = $h2.closest('section');
    
    if (!$section.length) {
      log(`     ⚠️  No parent section found for h2, skipping`, 'yellow');
      return;
    }
    
    // Clone the full page structure
    const $clone = $.load(html, { decodeEntities: false });
    
    // Remove all sections except the current one
    $clone('section').each((i, sec) => {
      const $sec = $clone(sec);
      if (!$sec.find(`#${sectionId}`).length) {
        $sec.remove();
      }
    });
    
    // Generate filename
    const slug = slugify(sectionTitle);
    const filename = `${slug}-${timestamp}.html`;
    const filepath = path.join(outputDir, filename);
    
    // Update metadata in HTML comment
    const newMetadata = `<!--
  Page: ${sectionTitle}
  URL: ${metadata?.url || 'N/A'}
  Captured: ${timestamp}
  Parent Page: ${metadata?.title || 'Unknown'}
  Parent Page ID: ${metadata?.pageId || 'Unknown'}
  Section: ${index + 1} of ${h2Elements.length}
-->`;
    
    const outputHtml = $clone.html();
    const finalHtml = outputHtml.replace(/<!--[\s\S]*?-->/, newMetadata);
    
    // Write to file
    fs.writeFileSync(filepath, finalHtml, 'utf8');
    
    log(`     ✅ Created: ${filename}`, 'green');
    log(`     📊 Size: ${Math.round(finalHtml.length / 1024)}KB`, 'cyan');
    
    files.push({
      filename,
      title: sectionTitle,
      filepath,
      section: index + 1,
      totalSections: h2Elements.length
    });
  });
  
  // Create index file
  const indexPath = path.join(outputDir, '_split-index.json');
  const indexData = {
    originalFile: path.basename(htmlFile),
    originalPageId: metadata?.pageId,
    originalTitle: metadata?.title,
    originalUrl: metadata?.url,
    splitTimestamp: timestamp,
    totalSections: h2Elements.length,
    files: files
  };
  
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), 'utf8');
  log(`\n📋 Created index file: ${indexPath}`, 'green');
  
  // Summary
  log(`\n${'='.repeat(60)}`, 'bright');
  log(`✅ Split Complete`, 'green');
  log(`${'='.repeat(60)}`, 'bright');
  log(`Original file:    ${path.basename(htmlFile)}`, 'cyan');
  log(`Sections created: ${files.length}`, 'cyan');
  log(`Output directory: ${outputDir}`, 'cyan');
  log(`\nNext steps:`, 'yellow');
  log(`1. Review split files in: ${outputDir}`, 'reset');
  log(`2. Run batch PATCH on split files`, 'reset');
  log(`3. Original file remains unchanged`, 'reset');
  
  return files;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    log('❌ Usage: node split-large-page.cjs <input-html-file> <output-dir>', 'red');
    log('\nExample:', 'yellow');
    log('  node scripts/split-large-page.cjs patch/pages/pages-to-update/generic-policies.html patch/pages/pages-to-update/split/', 'reset');
    process.exit(1);
  }
  
  const [inputFile, outputDir] = args;
  
  if (!fs.existsSync(inputFile)) {
    log(`❌ Input file not found: ${inputFile}`, 'red');
    process.exit(1);
  }
  
  try {
    splitByH2Sections(inputFile, outputDir);
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    if (error.stack) {
      log(`\n${error.stack}`, 'red');
    }
    process.exit(1);
  }
}

module.exports = { splitByH2Sections };
