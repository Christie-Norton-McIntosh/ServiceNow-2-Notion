#!/usr/bin/env node

/**
 * Dryrun Test Script for Related Content Fix
 * Loops through different filtering approaches until Related Content appears
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

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

const SERVER_URL = 'http://127.0.0.1:3004';
const TEST_TITLE = 'Activate Procurement - Test';
const TEST_DATABASE_ID = '2b2a89fedba58033a6aeee258611a908';

// Different filtering approaches to test
const FILTERING_APPROACHES = [
  {
    name: 'No filtering (original)',
    filter: (html) => html
  },
  {
    name: 'Filter by "On this page" heading only',
    filter: (html) => {
      // Simple regex to remove contentPlaceholder with "On this page"
      return html.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<h[1-6][^>]*>[\s\S]*?on this page[\s\S]*?<\/h[1-6]>[\s\S]*?<\/div>/gi, '');
    }
  },
  {
    name: 'Filter by Mini TOC class',
    filter: (html) => {
      // Remove contentPlaceholder with zDocsMiniTocCollapseButton
      return html.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?zDocsMiniTocCollapseButton[\s\S]*?<\/div>/gi, '');
    }
  },
  {
    name: 'Filter by Mini TOC text',
    filter: (html) => {
      // Remove contentPlaceholder with "mini toc" or "minitoc"
      return html.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>(?![^<]*Related Content)[\s\S]*?(mini toc|minitoc)[\s\S]*?<\/div>/gi, '');
    }
  },
  {
    name: 'Explicit Related Content whitelist',
    filter: (html) => {
      // Keep only contentPlaceholder with "Related Content" heading
      const placeholders = html.match(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
      const filtered = placeholders.filter(p => p.includes('Related Content'));
      return html.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') + filtered.join('');
    }
  },
  {
    name: 'Combined filtering (current approach)',
    filter: (html) => {
      let result = html;

      // First, identify and keep Related Content
      const relatedContentMatches = result.match(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?Related Content[\s\S]*?<\/div>/gi) || [];

      // Remove all contentPlaceholder divs
      result = result.replace(/<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');

      // Add back only Related Content placeholders
      result += relatedContentMatches.join('');

      return result;
    }
  }
];

async function testApproach(approach, testHtml) {
  try {
    const filteredHtml = approach.filter(testHtml);

    console.log(`\n🧪 Testing: ${approach.name}`);
    console.log(`📊 Original HTML length: ${testHtml.length}`);
    console.log(`📊 Filtered HTML length: ${filteredHtml.length}`);

    // Check for Related Content in filtered HTML
    const hasRelatedContent = filteredHtml.toLowerCase().includes('related content');
    console.log(`🔍 Has Related Content: ${hasRelatedContent}`);

    if (!hasRelatedContent) {
      console.log(`❌ No Related Content found - skipping dryrun`);
      return { success: false, blocks: 0, hasRelatedContent: false };
    }

    // Send dryrun request
    const response = await axios.post(`${SERVER_URL}/api/W2N`, {
      title: TEST_TITLE,
      databaseId: TEST_DATABASE_ID,
      contentHtml: filteredHtml,
      dryRun: true
    }, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const { children, hasVideos } = response.data;
    const blockCount = children ? children.length : 0;

    console.log(`📦 Blocks created: ${blockCount}`);
    console.log(`🎥 Has videos: ${hasVideos}`);

    // Check if Related Content appears in blocks
    const relatedContentBlocks = children.filter(block =>
      block.type === 'heading_5' && block.heading_5?.rich_text?.some(rt =>
        rt.plain_text?.toLowerCase().includes('related content')
      )
    );

    const hasRelatedContentInBlocks = relatedContentBlocks.length > 0;
    console.log(`✅ Related Content in blocks: ${hasRelatedContentInBlocks}`);

    return {
      success: hasRelatedContentInBlocks,
      blocks: blockCount,
      hasRelatedContent: hasRelatedContentInBlocks,
      approach: approach.name
    };

  } catch (error) {
    console.log(`❌ Error testing ${approach.name}: ${error.message}`);
    return { success: false, blocks: 0, hasRelatedContent: false, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Starting Related Content Fix Dryrun Tests');
  console.log('=' .repeat(50));

  // Create test HTML with both Mini TOC and Related Content
  const testHtml = TEST_HTML + MINI_TOC_HTML + RELATED_CONTENT_HTML;
  console.log(`📄 Test HTML created with ${testHtml.split('contentPlaceholder').length - 1} placeholders`);

  let attempts = 0;
  let bestResult = null;

  for (const approach of FILTERING_APPROACHES) {
    attempts++;
    console.log(`\n🔄 Attempt ${attempts}/${FILTERING_APPROACHES.length}`);

    const result = await testApproach(approach, testHtml);

    if (result.success) {
      console.log(`\n🎉 SUCCESS! Found working approach: ${approach.name}`);
      console.log(`📊 Blocks: ${result.blocks}, Related Content: ${result.hasRelatedContent}`);
      return result;
    }

    if (!bestResult || result.blocks > bestResult.blocks) {
      bestResult = result;
    }

    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n❌ No approach successfully included Related Content');
  if (bestResult) {
    console.log(`📊 Best result: ${bestResult.approach} (${bestResult.blocks} blocks)`);
  }

  return null;
}

// Run the tests
if (require.main === module) {
  runTests()
    .then(result => {
      if (result) {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
      } else {
        console.log('\n❌ Test completed - no fix found');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { runTests, testApproach, FILTERING_APPROACHES };