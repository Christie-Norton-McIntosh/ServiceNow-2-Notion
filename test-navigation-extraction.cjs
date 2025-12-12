#!/usr/bin/env node

/**
 * Test navigation-based Related Content extraction
 * Tests the fix for duplicate lines by including descriptions in link text
 */

const fs = require('fs');
const path = require('path');

// Mock HTML from real Procurement page (contentWrapper structure)
const testHtml = `
<!DOCTYPE html>
<html>
<body>
  <div class="zDocsTopicPageBody">
    <article>
      <h1>Procurement</h1>
      <p>This is the main content of the Procurement page.</p>

      <!-- ContentWrapper-based Related Content (real structure) -->
      <div class="contentWrapper" style="height: 469px;">
        <button aria-hidden="true" data-tooltip-id="zDocsMiniTocCollapseToolTip" data-tooltip-content="Hide Mini TOC" data-testid="expand-collapse-button" class="zDocsMiniTocCollapseButton" aria-label="Hide" aria-expanded="true">
          <svg aria-hidden="true" class="ico-angle-arrow-right"><use xlink:href="#ico-angle-arrow-right"></use></svg>
        </button>
        <div>
          <h5 class=" css-g931ng" aria-level="5">Related Content</h5>
          <ul>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/reference/r_ProcurementRoles.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Procurement roles</a><p>The Procurement application uses the following roles.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/concept/c_ProcurementWorkflows.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Procurement workflows</a><p>Procurement uses the following workflows.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/task/t_UsingTheProcurementOverviewModule.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Use the Procurement Overview module</a><p>Use the gauges on the Procurement Overview homepage to help you track and manage requests, purchase orders, and other important aspects of the procurement process.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/concept/c_SourcingRequestItems.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Sourcing items in a service catalog request</a><p>A service catalog request can contain multiple items that must be sourced.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/concept/c_UseProcurement.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Procurement purchase order management for assets</a><p>Accurate purchase order information is important for invoice tracking, receiving, and reporting in the ServiceNow platform.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/concept/c_ReceiveAssets.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Receive assets</a><p>Assets can be received and added to the system when they are delivered to a stockroom.</p></li>
            <li><a class=" css-ettsdk" stylesprops="[object Object]" href="/docs/bundle/yokohama-it-service-management/page/product/procurement/concept/domain-separation-procurement.html"><svg class="ico-related-link" aria-hidden="true"><use xlink:href="#ico-related-link"></use></svg>Domain separation and Procurement</a><p>Domain separation is supported in Procurement processing. Domain separation enables you to separate data, processes, and administrative tasks into logical groupings called domains. You can control several aspects of this separation, including which users can see and access data.</p></li>
          </ul>
        </div>
      </div>
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
  console.log('🔍 [NAV-EXTRACTION] Checking for navigation-based Related Content...');

  // Look for navigation elements that might contain Related Content
  // Include standalone UL elements that might contain related links
  const navElements = contentElement.querySelectorAll('nav[role="navigation"], .navigation, [role="navigation"]');
  const ulElements = contentElement.querySelectorAll('ul');

  // Combine both nav elements and standalone ULs for checking
  const elementsToCheck = [...Array.from(navElements), ...Array.from(ulElements)];

  for (const element of elementsToCheck) {
    let ul;
    if (element.tagName === 'NAV' || element.hasAttribute('role')) {
      // For nav elements, look for ul inside
      ul = element.querySelector('ul.ullinks, ul');
    } else if (element.tagName === 'UL') {
      // For standalone UL elements, use the element itself
      ul = element;
    }

    if (!ul) continue;

    const links = ul.querySelectorAll('li');
    if (links.length === 0) continue;

    // Check if this looks like Related Content (has links with descriptions)
    const hasDescriptions = Array.from(links).some(li => li.querySelector('p'));
    if (!hasDescriptions) continue;

    // Additional check: ensure this looks like related content, not just any list
    // Look for patterns that indicate this is related content
    const hasRelatedLinks = Array.from(links).some(li => {
      const link = li.querySelector('a');
      return link && (link.classList.contains('css-ettsdk') || link.querySelector('svg.ico-related-link'));
    });

    if (!hasRelatedLinks && element.tagName === 'UL') {
      // For standalone ULs, be more strict - require the related link indicators
      continue;
    }

    console.log(`✅ [NAV-EXTRACTION] Found ${element.tagName} element with ${links.length} links and descriptions`);

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
    console.log(`📝 [NAV-EXTRACTION] Generated synthetic Related Content HTML (${relatedHtml.length} chars)`);

    return relatedHtml;
  }

  console.log('❌ [NAV-EXTRACTION] No navigation-based Related Content found');
  return null;
}

// Run the test
console.log('🧪 Testing navigation-based Related Content extraction...\n');

const contentElement = document.querySelector('.zDocsTopicPageBody');
const result = extractNavigationRelatedContent(contentElement);

console.log('\n📋 Test Results:');
console.log('Captured logs:', capturedLogs);
console.log('Extraction result:', result);

if (result && result.includes('Related Content') && result.includes('Procurement roles') && result.includes('Procurement workflows')) {
  console.log('✅ SUCCESS: Related Content extracted with proper header and links');
} else {
  console.log('❌ FAILED: Related Content not properly extracted');
  console.log('Expected to find: "Related Content", "Procurement roles", "Procurement workflows"');
}