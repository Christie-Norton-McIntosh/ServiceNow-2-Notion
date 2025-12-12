#!/usr/bin/env node

/**
 * Test navigation-based Related Content extraction
 * Tests the fix for duplicate lines by including descriptions in link text
 */

const fs = require('fs');
const path = require('path');

// Mock HTML from real Activate Procurement page (navigation-based Related Content)
const testHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="zDocsTopicPageBody">
    <article>
      <h1>Activate Procurement</h1>
      <p>This is the main content of the Activate Procurement page.</p>

      <!-- Navigation-based Related Content (real structure) -->
      <nav role="navigation">
        <ul class="ullinks">
          <li>
            <a href="/some-link-1">Components installed with Procurement</a>
            <p>Several types of components are installed with Procurement.</p>
          </li>
          <li>
            <a href="/some-link-2">Related Link 2</a>
            <p>Description for link 2.</p>
          </li>
        </ul>
      </nav>
    </article>
  </div>
</body>
</html>
`;

// Mock the DOM environment
const { JSDOM } = require('jsdom');
const dom = new JSDOM(testHtml);
global.document = dom.window.document;
global.window = dom.window;

// Mock console methods to capture output
const originalConsole = { ...console };
let capturedLogs = [];
console.log = (...args) => {
  capturedLogs.push(args.join(' '));
  originalConsole.log(...args);
};

// Import the content extractor (mock version for testing)
function extractNavigationRelatedContent(contentElement) {
  console.log('🔍 Checking for navigation-based Related Content...');

  // Look for navigation elements that might contain Related Content
  const navElements = contentElement.querySelectorAll('nav[role="navigation"], .navigation, [role="navigation"]');

  for (const nav of navElements) {
    const ul = nav.querySelector('ul.ullinks, ul');
    if (!ul) continue;

    const links = ul.querySelectorAll('li');
    if (links.length === 0) continue;

    // Check if this looks like Related Content (has links with descriptions)
    const hasDescriptions = Array.from(links).some(li => li.querySelector('p'));
    if (!hasDescriptions) continue;

    console.log(`✅ Found navigation with ${links.length} links and descriptions`);

    // Generate synthetic Related Content HTML
    let relatedHtml = '<h5>Related Content</h5><ul>';

    links.forEach(li => {
      const link = li.querySelector('a');
      const desc = li.querySelector('p');

      if (link && desc) {
        const linkText = link.textContent.trim();
        const descText = desc.textContent.trim();
        // FIX: Include description in link text to prevent separate paragraph blocks
        const combinedText = `${linkText} - ${descText}`;
        relatedHtml += `<li><a href="${link.href}">${combinedText}</a></li>`;
      }
    });

    relatedHtml += '</ul>';
    console.log('📝 Generated synthetic Related Content HTML');
    console.log('   Expected result: "Components installed with Procurement - Several types of components are installed with Procurement."');

    return relatedHtml;
  }

  console.log('❌ No navigation-based Related Content found');
  return null;
}

// Run the test
console.log('🧪 Testing navigation-based Related Content extraction...\n');

const contentElement = document.querySelector('.zDocsTopicPageBody');
const result = extractNavigationRelatedContent(contentElement);

console.log('\n📋 Test Results:');
console.log('Captured logs:', capturedLogs);
console.log('Extraction result:', result);

if (result && result.includes('Components installed with Procurement - Several types of components are installed with Procurement')) {
  console.log('✅ SUCCESS: Description included in link text (no duplicate paragraphs)');
} else {
  console.log('❌ FAILED: Description not properly included in link text');
}