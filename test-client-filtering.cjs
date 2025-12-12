#!/usr/bin/env node

/**
 * Client-Side Filtering Test for Related Content Fix
 * Tests filtering logic without needing server
 */

const fs = require('fs');
const path = require('path');

// Test HTML from the Activate Procurement page (captured from logs)
const TEST_HTML = `<div dir="ltr" class="zDocsTopicPageBodyContent"><div><article class="hascomments" data-page="bundle:yokohama-it-service-management/enus/product/procurement/task/t_ActivateProcurement.html" id="bundle:yokohama-it-service-management/enus/product/procurement/task/t_ActivateProcurement.html"><main role="main"><article role="article" class="dita" id="t_ActivateProcurement" aria-labelledby="title_t_ActivateProcurement">




   <div class="body taskbody"><p class="shortdesc"><span class="ph" id="t_ActivateProcurement__shortdesc">Activate Procurement to enable procurement processing in your instance.</span></p>

   <div class="section prereq"><h6 class="sectiontitle">Before you begin</h6>
   <p>Ensure that you have the required roles and access to activate Procurement.</p>
   </div>

   <ol class="ol steps" id="t_ActivateProcurement__steps_q2x_mfd_smb"><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_1"><span class="ph cmd">Navigate to <span class="menucascade"><span class="uicontrol">All</span> &gt; <span class="uicontrol">System Definition</span> &gt; <span class="uicontrol">Plugins</span></span>.</span></span></li><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_2"><span class="ph cmd">Find and open the Procurement plugin.</span></span></li><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_3"><span class="ph cmd">Click <span class="uicontrol">Activate</span>.</span></span></li></ol>

   <div class="result"><p class="p">Procurement is activated and you can begin using procurement processing.</p>
   </div>

   </div>

   </article></main></article></div></div>`;

const MINI_TOC_HTML = `<div class="contentPlaceholder" style="display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;">
<button class="zDocsMiniTocCollapseButton" type="button" aria-expanded="true" aria-label="Hide Mini TOC">Hide Mini TOC</button>
</div>`;

const RELATED_CONTENT_HTML = `<div class="contentPlaceholder" style="display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;">
<h5>Related Content</h5>
<ul>
<li><a href="/concept/domain-separation-procurement.html">Domain separation and Procurement</a><p>Domain separation is supported in Procurement processing. Domain separation enables you to separate data, processes, and administrative tasks into logical groupings called domains. You can control several aspects of this separation, including which users can see and access data.</p></li>
</ul>
</div>`;

// Simulate the DOM filtering logic from content-extractor.js
function simulateClientFiltering(html) {
  // Create a mock DOM element
  const mockElement = {
    querySelectorAll: (selector) => {
      if (selector === '.contentPlaceholder') {
        // Extract all contentPlaceholder divs from HTML
        const matches = html.match(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
        return matches.map(match => ({
          outerHTML: match,
          innerHTML: match.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, ''),
          querySelector: (sel) => {
            if (sel === '.zDocsMiniTocCollapseButton') {
              return match.includes('zDocsMiniTocCollapseButton') ? {} : null;
            }
            if (sel === 'h1, h2, h3, h4, h5, h6') {
              const headingMatch = match.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
              return headingMatch ? {
                textContent: headingMatch[1].trim()
              } : null;
            }
            if (sel === 'h5') {
              const h5Match = match.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
              return h5Match ? {
                textContent: h5Match[1].trim()
              } : null;
            }
            return null;
          }
        }));
      }
      return [];
    }
  };

  // Simulate the filtering logic from v11.0.240
  const placeholders = mockElement.querySelectorAll('.contentPlaceholder');
  console.log(`🔍 Found ${placeholders.length} contentPlaceholder divs to manually append`);

  const relatedContentPlaceholders = placeholders.filter(p => {
    const headings = p.querySelector('h1, h2, h3, h4, h5, h6');

    // Check if this is Related Content (KEEP IT)
    const hasRelatedContent = headings && headings.textContent.trim().toLowerCase() === 'related content';

    if (hasRelatedContent) {
      console.log(`✅ Keeping placeholder: Related Content detected`);
      return true; // KEEP Related Content
    }

    // Check if this is Mini TOC (FILTER IT OUT)
    const hasOnThisPage = headings && headings.textContent.trim().toLowerCase() === 'on this page';

    const hasMiniTocClass = p.querySelector('.zDocsMiniTocCollapseButton') !== null;
    const htmlSnippet = p.innerHTML.toLowerCase();
    const hasMiniTocText = htmlSnippet.includes('mini toc') || htmlSnippet.includes('minitoc');

    if (hasOnThisPage || hasMiniTocClass || hasMiniTocText) {
      console.log(`🔍 Filtering out placeholder: hasOnThisPage=${hasOnThisPage}, hasMiniTocClass=${hasMiniTocClass}, hasMiniTocText=${hasMiniTocText}`);
      return false; // FILTER OUT Mini TOC
    }

    // Keep any other placeholders by default
    return true;
  });

  console.log(`🔍 After filtering: ${relatedContentPlaceholders.length} placeholders remaining`);

  // Simulate HTML generation
  let placeholderHtml = '';
  relatedContentPlaceholders.forEach((p, i) => {
    const h5 = p.querySelector('h5');
    if (h5) {
      console.log(`🔧 Processing placeholder ${i + 1}: has H5, adding data-was-placeholder`);
      // Apply inline styles and add data-was-placeholder
      const styledHtml = p.outerHTML.replace(
        '<div class="contentPlaceholder"',
        '<div class="contentPlaceholder" data-was-placeholder="true"'
      );
      placeholderHtml += styledHtml;
      console.log(`🔧 Added ${styledHtml.length} chars to placeholderHtml`);
    } else {
      console.log(`🔧 Skipping placeholder ${i + 1}: no H5 found`);
    }
  });

  console.log(`🔧 Total placeholderHtml length: ${placeholderHtml.length}`);

  // Combine with main content
  const mainContent = html.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
  const combinedHtml = mainContent + placeholderHtml;

  console.log(`🔧 Main content length: ${mainContent.length}`);
  console.log(`🔧 Combined HTML length: ${combinedHtml.length}`);

  return {
    combinedHtml,
    placeholdersFound: placeholders.length,
    placeholdersKept: relatedContentPlaceholders.length,
    hasRelatedContent: combinedHtml.toLowerCase().includes('related content'),
    hasMiniToc: combinedHtml.toLowerCase().includes('mini toc') || combinedHtml.toLowerCase().includes('minitoc'),
    hasDataWasPlaceholder: combinedHtml.includes('data-was-placeholder="true"')
  };
}

// Test different scenarios
function runClientTests() {
  console.log('🚀 Starting Client-Side Filtering Tests');
  console.log('=' .repeat(50));

  const testCases = [
    {
      name: 'Both Mini TOC and Related Content',
      html: TEST_HTML + MINI_TOC_HTML + RELATED_CONTENT_HTML
    },
    {
      name: 'Only Related Content',
      html: TEST_HTML + RELATED_CONTENT_HTML
    },
    {
      name: 'Only Mini TOC',
      html: TEST_HTML + MINI_TOC_HTML
    },
    {
      name: 'No placeholders',
      html: TEST_HTML
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🧪 Testing: ${testCase.name}`);
    console.log(`📊 Input HTML length: ${testCase.html.length}`);

    const result = simulateClientFiltering(testCase.html);

    console.log(`📦 Placeholders found: ${result.placeholdersFound}`);
    console.log(`📦 Placeholders kept: ${result.placeholdersKept}`);
    console.log(`🔍 Has Related Content: ${result.hasRelatedContent}`);
    console.log(`🔍 Has Mini TOC: ${result.hasMiniToc}`);
    console.log(`� Has data-was-placeholder: ${result.hasDataWasPlaceholder}`);
    console.log(`�📊 Output HTML length: ${result.combinedHtml.length}`);

    if (result.hasRelatedContent && !result.hasMiniToc && result.hasDataWasPlaceholder) {
      console.log(`✅ SUCCESS: Related Content preserved with data-was-placeholder, Mini TOC filtered out`);
    } else if (result.hasRelatedContent && result.hasMiniToc) {
      console.log(`⚠️ PARTIAL: Both Related Content and Mini TOC present`);
    } else if (!result.hasRelatedContent && !result.hasMiniToc) {
      console.log(`❌ FAILURE: Nothing preserved`);
    } else if (result.hasMiniToc) {
      console.log(`❌ FAILURE: Only Mini TOC preserved`);
    } else {
      console.log(`❓ UNKNOWN: Related Content present but Mini TOC filtered`);
    }
  }
}

// Run the tests
if (require.main === module) {
  runClientTests();
}

module.exports = { simulateClientFiltering, runClientTests };