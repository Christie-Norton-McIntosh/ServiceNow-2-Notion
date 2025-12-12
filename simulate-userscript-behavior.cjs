#!/usr/bin/env node

/**
 * Advanced diagnostic that simulates the actual userscript behavior
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

async function simulateUserscriptBehavior(url) {
  console.log(`🔬 ServiceNow-2-Notion Userscript Behavior Simulation for: ${url}`);
  console.log('================================================================');

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });

    const html = response.data;
    const dom = new JSDOM(html);
    const document = dom.window.document;

    console.log(`📄 Fetched HTML: ${html.length.toLocaleString()} characters`);

    // Simulate findContentElement() from userscript
    function findContentElement() {
      console.log("🔍 Simulating findContentElement()...");

      const contentSelectors = [
        "#zDocsContent > div.zDocsTopicPageBody",
        ".zDocsTopicPageBody",
        "#zDocsContent .zDocsTopicPageBody",
        "main[role='main']",
        "main",
        "[role='main']",
        ".main-content",
        ".content-main",
        "#main-content",
        "#content",
        ".content",
        "article",
        ".article-body",
        ".article-content",
        ".post-content",
        ".entry-content",
        ".book-content",
        ".documentation",
        ".docs-content",
        ".container-main",
        "#container",
        ".wrapper-main",
      ];

      for (const selector of contentSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          console.log(`✅ Found content element with selector: "${selector}"`);
          console.log(`   - Tag: ${element.tagName}`);
          console.log(`   - ID: ${element.id || 'none'}`);
          console.log(`   - Classes: ${element.className || 'none'}`);
          console.log(`   - Inner HTML length: ${element.innerHTML.length.toLocaleString()}`);
          return element;
        }
      }

      console.log('❌ No content element found with any selector');
      return null;
    }

    // Simulate the Related Content waiting logic
    function simulateRelatedContentWait() {
      console.log('\n⏳ Simulating Related Content waiting logic...');

      // Check current state
      const placeholders = document.querySelectorAll('.contentPlaceholder');
      console.log(`📍 Current contentPlaceholder count: ${placeholders.length}`);

      const relatedPlaceholders = Array.from(placeholders).filter(p => {
        const h5 = p.querySelector('h5');
        return h5 && h5.textContent.trim().toLowerCase() === 'related content';
      });
      console.log(`🔗 Current Related Content placeholders: ${relatedPlaceholders.length}`);

      if (relatedPlaceholders.length > 0) {
        console.log('✅ Related Content already present in static HTML!');
        return { found: true, placeholders: relatedPlaceholders };
      }

      console.log('❌ Related Content NOT found in static HTML - would wait for dynamic loading');

      // Check what WOULD happen if Related Content loaded dynamically
      console.log('\n🔮 Simulating what happens when Related Content loads...');

      // Look for potential insertion points
      const zDocsContent = document.querySelector('#zDocsContent');
      const zDocsBody = document.querySelector('.zDocsTopicPageBody');

      console.log(`📍 Potential insertion points:`);
      console.log(`   - #zDocsContent exists: ${!!zDocsContent}`);
      console.log(`   - .zDocsTopicPageBody exists: ${!!zDocsBody}`);

      if (zDocsBody) {
        console.log(`   - .zDocsTopicPageBody children: ${zDocsBody.children.length}`);
        console.log(`   - .zDocsTopicPageBody innerHTML length: ${zDocsBody.innerHTML.length.toLocaleString()}`);
      }

      return { found: false, placeholders: [] };
    }

    // Run the simulation
    console.log('1️⃣ Finding content element:');
    const contentElement = findContentElement();
    console.log('');

    console.log('2️⃣ Checking Related Content state:');
    const relatedContentState = simulateRelatedContentWait();
    console.log('');

    console.log('3️⃣ Analyzing the issue:');
    if (!contentElement) {
      console.log('❌ ROOT CAUSE: No content element found - userscript would fail here');
    } else if (!relatedContentState.found) {
      console.log('❌ ROOT CAUSE: Related Content not in static HTML - userscript would wait for dynamic loading');
      console.log('');
      console.log('🔍 DYNAMIC LOADING ANALYSIS:');
      console.log('   - Userscript uses MutationObserver to watch for .contentPlaceholder elements');
      console.log('   - Waits up to 10 seconds for Related Content to appear');
      console.log('   - If it appears, processes it; if not, continues without it');
      console.log('   - The issue might be:');
      console.log('     1. Related Content loads after 10s timeout');
      console.log('     2. Related Content uses different selectors/structure');
      console.log('     3. JavaScript is disabled/blocked in browser');
      console.log('     4. Page structure changed and selectors need updating');
    } else {
      console.log('✅ Related Content found - userscript should work correctly');
    }

    console.log('');
    console.log('📋 SUMMARY:');
    console.log(`   - Content element found: ${!!contentElement}`);
    console.log(`   - Related Content in static HTML: ${relatedContentState.found}`);
    console.log(`   - Would wait for dynamic loading: ${!relatedContentState.found}`);
    console.log(`   - Expected userscript behavior: ${relatedContentState.found ? 'Extract immediately' : 'Wait up to 10s for dynamic content'}`);

    // Additional analysis
    console.log('\n🔍 ADDITIONAL ANALYSIS:');

    // Check for any scripts that might load content
    const scripts = document.querySelectorAll('script');
    const zoominScripts = Array.from(scripts).filter(s =>
      s.src && s.src.includes('zoominsoftware')
    );
    console.log(`   - Zoomin scripts (likely content loader): ${zoominScripts.length}`);

    // Check for any elements that might be containers for dynamic content
    const containers = document.querySelectorAll('[data-dynamic], [data-load], [data-src]');
    console.log(`   - Elements with dynamic loading attributes: ${containers.length}`);

    console.log('\n✅ Simulation complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  const url = process.argv[2] || 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/procurement/task/t_ActivateProcurement.html';
  simulateUserscriptBehavior(url);
}