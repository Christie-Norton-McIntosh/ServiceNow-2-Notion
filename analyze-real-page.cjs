#!/usr/bin/env node

/**
 * Test with Real Activate Procurement HTML
 * Test the extraction logic with the actual HTML from the page
 */

const fs = require('fs');
const path = require('path');

// Real HTML from the Activate Procurement page
const REAL_HTML = fs.readFileSync(path.join(__dirname, 'tests/fixtures/activate-procurement-real.html'), 'utf8');

// Simulate the content extraction logic
function analyzeRealPageHtml(html) {
  console.log('🔍 Analyzing real Activate Procurement page HTML...');
  console.log(`📄 HTML length: ${html.length} characters`);

  // Check for contentPlaceholder divs
  const placeholderRegex = /<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const placeholders = [];
  let match;

  while ((match = placeholderRegex.exec(html)) !== null) {
    placeholders.push(match[1]);
  }

  console.log(`📊 Found ${placeholders.length} contentPlaceholder divs`);

  if (placeholders.length === 0) {
    console.log('❌ No contentPlaceholder divs found!');
    console.log('🔍 Looking for other potential Related Content structures...');

    // Look for navigation sections that might contain Related Content
    const navRegex = /<nav[^>]*>([\s\S]*?)<\/nav>/gi;
    const navSections = [];
    while ((match = navRegex.exec(html)) !== null) {
      navSections.push(match[1]);
    }

    console.log(`📊 Found ${navSections.length} navigation sections`);

    navSections.forEach((nav, index) => {
      console.log(`\n🔍 Navigation section ${index + 1}:`);
      console.log(`📄 Length: ${nav.length} characters`);

      // Check for headings
      const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
      const headings = [];
      let headingMatch;
      while ((headingMatch = headingRegex.exec(nav)) !== null) {
        headings.push(headingMatch[1].trim());
      }

      console.log(`📊 Headings found: ${headings.length}`);
      headings.forEach((h, i) => {
        console.log(`   H${i + 1}: "${h}"`);
        if (h.toLowerCase().includes('related')) {
          console.log(`   ✅ This looks like Related Content!`);
        }
      });

      // Check for links
      const linkRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
      const links = [];
      let linkMatch;
      while ((linkMatch = linkRegex.exec(nav)) !== null) {
        const linkText = linkMatch[1].replace(/<[^>]*>/g, '').trim();
        if (linkText) links.push(linkText);
      }

      console.log(`📊 Links found: ${links.length}`);
      links.forEach((link, i) => {
        console.log(`   Link ${i + 1}: "${link}"`);
      });

      // Check for "Related Content" text anywhere
      if (nav.toLowerCase().includes('related content')) {
        console.log(`✅ Found "Related Content" text in this navigation section!`);
      }
    });

    // Look for any section that might be Related Content
    const ullinksRegex = /<ul[^>]*class="[^"]*ullinks[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi;
    const ullinksSections = [];
    while ((match = ullinksRegex.exec(html)) !== null) {
      ullinksSections.push(match[1]);
    }

    console.log(`\n📊 Found ${ullinksSections.length} ullinks sections (potential Related Content)`);

    ullinksSections.forEach((section, index) => {
      console.log(`\n🔍 Ullinks section ${index + 1}:`);
      const hasRelatedContent = section.toLowerCase().includes('related content');
      const linkCount = (section.match(/<li[^>]*>/gi) || []).length;

      console.log(`   Has "Related Content" text: ${hasRelatedContent}`);
      console.log(`   Link count: ${linkCount}`);

      if (linkCount > 0) {
        console.log(`   ✅ This section has ${linkCount} links - could be Related Content!`);
      }
    });

  } else {
    console.log('✅ Found contentPlaceholder divs - analyzing them...');

    placeholders.forEach((placeholder, index) => {
      console.log(`\n🔍 Placeholder ${index + 1}:`);
      console.log(`📄 Content length: ${placeholder.length}`);

      // Check for Related Content
      if (placeholder.toLowerCase().includes('related content')) {
        console.log(`✅ Contains "Related Content" text!`);
      }

      // Check for Mini TOC
      if (placeholder.toLowerCase().includes('mini toc') || placeholder.includes('zDocsMiniTocCollapseButton')) {
        console.log(`🔍 Contains Mini TOC elements`);
      }
    });
  }

  // Overall assessment
  const hasAnyPlaceholders = placeholders.length > 0;
  const hasRelatedContentText = html.toLowerCase().includes('related content');
  const hasNavigationSections = html.includes('<nav');

  console.log(`\n📊 Overall Assessment:`);
  console.log(`   Has contentPlaceholder divs: ${hasAnyPlaceholders}`);
  console.log(`   Has "Related Content" text: ${hasRelatedContentText}`);
  console.log(`   Has navigation sections: ${hasNavigationSections}`);

  if (!hasAnyPlaceholders && hasNavigationSections) {
    console.log(`\n🔍 CONCLUSION: This page doesn't use contentPlaceholder divs for Related Content.`);
    console.log(`   The Related Content might be in navigation sections or loaded dynamically.`);
    console.log(`   The current extraction logic won't find it because it only looks for contentPlaceholder divs.`);
  }

  return {
    hasPlaceholders: hasAnyPlaceholders,
    hasRelatedContentText: hasRelatedContentText,
    hasNavigationSections: hasNavigationSections,
    placeholderCount: placeholders.length
  };
}

// Test the current extraction logic with real HTML
function testCurrentLogicWithRealHtml(html) {
  console.log('\n🧪 Testing current extraction logic with real HTML...');

  // Simulate the placeholder finding logic from content-extractor.js
  const placeholders = [];
  const placeholderRegex = /<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = placeholderRegex.exec(html)) !== null) {
    placeholders.push({
      fullMatch: match[0],
      innerHtml: match[1]
    });
  }

  console.log(`🔍 Current logic found ${placeholders.length} contentPlaceholder divs`);

  if (placeholders.length === 0) {
    console.log(`❌ Current logic finds NOTHING to process!`);
    console.log(`   This explains why Related Content doesn't appear in Notion.`);
    return { placeholdersFound: 0, wouldProcess: 0 };
  }

  // Apply filtering logic
  const filtered = placeholders.filter(p => {
    const headings = [];
    const h5Match = p.innerHtml.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    if (h5Match) headings.push(h5Match[1].trim());

    const hasRelatedContent = headings.some(h => h.toLowerCase() === 'related content');
    if (hasRelatedContent) {
      console.log(`✅ Would keep: Related Content detected`);
      return true;
    }

    const hasMiniToc = p.fullMatch.includes('zDocsMiniTocCollapseButton') ||
                      p.innerHtml.toLowerCase().includes('mini toc');
    if (hasMiniToc) {
      console.log(`🔍 Would filter: Mini TOC detected`);
      return false;
    }

    console.log(`✅ Would keep: other content`);
    return true;
  });

  console.log(`📊 After filtering: ${filtered.length} placeholders would be processed`);

  return {
    placeholdersFound: placeholders.length,
    wouldProcess: filtered.length
  };
}

// Main analysis function
function analyzeRealPageIssue() {
  console.log('🚀 Analyzing Real Activate Procurement Page Issue');
  console.log('=' .repeat(60));

  const analysis = analyzeRealPageHtml(REAL_HTML);
  const logicTest = testCurrentLogicWithRealHtml(REAL_HTML);

  console.log('\n🎯 ROOT CAUSE ANALYSIS:');
  console.log('=' .repeat(30));

  if (analysis.hasPlaceholders) {
    console.log('✅ Page has contentPlaceholder divs');
    if (logicTest.wouldProcess > 0) {
      console.log('✅ Current logic would process Related Content');
      console.log('❓ Issue might be in server processing or API calls');
    } else {
      console.log('❌ Current logic filters out all placeholders');
      console.log('🔧 Need to adjust filtering logic');
    }
  } else {
    console.log('❌ Page has NO contentPlaceholder divs');
    console.log('🎯 ROOT CAUSE FOUND: The Related Content is not in contentPlaceholder divs!');
    console.log('');
    console.log('📝 SOLUTION NEEDED:');
    console.log('   The extraction logic needs to be updated to find Related Content in:');
    console.log('   - Navigation sections (<nav> elements)');
    console.log('   - Ullinks sections (<ul class="ullinks">)');
    console.log('   - Or other page structures');
    console.log('');
    console.log('🔧 REQUIRED CHANGES:');
    console.log('   1. Update content-extractor.js to look for Related Content in navigation sections');
    console.log('   2. Add logic to detect Related Content by heading text or structure');
    console.log('   3. Process navigation links as Related Content items');
  }

  console.log('\n📋 NEXT STEPS:');
  console.log('1. Update extraction logic to handle navigation-based Related Content');
  console.log('2. Test with updated logic');
  console.log('3. Build and deploy new version');
  console.log('4. Verify Related Content appears in Notion');
}

// Run the analysis
if (require.main === module) {
  analyzeRealPageIssue();
}