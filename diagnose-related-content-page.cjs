#!/usr/bin/env node

/**
 * Node.js version of Related Content diagnostic
 * Fetches a ServiceNow page and analyzes Related Content extraction
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

async function runPageDiagnostic(url) {
  console.log(`🔍 ServiceNow-2-Notion Related Content Diagnostic for: ${url}`);
  console.log('================================================================');

  try {
    // Fetch the page
    console.log('📡 Fetching page...');
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    console.log(`✅ Fetched ${html.length} characters`);

    // Parse with JSDOM
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Check 1: Find content element (simulate findContentElement)
    function findContentElement() {
      const selectors = [
        '.zDocsTopicPageBody',
        '[role="main"] section',
        '[role="main"] article',
        'main section',
        'main article',
        '.book-text',
        '.chapter-content',
        '.page-content',
        '.content-body'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`✅ Found content element with selector: "${selector}"`);
          console.log(`   - Tag: ${element.tagName}`);
          console.log(`   - ID: ${element.id || 'none'}`);
          console.log(`   - Classes: ${element.className || 'none'}`);
          return element;
        }
      }

      console.log('❌ No content element found with standard selectors');
      return null;
    }

    // Check 2: Look for Related Content placeholders
    function checkRelatedContentPlaceholders() {
      const placeholders = document.querySelectorAll('.contentPlaceholder');
      console.log(`📍 Found ${placeholders.length} contentPlaceholder elements`);

      placeholders.forEach((p, idx) => {
        const h5 = p.querySelector('h5');
        const h5Text = h5 ? h5.textContent.trim() : 'NO H5';
        const links = p.querySelectorAll('a').length;
        const hasMiniToc = p.querySelector('.zDocsMiniTocCollapseButton') !== null;

        console.log(`   ${idx + 1}. H5: "${h5Text}", Links: ${links}, Mini TOC: ${hasMiniToc}`);

        if (h5Text.toLowerCase().includes('related content')) {
          console.log(`   ✅ FOUND Related Content placeholder!`);
          console.log(`      - HTML length: ${p.innerHTML.length}`);
          console.log(`      - Outer HTML length: ${p.outerHTML.length}`);
          console.log(`      - First 200 chars: ${p.innerHTML.substring(0, 200)}...`);
        }
      });
    }

    // Check 3: Simulate content extraction
    function simulateExtraction() {
      console.log('🔄 Simulating content extraction...');

      const contentElement = findContentElement();
      if (!contentElement) {
        console.log('❌ Cannot simulate extraction - no content element found');
        return null;
      }

      // Check placeholders
      checkRelatedContentPlaceholders();

      // Simulate the HTML building process
      const placeholders = contentElement.querySelectorAll('.contentPlaceholder');
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');
        return Array.from(headings).some(h => h.textContent.trim().toLowerCase() === 'related content');
      });

      console.log(`📋 After filtering: ${relatedContentPlaceholders.length} Related Content placeholders`);

      let placeholderHtml = '';
      relatedContentPlaceholders.forEach((p, i) => {
        const h5 = p.querySelector('h5');
        if (h5) {
          // Simulate the serialization process (simplified for Node.js)
          const clone = p.cloneNode(true);
          clone.classList.remove('contentPlaceholder');
          clone.setAttribute('data-was-placeholder', 'true');

          const serializedHtml = clone.outerHTML;
          console.log(`   ${i+1}. Serialized HTML length: ${serializedHtml.length}`);
          placeholderHtml += serializedHtml;
        }
      });

      // Combine with main content
      const combinedHtml = contentElement.innerHTML + placeholderHtml;
      console.log(`📄 Final combined HTML length: ${combinedHtml.length}`);

      // Check if Related Content is in final HTML
      const hasRelatedContent = combinedHtml.toLowerCase().includes('related content');
      console.log(`🔍 Related Content in final HTML: ${hasRelatedContent ? 'YES' : 'NO'}`);

      if (hasRelatedContent) {
        const relatedMatches = combinedHtml.match(/Related Content/gi) || [];
        console.log(`   📊 Found ${relatedMatches.length} "Related Content" mentions`);
      }

      return combinedHtml;
    }

    // Run all checks
    console.log('\n1️⃣ Finding content element:');
    const contentElement = findContentElement();
    console.log('');

    console.log('2️⃣ Checking Related Content placeholders:');
    checkRelatedContentPlaceholders();
    console.log('');

    console.log('3️⃣ Simulating extraction:');
    const extractedHtml = simulateExtraction();
    console.log('');

    console.log('📋 SUMMARY:');
    console.log(`   - Content element found: ${!!contentElement}`);
    console.log(`   - Related Content placeholders: ${document.querySelectorAll('.contentPlaceholder').length}`);
    console.log(`   - Related Content in DOM: ${Array.from(document.querySelectorAll('.contentPlaceholder')).some(p => p.querySelector('h5')?.textContent.toLowerCase().includes('related content'))}`);
    console.log(`   - Extracted HTML length: ${extractedHtml?.length || 0}`);
    console.log(`   - Related Content in extracted HTML: ${extractedHtml?.toLowerCase().includes('related content') || false}`);

    // Additional analysis
    console.log('\n🔍 DETAILED ANALYSIS:');

    // Check all contentPlaceholder elements
    const allPlaceholders = document.querySelectorAll('.contentPlaceholder');
    console.log(`Total contentPlaceholder elements: ${allPlaceholders.length}`);

    allPlaceholders.forEach((p, idx) => {
      const h5 = p.querySelector('h5');
      const h5Text = h5 ? h5.textContent.trim() : 'NO H5';
      const allHeadings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const headingTexts = Array.from(allHeadings).map(h => `${h.tagName}: "${h.textContent.trim()}"`);

      console.log(`\nPlaceholder ${idx + 1}:`);
      console.log(`   - H5 text: "${h5Text}"`);
      console.log(`   - All headings: ${headingTexts.join(', ')}`);
      console.log(`   - Has links: ${p.querySelectorAll('a').length}`);
      console.log(`   - Has Mini TOC: ${p.querySelector('.zDocsMiniTocCollapseButton') !== null}`);
      console.log(`   - Inner HTML length: ${p.innerHTML.length}`);
      console.log(`   - Would be KEPT: ${h5Text.toLowerCase() === 'related content'}`);
    });

    console.log('\n✅ Diagnostics complete!');

  } catch (error) {
    console.error('❌ Error running diagnostics:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }
  }
}

// Run if called directly
if (require.main === module) {
  const url = process.argv[2] || 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/procurement/task/t_ActivateProcurement.html';
  runPageDiagnostic(url);
}

module.exports = { runPageDiagnostic };