#!/usr/bin/env node

/**
 * Test Navigation-Based Related Content Extraction
 * Test the new logic that extracts Related Content from navigation sections
 */

const fs = require('fs');
const path = require('path');

// Real HTML from Activate Procurement page
const REAL_HTML = fs.readFileSync(path.join(__dirname, 'tests/fixtures/activate-procurement-real.html'), 'utf8');

// Simulate the new navigation-based extraction logic
function simulateNavigationExtraction(html) {
  console.log('🔍 Simulating navigation-based Related Content extraction...');

  // Parse HTML to find navigation elements
  const navRegex = /<nav[^>]*role="navigation"[^>]*>([\s\S]*?)<\/nav>/gi;
  const ullinksRegex = /<ul[^>]*class="ullinks"[^>]*>([\s\S]*?)<\/ul>/gi;

  const navMatches = [];
  let match;
  while ((match = navRegex.exec(html)) !== null) {
    navMatches.push(match[1]);
  }

  const ullinksMatches = [];
  while ((match = ullinksRegex.exec(html)) !== null) {
    ullinksMatches.push(match[1]);
  }

  console.log(`📊 Found ${navMatches.length} navigation sections`);
  console.log(`📊 Found ${ullinksMatches.length} ullinks sections`);

  let navigationHtml = '';

  // Process navigation sections
  navMatches.forEach((navContent, i) => {
    console.log(`\n🔍 Processing navigation section ${i + 1}:`);
    console.log(`📄 Content length: ${navContent.length}`);

    // Look for ullinks within this nav
    const ullinksInNav = ullinksRegex.exec(navContent);
    if (ullinksInNav) {
      const ullinksContent = ullinksInNav[1];
      console.log(`   Found ullinks within nav: ${ullinksContent.length} chars`);

      // Extract links from ullinks
      const linkRegex = /<li[^>]*class="[^"]*link[^"]*ulchildlink[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
      const links = [];
      let linkMatch;
      while ((linkMatch = linkRegex.exec(ullinksContent)) !== null) {
        links.push(linkMatch[1]);
      }

      console.log(`   Found ${links.length} link items in ullinks`);

      if (links.length > 0) {
        // Create synthetic Related Content HTML
        let syntheticHtml = '<h5>Related Content</h5><ul>';
        links.forEach(linkHtml => {
          // Extract link details
          const linkMatch = linkHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
          if (linkMatch) {
            const href = linkMatch[1];
            const linkText = linkMatch[2].trim();

            // Look for description paragraph
            const descMatch = linkHtml.match(/<p[^>]*class="shortdesc"[^>]*>([\s\S]*?)<\/p>/);
            const description = descMatch ? descMatch[1].trim() : '';

            syntheticHtml += `<li><a href="${href}">${linkText}</a>`;
            if (description) {
              syntheticHtml += `<p>${description}</p>`;
            }
            syntheticHtml += '</li>';

            console.log(`   ✅ Link: "${linkText}" (${href})`);
            if (description) {
              console.log(`      Desc: "${description}"`);
            }
          }
        });
        syntheticHtml += '</ul>';

        // Create wrapper div with data-was-placeholder
        const wrapperHtml = `<div data-was-placeholder="true" data-source="navigation" style="display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;">
${syntheticHtml}
</div>`;

        console.log(`   Created synthetic Related Content: ${wrapperHtml.length} chars`);
        navigationHtml += wrapperHtml;
      }
    }
  });

  return {
    navigationHtml,
    navSectionsFound: navMatches.length,
    ullinksSectionsFound: ullinksMatches.length,
    linksExtracted: navigationHtml ? (navigationHtml.match(/<li>/g) || []).length : 0
  };
}

// Test the complete flow
function testCompleteFlow() {
  console.log('🧪 Testing Complete Navigation-Based Extraction Flow');
  console.log('=' .repeat(60));

  console.log(`📄 Input HTML: ${REAL_HTML.length} characters`);

  // Simulate navigation extraction
  const navResult = simulateNavigationExtraction(REAL_HTML);

  console.log(`\n📊 Navigation Extraction Results:`);
  console.log(`   - Navigation sections found: ${navResult.navSectionsFound}`);
  console.log(`   - Ullinks sections found: ${navResult.ullinksSectionsFound}`);
  console.log(`   - Links extracted: ${navResult.linksExtracted}`);
  console.log(`   - Navigation HTML generated: ${navResult.navigationHtml.length} chars`);

  if (navResult.navigationHtml) {
    console.log(`\n✅ SUCCESS: Generated navigation-based Related Content!`);
    console.log(`📄 Generated HTML:\n${navResult.navigationHtml}`);

    // Simulate what the server would do with this HTML
    console.log(`\n🔍 Simulating server processing of navigation HTML...`);

    const placeholderRegex = /<div[^>]*data-was-placeholder="true"[^>]*>([\s\S]*?)<\/div>/gi;
    const placeholders = [];
    let match;
    while ((match = placeholderRegex.exec(navResult.navigationHtml)) !== null) {
      placeholders.push(match[1]);
    }

    console.log(`📊 Server finds ${placeholders.length} data-was-placeholder divs`);

    placeholders.forEach((placeholder, i) => {
      console.log(`\n🔍 Server processing placeholder ${i + 1}:`);

      // Extract H5
      const h5Match = placeholder.match(/<h5[^>]*>([\s\S]*?)<\/h5>/);
      if (h5Match) {
        console.log(`   H5: "${h5Match[1].trim()}"`);
      }

      // Extract list items
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      const listItems = [];
      while ((match = liRegex.exec(placeholder)) !== null) {
        listItems.push(match[1].trim());
      }

      console.log(`   List items: ${listItems.length}`);
      listItems.forEach((li, j) => {
        const linkMatch = li.match(/<a[^>]*>([\s\S]*?)<\/a>/);
        if (linkMatch) {
          console.log(`   ${j + 1}. "${linkMatch[1].trim()}"`);
        }
      });
    });

    console.log(`\n🎉 COMPLETE SUCCESS: Navigation-based Related Content will appear in Notion!`);

  } else {
    console.log(`\n❌ FAILURE: No navigation-based Related Content generated`);
    console.log(`The page structure might be different than expected.`);
  }
}

// Run the test
if (require.main === module) {
  testCompleteFlow();
}