#!/usr/bin/env node

/**
 * Automated Related Content Fix Tester
 * Continuously attempts different approaches until Related Content appears in Notion
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Test HTML from Activate Procurement page (user will paste this)
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

const TEST_TITLE = 'Activate Procurement - Auto Test';
const TEST_DATABASE_ID = '2b2a89fedba58033a6aeee258611a908';

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
    execSync('npm run build', { stdio: 'inherit' });
    console.log('✅ Build successful');
    return true;
  } catch (error) {
    console.log('❌ Build failed:', error.message);
    return false;
  }
}

// Check if HTML contains placeholder markers
function checkHtmlForPlaceholders(html) {
  const hasDataWasPlaceholder = html.includes('data-was-placeholder="true"');
  const placeholderCount = (html.match(/data-was-placeholder="true"/g) || []).length;
  const hasRelatedContent = html.toLowerCase().includes('related content');

  return {
    hasDataWasPlaceholder,
    placeholderCount,
    hasRelatedContent
  };
}

// Main testing loop
async function runAutomatedTest() {
  console.log('🚀 Starting Automated Related Content Fix Tester');
  console.log('=' .repeat(60));
  console.log('This will try different filtering approaches until Related Content appears in Notion.');
  console.log('Make sure the server is running and you have Notion credentials configured.');
  console.log('');

  let attempt = 0;
  const maxAttempts = FILTERING_APPROACHES.length;

  for (const approach of FILTERING_APPROACHES) {
    attempt++;
    console.log(`\n🔄 Attempt ${attempt}/${maxAttempts}: ${approach.name}`);
    console.log(`📝 ${approach.description}`);

    try {
      // Apply the approach
      applyApproach(approach);

      // Build the userscript
      if (!buildUserscript()) {
        console.log(`❌ Build failed for ${approach.name}, skipping...`);
        continue;
      }

      console.log(`\n✅ ${approach.name} is ready for testing!`);
      console.log(`📝 Next steps:`);
      console.log(`   1. Reload userscript in Tampermonkey: https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/raw/main/dist/ServiceNow-2-Notion.user.js`);
      console.log(`   2. Extract the Activate Procurement page`);
      console.log(`   3. Check server logs for Related Content processing`);
      console.log(`   4. Verify Related Content appears in Notion page`);
      console.log(`   5. If successful, run this script again to confirm and stop`);
      console.log(`   6. If not successful, run this script again to try next approach`);

      // Wait for user input
      console.log(`\n⏳ Waiting for manual testing of ${approach.name}...`);
      console.log(`Press Enter when you've tested this approach (successful or not):`);

      // In a real automated system, this would poll Notion API
      // For now, we wait for user confirmation
      process.stdin.once('data', () => {
        console.log(`📊 Please report the results for ${approach.name}:`);
        console.log(`   - Did Related Content appear in Notion? (y/n):`);

        process.stdin.once('data', (data) => {
          const result = data.toString().trim().toLowerCase();
          if (result === 'y' || result === 'yes') {
            console.log(`\n🎉 SUCCESS! ${approach.name} works!`);
            console.log(`✅ Related Content is now visible in Notion pages.`);
            process.exit(0);
          } else {
            console.log(`❌ ${approach.name} did not work, trying next approach...`);
            // Continue to next iteration
          }
        });
      });

      // Wait for user input before continuing
      await new Promise(resolve => {
        process.stdin.once('data', resolve);
      });

    } catch (error) {
      console.log(`❌ Error with ${approach.name}: ${error.message}`);
      continue;
    }
  }

  console.log('\n❌ All approaches tested, none successful.');
  console.log('Need to investigate further or add new approaches.');
}

// Export for testing
module.exports = {
  runAutomatedTest,
  applyApproach,
  FILTERING_APPROACHES,
  checkHtmlForPlaceholders
};

// Run if called directly
if (require.main === module) {
  runAutomatedTest().catch(console.error);
}