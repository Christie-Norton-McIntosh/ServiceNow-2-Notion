#!/usr/bin/env node

/**
 * Automated Related Content Fix Tester v2.0
 * Fully automated testing that runs without user input
 * Tests different filtering approaches until Related Content appears
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const http = require('http');

// Test configuration
const CONFIG = {
  serverUrl: 'http://localhost:3004',
  testTitle: 'Activate Procurement - Auto Test',
  testDatabaseId: '2b2a89fedba58033a6aeee258611a908',
  maxRetries: 3,
  delayBetweenTests: 2000, // 2 seconds
  timeout: 30000 // 30 seconds
};

// HTML fixture from Activate Procurement page (with placeholders)
const TEST_HTML_WITH_PLACEHOLDERS = `
<div dir="ltr" class="zDocsTopicPageBodyContent"><div><article class="hascomments" data-page="bundle:yokohama-it-service-management/enus/product/procurement/task/t_ActivateProcurement.html" id="bundle:yokohama-it-service-management/enus/product/procurement/task/t_ActivateProcurement.html"><main role="main"><article role="article" class="dita" id="t_ActivateProcurement" aria-labelledby="title_t_ActivateProcurement">

   <div class="body taskbody"><p class="shortdesc"><span class="ph" id="t_ActivateProcurement__shortdesc">Activate Procurement to enable procurement processing in your instance.</span></p>

   <div class="section prereq"><h6 class="sectiontitle">Before you begin</h6>
   <p>Ensure that you have the required roles and access to activate Procurement.</p>
   </div>

   <ol class="ol steps" id="t_ActivateProcurement__steps_q2x_mfd_smb"><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_1"><span class="ph cmd">Navigate to <span class="menucascade"><span class="uicontrol">All</span> &gt; <span class="uicontrol">System Definition</span> &gt; <span class="uicontrol">Plugins</span></span>.</span></span></li><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_2"><span class="ph cmd">Find and open the Procurement plugin.</span></span></li><li class="li step" id="t_ActivateProcurement__steps_q2x_mfd_smb__step_3"><span class="ph cmd">Click <span class="uicontrol">Activate</span>.</span></span></li></ol>

   <div class="result"><p class="p">Procurement is activated and you can begin using procurement processing.</p>
   </div>

   </div>

   <div class="contentPlaceholder" style="display: none;">
   <button class="zDocsMiniTocCollapseButton" type="button" aria-expanded="true" aria-label="Hide Mini TOC">Hide Mini TOC</button>
   </div>

   <div class="contentPlaceholder" style="display: none;">
   <h5>Related Content</h5>
   <ul>
   <li><a href="/concept/domain-separation-procurement.html">Domain separation and Procurement</a><p>Domain separation is supported in Procurement processing. Domain separation enables you to separate data, processes, and administrative tasks into logical groupings called domains. You can control several aspects of this separation, including which users can see and access data.</p></li>
   </ul>
   </div>

   </article></main></article></div></div>
`;

// Different filtering approaches to try
const FILTERING_APPROACHES = [
  {
    name: 'v11.0.241-current',
    description: 'Current approach: explicit Related Content whitelist, styles only on root',
    code: `
      // v11.0.241: Explicit Related Content whitelist
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');

        // Check if this is Related Content (KEEP IT)
        const hasRelatedContent = Array.from(headings).some(h => {
          const t = h.textContent.trim().toLowerCase();
          return t === 'related content';
        });

        if (hasRelatedContent) {
          console.log(\`✅ Keeping placeholder: Related Content detected\`);
          return true; // KEEP Related Content
        }

        // Check if this is Mini TOC (FILTER IT OUT)
        const hasOnThisPage = Array.from(headings).some(h => {
          const t = h.textContent.trim().toLowerCase();
          return t === 'on this page';
        });

        const hasMiniTocClass = p.querySelector('.zDocsMiniTocCollapseButton') !== null;
        const htmlSnippet = p.innerHTML.toLowerCase();
        const hasMiniTocText = htmlSnippet.includes('mini toc') || htmlSnippet.includes('minitoc');

        if (hasOnThisPage || hasMiniTocClass || hasMiniTocText) {
          console.log(\`🔍 Filtering out placeholder: hasOnThisPage=\${hasOnThisPage}, hasMiniTocClass=\${hasMiniTocClass}, hasMiniTocText=\${hasMiniTocText}\`);
          return false; // FILTER OUT Mini TOC
        }

        // Keep any other placeholders by default
        return true;
      });
    `
  },
  {
    name: 'no-filtering',
    description: 'Send all placeholders without filtering',
    code: `
      // No filtering - send all placeholders
      const relatedContentPlaceholders = Array.from(placeholders);
      console.log(\`🔍 Keeping all \${relatedContentPlaceholders.length} placeholders (no filtering)\`);
    `
  },
  {
    name: 'class-only-filter',
    description: 'Only filter by zDocsMiniTocCollapseButton class',
    code: `
      // Only filter by Mini TOC class
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const hasMiniTocClass = p.querySelector('.zDocsMiniTocCollapseButton') !== null;
        if (hasMiniTocClass) {
          console.log(\`🔍 Filtering out placeholder: hasMiniTocClass=true\`);
          return false;
        }
        console.log(\`✅ Keeping placeholder: no Mini TOC class\`);
        return true;
      });
    `
  },
  {
    name: 'text-only-filter',
    description: 'Only filter by mini toc text',
    code: `
      // Only filter by Mini TOC text
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const htmlSnippet = p.innerHTML.toLowerCase();
        const hasMiniTocText = htmlSnippet.includes('mini toc') || htmlSnippet.includes('minitoc');
        if (hasMiniTocText) {
          console.log(\`🔍 Filtering out placeholder: hasMiniTocText=true\`);
          return false;
        }
        console.log(\`✅ Keeping placeholder: no Mini TOC text\`);
        return true;
      });
    `
  },
  {
    name: 'aggressive-filter',
    description: 'Filter any placeholder without Related Content H5',
    code: `
      // Aggressive: only keep placeholders with Related Content H5
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const hasRelatedContent = Array.from(headings).some(h => {
          const t = h.textContent.trim().toLowerCase();
          return t === 'related content';
        });

        if (hasRelatedContent) {
          console.log(\`✅ Keeping placeholder: has Related Content H5\`);
          return true;
        } else {
          console.log(\`🔍 Filtering out placeholder: no Related Content H5\`);
          return false;
        }
      });
    `
  },
  {
    name: 'no-styles-at-all',
    description: 'Remove contentPlaceholder class but apply no inline styles',
    code: `
      // v11.0.241: Explicit Related Content whitelist
      const relatedContentPlaceholders = Array.from(placeholders).filter(p => {
        const headings = p.querySelectorAll('h1, h2, h3, h4, h5, h6');

        // Check if this is Related Content (KEEP IT)
        const hasRelatedContent = Array.from(headings).some(h => {
          const t = h.textContent.trim().toLowerCase();
          return t === 'related content';
        });

        if (hasRelatedContent) {
          console.log(\`✅ Keeping placeholder: Related Content detected\`);
          return true; // KEEP Related Content
        }

        // Check if this is Mini TOC (FILTER IT OUT)
        const hasOnThisPage = Array.from(headings).some(h => {
          const t = h.textContent.trim().toLowerCase();
          return t === 'on this page';
        });

        const hasMiniTocClass = p.querySelector('.zDocsMiniTocCollapseButton') !== null;
        const htmlSnippet = p.innerHTML.toLowerCase();
        const hasMiniTocText = htmlSnippet.includes('mini toc') || htmlSnippet.includes('minitoc');

        if (hasOnThisPage || hasMiniTocClass || hasMiniTocText) {
          console.log(\`🔍 Filtering out placeholder: hasOnThisPage=\${hasOnThisPage}, hasMiniTocClass=\${hasMiniTocClass}, hasMiniTocText=\${hasMiniTocText}\`);
          return false; // FILTER OUT Mini TOC
        }

        // Keep any other placeholders by default
        return true;
      });
    `,
    styleApplication: 'none'
  },
  {
    name: 'server-side-fix',
    description: 'Client sends all, server filters Related Content',
    code: `
      // Send all placeholders to server, let server handle filtering
      const relatedContentPlaceholders = Array.from(placeholders);
      console.log(\`🔍 Sending all \${relatedContentPlaceholders.length} placeholders to server\`);
    `
  }
];

// Utility functions
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeHttpRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ statusCode: res.statusCode, response });
        } catch (e) {
          resolve({ statusCode: res.statusCode, response: body });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(CONFIG.timeout, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

// Apply a filtering approach to the source code
function applyApproach(approach) {
  const sourceFile = path.join(__dirname, 'src', 'content', 'content-extractor.js');

  // Read current source
  let source = fs.readFileSync(sourceFile, 'utf8');

  // Find the filtering section
  const filterStart = source.indexOf('      // v11.0.236: CRITICAL FIX - Filter out "On this page" BEFORE processing');
  const filterEnd = source.indexOf('      console.log(`🔍 After filtering "On this page": ${relatedContentPlaceholders.length} placeholders remaining`);');

  if (filterStart === -1 || filterEnd === -1) {
    throw new Error('Could not find filtering section in source code');
  }

  // Replace the filtering logic
  const beforeFilter = source.substring(0, filterStart);
  const afterFilter = source.substring(filterEnd + 100); // Skip the old logic

  let newSource = beforeFilter;

  // Add the new filtering approach
  newSource += `      // ${approach.name}: ${approach.description}\n`;
  newSource += approach.code;
  newSource += '\n';
  newSource += `      console.log(\`🔍 After filtering: \${relatedContentPlaceholders.length} placeholders remaining\`);\n`;

  // Add the rest of the file
  const styleApplicationIndex = source.indexOf('          // CRITICAL FIX v11.0.241: Do NOT apply inline styles to child elements!');
  if (styleApplicationIndex !== -1) {
    const styleSection = source.substring(styleApplicationIndex, source.indexOf('          clone.setAttribute(\'data-was-placeholder\', \'true\'); // Mark for server processing') + 100);
    newSource += styleSection;
  } else {
    // Fallback to original style application
    newSource += `          const clone = p.cloneNode(true);  // Clone the placeholder

          // Apply styles based on approach
          if ('${approach.styleApplication || 'root-only'}' === 'none') {
            // No styles at all
          } else {
            // Apply styles ONLY to root placeholder div
            clone.setAttribute('style', 'display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;');
          }

          // Remove contentPlaceholder class
          clone.classList.remove('contentPlaceholder');
          clone.setAttribute('data-was-placeholder', 'true'); // Mark for server processing
`;
  }

  // Add the rest of the processing logic
  const processingStart = source.indexOf('          tempContainer.appendChild(clone);');
  if (processingStart !== -1) {
    newSource += source.substring(processingStart);
  }

  // Write back to file
  fs.writeFileSync(sourceFile, newSource);
  console.log(`✅ Applied approach: ${approach.name}`);
}

// Build the userscript
function buildUserscript() {
  try {
    console.log('🔨 Building userscript...');
    execSync('npm run build', { stdio: 'pipe' }); // Suppress output
    console.log('✅ Build successful');
    return true;
  } catch (error) {
    console.log('❌ Build failed:', error.message);
    return false;
  }
}

// Test a filtering approach by sending HTML to server
async function testApproach(approach) {
  console.log(`\n🧪 Testing approach: ${approach.name}`);
  console.log(`📝 ${approach.description}`);

  try {
    // Apply the approach
    applyApproach(approach);

    // Build the userscript
    if (!buildUserscript()) {
      console.log(`❌ Build failed for ${approach.name}`);
      return { success: false, error: 'Build failed' };
    }

    // Test with dryrun API call
    console.log('📡 Sending test HTML to server with dryrun...');

    const testData = {
      title: CONFIG.testTitle,
      databaseId: CONFIG.testDatabaseId,
      contentHtml: TEST_HTML_WITH_PLACEHOLDERS,
      dryRun: true
    };

    const result = await makeHttpRequest(`${CONFIG.serverUrl}/api/W2N`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, testData);

    if (result.statusCode !== 200) {
      console.log(`❌ API call failed with status ${result.statusCode}`);
      return { success: false, error: `API status ${result.statusCode}` };
    }

    // Analyze the response
    const response = result.response;
    console.log(`📊 Server response received (${response.children ? response.children.length : 0} children)`);

    // Check for Related Content in the response
    const hasRelatedContent = checkForRelatedContent(response);

    if (hasRelatedContent) {
      console.log(`🎉 SUCCESS! ${approach.name} works! Related Content found in response.`);
      return { success: true, response };
    } else {
      console.log(`❌ ${approach.name} failed - no Related Content in response`);
      return { success: false, response };
    }

  } catch (error) {
    console.log(`❌ Error testing ${approach.name}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Check if response contains Related Content blocks
function checkForRelatedContent(response) {
  if (!response.children || !Array.isArray(response.children)) {
    return false;
  }

  // Look for heading blocks with "Related Content"
  const headingBlocks = response.children.filter(block =>
    block.type === 'heading_2' || block.type === 'heading_3' || block.type === 'heading_1'
  );

  const relatedContentHeadings = headingBlocks.filter(block => {
    const text = getBlockText(block);
    return text && text.toLowerCase().includes('related content');
  });

  if (relatedContentHeadings.length > 0) {
    console.log(`✅ Found ${relatedContentHeadings.length} Related Content heading(s)`);
    return true;
  }

  // Also check for any text blocks containing "Related Content"
  const textBlocks = response.children.filter(block =>
    block.type === 'paragraph' || block.type === 'bulleted_list_item'
  );

  const relatedContentText = textBlocks.filter(block => {
    const text = getBlockText(block);
    return text && text.toLowerCase().includes('related content');
  });

  if (relatedContentText.length > 0) {
    console.log(`✅ Found Related Content in text blocks`);
    return true;
  }

  return false;
}

// Extract text from a Notion block
function getBlockText(block) {
  if (!block[block.type] || !block[block.type].rich_text) {
    return null;
  }

  return block[block.type].rich_text
    .map(rt => rt.plain_text || '')
    .join('')
    .trim();
}

// Main automated testing loop
async function runAutomatedTest() {
  console.log('🚀 Starting Automated Related Content Fix Tester v2.0');
  console.log('=' .repeat(70));
  console.log('This will automatically test different filtering approaches.');
  console.log('Make sure the server is running on port 3004.');
  console.log('');

  // Check if server is running
  try {
    const healthCheck = await makeHttpRequest(`${CONFIG.serverUrl}/health`);
    if (healthCheck.statusCode !== 200) {
      console.log('❌ Server is not running or not responding. Please start the server first.');
      console.log('Run: npm start');
      process.exit(1);
    }
    console.log('✅ Server is running');
  } catch (error) {
    console.log('❌ Cannot connect to server. Please start the server first.');
    console.log('Run: npm start');
    process.exit(1);
  }

  let attempt = 0;
  const maxAttempts = FILTERING_APPROACHES.length;

  for (const approach of FILTERING_APPROACHES) {
    attempt++;
    console.log(`\n🔄 Attempt ${attempt}/${maxAttempts}`);

    const result = await testApproach(approach);

    if (result.success) {
      console.log(`\n🎉 SUCCESS FOUND!`);
      console.log(`Approach: ${approach.name}`);
      console.log(`Description: ${approach.description}`);
      console.log(`Related Content is now working!`);

      // Save the working approach
      const successFile = path.join(__dirname, 'working-approach.json');
      fs.writeFileSync(successFile, JSON.stringify({
        approach: approach.name,
        description: approach.description,
        timestamp: new Date().toISOString(),
        response: result.response
      }, null, 2));

      console.log(`✅ Working approach saved to: working-approach.json`);
      console.log(`\n📝 Next steps:`);
      console.log(`   1. The working code is already applied to src/content/content-extractor.js`);
      console.log(`   2. Build and deploy: npm run build`);
      console.log(`   3. Reload userscript in Tampermonkey`);
      console.log(`   4. Test extraction on Activate Procurement page`);

      process.exit(0);
    } else {
      console.log(`❌ Approach ${approach.name} failed, trying next...`);
      await sleep(CONFIG.delayBetweenTests);
    }
  }

  console.log('\n❌ All approaches tested, none successful.');
  console.log('Need to investigate further or add new approaches.');
  console.log('Check server logs for more debugging information.');
}

// Export for testing
module.exports = {
  runAutomatedTest,
  testApproach,
  applyApproach,
  checkForRelatedContent,
  FILTERING_APPROACHES,
  CONFIG
};

// Run if called directly
if (require.main === module) {
  runAutomatedTest().catch(console.error);
}