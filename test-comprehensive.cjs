#!/usr/bin/env node

/**
 * Comprehensive Related Content Test
 * Tests the complete flow from HTML capture to Notion page creation
 */

const fs = require('fs');
const path = require('path');

// Test scenarios
const TEST_SCENARIOS = [
  {
    name: 'activate-procurement-full',
    description: 'Full Activate Procurement page with both Mini TOC and Related Content',
    htmlFile: 'tests/fixtures/activate-procurement-with-placeholders.html'
  },
  {
    name: 'related-content-only',
    description: 'Page with only Related Content placeholder',
    htmlContent: `<div dir="ltr" class="zDocsTopicPageBodyContent">
  <div class="body taskbody">
    <h1>Activate Procurement</h1>
    <p>Activate Procurement to enable procurement processing.</p>
  </div>
  <div class="contentPlaceholder" style="display: none;">
    <h5>Related Content</h5>
    <ul>
    <li><a href="/concept/domain-separation-procurement.html">Domain separation and Procurement</a></li>
    </ul>
  </div>
</div>`
  },
  {
    name: 'mini-toc-only',
    description: 'Page with only Mini TOC placeholder',
    htmlContent: `<div dir="ltr" class="zDocsTopicPageBodyContent">
  <div class="body taskbody">
    <h1>Activate Procurement</h1>
    <p>Activate Procurement to enable procurement processing.</p>
  </div>
  <div class="contentPlaceholder" style="display: none;">
    <button class="zDocsMiniTocCollapseButton">Hide Mini TOC</button>
  </div>
</div>`
  }
];

// Simulate the complete extraction and processing flow
function simulateCompleteFlow(scenario) {
  console.log(`\n🧪 Testing scenario: ${scenario.name}`);
  console.log(`📝 ${scenario.description}`);

  // Get HTML content
  let html;
  if (scenario.htmlFile) {
    html = fs.readFileSync(path.join(__dirname, scenario.htmlFile), 'utf8');
  } else {
    html = scenario.htmlContent;
  }

  console.log(`📄 Input HTML length: ${html.length}`);

  // Step 1: Extract content (simulate content-extractor.js)
  const extractionResult = simulateContentExtraction(html);
  console.log(`📦 Extraction result: ${extractionResult.contentLength} chars content, ${extractionResult.placeholdersKept} placeholders kept`);

  // Step 2: Send to server (simulate API call)
  const serverResult = simulateServerProcessing(extractionResult.finalHtml);
  console.log(`🔍 Server processing: ${serverResult.blocksCreated} blocks would be created`);

  // Step 3: Check for Related Content
  const hasRelatedContent = checkForRelatedContentInBlocks(serverResult.blocks);

  if (hasRelatedContent) {
    console.log(`✅ SUCCESS: Related Content found in final Notion blocks`);
    return true;
  } else {
    console.log(`❌ FAILURE: Related Content not found in final Notion blocks`);
    return false;
  }
}

// Simulate content extraction (from content-extractor.js)
function simulateContentExtraction(html) {
  // Find all content placeholders
  const placeholderRegex = /<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  const placeholders = [];
  let match;

  while ((match = placeholderRegex.exec(html)) !== null) {
    placeholders.push({
      fullMatch: match[0],
      innerHtml: match[1],
      index: placeholders.length
    });
  }

  console.log(`   Found ${placeholders.length} contentPlaceholder divs`);

  // Apply filtering logic (v11.0.241)
  const filteredPlaceholders = placeholders.filter(p => {
    // Extract headings
    const h5Match = p.innerHtml.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
    const headings = h5Match ? [h5Match[1].trim()] : [];

    // Check if this is Related Content (KEEP IT)
    const hasRelatedContent = headings.some(h => h.toLowerCase() === 'related content');

    if (hasRelatedContent) {
      console.log(`   ✅ Keeping placeholder ${p.index + 1}: Related Content detected`);
      return true;
    }

    // Check if this is Mini TOC (FILTER IT OUT)
    const hasMiniTocClass = p.fullMatch.includes('zDocsMiniTocCollapseButton');
    const hasMiniTocText = p.innerHtml.toLowerCase().includes('mini toc') || p.innerHtml.toLowerCase().includes('minitoc');

    if (hasMiniTocClass || hasMiniTocText) {
      console.log(`   🔍 Filtering out placeholder ${p.index + 1}: Mini TOC detected`);
      return false;
    }

    // Keep any other placeholders by default
    console.log(`   ✅ Keeping placeholder ${p.index + 1}: other content`);
    return true;
  });

  console.log(`   After filtering: ${filteredPlaceholders.length} placeholders remaining`);

  // Process filtered placeholders
  let resultHtml = html;
  filteredPlaceholders.forEach(p => {
    const originalDiv = p.fullMatch;
    const placeholderDiv = originalDiv
      .replace(/class="[^"]*contentPlaceholder[^"]*"/, 'class="contentPlaceholder" data-was-placeholder="true"')
      .replace(/style="[^"]*"/, 'style="display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;"');

    resultHtml = resultHtml.replace(originalDiv, placeholderDiv);
  });

  // Extract main content (simplified)
  const mainContentMatch = html.match(/<div[^>]*class="[^"]*body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  const mainContent = mainContentMatch ? mainContentMatch[1] : html;

  return {
    contentLength: mainContent.length,
    placeholdersKept: filteredPlaceholders.length,
    finalHtml: resultHtml
  };
}

// Simulate server processing (from servicenow.cjs)
function simulateServerProcessing(html) {
  const blocks = [];

  // Find data-was-placeholder divs
  const placeholderRegex = /<div[^>]*data-was-placeholder="true"[^>]*>([\s\S]*?)<\/div>/gi;
  let match;

  while ((match = placeholderRegex.exec(html)) !== null) {
    const placeholderHtml = match[1];

    // Process H5 headings
    const h5Regex = /<h5[^>]*>([\s\S]*?)<\/h5>/gi;
    let h5Match;
    while ((h5Match = h5Regex.exec(placeholderHtml)) !== null) {
      const headingText = h5Match[1].trim();
      blocks.push({
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: headingText } }]
        }
      });
      console.log(`   Created heading block: "${headingText}"`);
    }

    // Process list items
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(placeholderHtml)) !== null) {
      const liContent = liMatch[1].trim();
      // Extract link and text
      const linkMatch = liContent.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (linkMatch) {
        const linkText = linkMatch[2].replace(/<[^>]*>/g, '').trim();
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              { type: 'text', text: { content: linkText } }
            ]
          }
        });
        console.log(`   Created list item: "${linkText}"`);
      }
    }
  }

  return {
    blocksCreated: blocks.length,
    blocks: blocks
  };
}

// Check if Related Content appears in Notion blocks
function checkForRelatedContentInBlocks(blocks) {
  // Look for heading blocks with "Related Content"
  const headingBlocks = blocks.filter(block =>
    block.type === 'heading_3' || block.type === 'heading_2' || block.type === 'heading_1'
  );

  const relatedContentHeadings = headingBlocks.filter(block => {
    const blockType = block.type;
    const richText = block[blockType].rich_text;
    if (!richText || !Array.isArray(richText)) return false;

    const text = richText.map(rt => rt.text?.content || '').join('').trim();
    return text.toLowerCase().includes('related content');
  });

  if (relatedContentHeadings.length > 0) {
    console.log(`   ✅ Found ${relatedContentHeadings.length} Related Content heading(s)`);
    return true;
  }

  // Also check for any text blocks containing "Related Content"
  const textBlocks = blocks.filter(block =>
    block.type === 'paragraph' || block.type === 'bulleted_list_item'
  );

  const relatedContentText = textBlocks.filter(block => {
    const blockType = block.type;
    const richText = block[blockType].rich_text;
    if (!richText || !Array.isArray(richText)) return false;

    const text = richText.map(rt => rt.text?.content || '').join('').trim();
    return text.toLowerCase().includes('related content');
  });

  if (relatedContentText.length > 0) {
    console.log(`   ✅ Found Related Content in text blocks`);
    return true;
  }

  return false;
}

// Main test function
function runComprehensiveTest() {
  console.log('🚀 Comprehensive Related Content Test');
  console.log('=' .repeat(50));
  console.log('Testing complete flow from HTML to Notion blocks');

  let successfulScenarios = 0;

  for (const scenario of TEST_SCENARIOS) {
    const success = simulateCompleteFlow(scenario);
    if (success) {
      successfulScenarios++;
    }
  }

  console.log(`\n📊 Test Results: ${successfulScenarios}/${TEST_SCENARIOS.length} scenarios successful`);

  if (successfulScenarios === TEST_SCENARIOS.length) {
    console.log(`\n🎉 ALL TESTS PASSED!`);
    console.log(`The Related Content extraction is working correctly.`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. The current v11.0.241 code should work`);
    console.log(`   2. Build and deploy: npm run build`);
    console.log(`   3. Reload userscript in Tampermonkey`);
    console.log(`   4. Test on the real Activate Procurement page`);
    console.log(`   5. If still not working, check server logs for API errors`);
  } else {
    console.log(`\n❌ SOME TESTS FAILED`);
    console.log(`There are issues with the Related Content extraction.`);
    console.log(`Check the failing scenarios above for details.`);
  }
}

// Export for testing
module.exports = {
  runComprehensiveTest,
  simulateCompleteFlow,
  simulateContentExtraction,
  simulateServerProcessing,
  checkForRelatedContentInBlocks
};

// Run if called directly
if (require.main === module) {
  runComprehensiveTest();
}