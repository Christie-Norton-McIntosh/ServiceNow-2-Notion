#!/usr/bin/env node

/**
 * Split Large Page Script (Simple Version)
 * 
 * Splits a large HTML page into multiple smaller pages based on <section> elements with h2.
 * Uses simple regex matching - no external dependencies required.
 * 
 * Usage:
 *   node scripts/split-large-page-simple.cjs <input-html-file> <output-dir>
 */

const fs = require('fs');
const path = require('path');

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
  if (!metadataMatch) return {};
  
  const metadataText = metadataMatch[1];
  const metadata = {};
  
  const pageMatch = metadataText.match(/Page:\s*(.+)/);
  const urlMatch = metadataText.match(/URL:\s*(.+)/);
  const pageIdMatch = metadataText.match(/Page ID:\s*(.+)/);
  
  if (pageMatch) metadata.title = pageMatch[1].trim();
  if (urlMatch) metadata.url = urlMatch[1].trim();
  if (pageIdMatch) metadata.pageId = pageIdMatch[1].trim();
  
  return metadata;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/--+/g, '-')
    .substring(0, 50)
    .trim();
}

function extractH2Title(sectionHtml) {
  const h2Match = sectionHtml.match(/<h2[^>]*>([^<]+)</);
  return h2Match ? h2Match[1].trim() : 'Unknown Section';
}

function splitBySection(htmlFile, outputDir) {
  log(`\n📄 Reading file: ${htmlFile}`, 'cyan');
  
  const html = fs.readFileSync(htmlFile, 'utf8');
  const metadata = parseMetadata(html);
  
  // Extract all <section> elements that contain h2
  // Pattern: <section...>...</section>
  const sectionRegex = /<section[^>]*class="section"[^>]*id="[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
  const sections = [];
  let match;
  
  while ((match = sectionRegex.exec(html)) !== null) {
    const sectionHtml = match[0];
    // Check if this section contains an h2
    if (sectionHtml.includes('<h2')) {
      sections.push(sectionHtml);
    }
  }
  
  log(`\n🔍 Found ${sections.length} sections with h2 headings`, 'bright');
  
  if (sections.length === 0) {
    log('❌ No sections with h2 found - cannot split', 'red');
    process.exit(1);
  }
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    log(`📁 Created output directory: ${outputDir}`, 'green');
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const files = [];
  
  // Get the HTML template (everything except sections)
  const beforeSections = html.substring(0, html.indexOf('<section'));
  const afterSections = html.substring(html.lastIndexOf('</section>') + 10);
  
  // Extract intro section (first section without h2, if any)
  const introRegex = /<section[^>]*>((?:(?!<h2)[\s\S])*?)<\/section>/;
  const introMatch = html.match(introRegex);
  const introSection = introMatch ? introMatch[0] : '';
  
  // Process each section
  sections.forEach((sectionHtml, index) => {
    const sectionTitle = extractH2Title(sectionHtml);
    
    log(`\n  ${index + 1}. ${sectionTitle}`, 'blue');
    
    // Build full HTML for this section
    const newMetadata = `<!--
  Page: ${sectionTitle}
  URL: ${metadata.url || 'N/A'}
  Captured: ${timestamp}
  Parent Page: ${metadata.title || 'Unknown'}
  Parent Page ID: ${metadata.pageId || 'Unknown'}
  Section: ${index + 1} of ${sections.length}
-->`;
    
    const fullHtml = newMetadata + '\n' + beforeSections + introSection + '\n' + sectionHtml + '\n' + afterSections;
    
    // Generate filename
    const slug = slugify(sectionTitle);
    const filename = `${slug}-${timestamp}.html`;
    const filepath = path.join(outputDir, filename);
    
    // Write to file
    fs.writeFileSync(filepath, fullHtml, 'utf8');
    
    const sizeKB = Math.round(fullHtml.length / 1024);
    log(`     ✅ Created: ${filename}`, 'green');
    log(`     📊 Size: ${sizeKB}KB`, 'cyan');
    
    files.push({
      filename,
      title: sectionTitle,
      filepath,
      sizeKB,
      section: index + 1,
      totalSections: sections.length
    });
  });
  
  // Create index file
  const indexPath = path.join(outputDir, '_split-index.json');
  const indexData = {
    originalFile: path.basename(htmlFile),
    originalPageId: metadata.pageId,
    originalTitle: metadata.title,
    originalUrl: metadata.url,
    splitTimestamp: timestamp,
    totalSections: sections.length,
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
  log(`Total size:       ${files.reduce((sum, f) => sum + f.sizeKB, 0)}KB`, 'cyan');
  log(`\nNext steps:`, 'yellow');
  log(`1. Review split files in: ${outputDir}`, 'reset');
  log(`2. Move files to pages/pages-to-update/ for batch PATCH`, 'reset');
  log(`3. Run: cd patch/config && bash batch-patch-with-cooldown.sh`, 'reset');
  log(`4. Original file remains in problematic-files/`, 'reset');
  
  return files;
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    log('❌ Usage: node split-large-page-simple.cjs <input-html-file> <output-dir>', 'red');
    log('\nExample:', 'yellow');
    log('  node scripts/split-large-page-simple.cjs \\', 'reset');
    log('    patch/pages/pages-to-update/generic-policies.html \\', 'reset');
    log('    patch/pages/pages-to-update/split-policies/', 'reset');
    process.exit(1);
  }
  
  const [inputFile, outputDir] = args;
  
  if (!fs.existsSync(inputFile)) {
    log(`❌ Input file not found: ${inputFile}`, 'red');
    process.exit(1);
  }
  
  try {
    splitBySection(inputFile, outputDir);
  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    if (error.stack) {
      log(`\n${error.stack}`, 'red');
    }
    process.exit(1);
  }
}

module.exports = { splitBySection };
