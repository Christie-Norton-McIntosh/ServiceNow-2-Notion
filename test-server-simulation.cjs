#!/usr/bin/env node

/**
 * Server-Side Processing Test
 * Test what the server does with the HTML sent by the client
 */

const fs = require('fs');
const path = require('path');

// Import server modules (simulate what the server does)
function simulateServerProcessing(html) {
  console.log('🔍 Simulating server-side processing...');

  // Find data-was-placeholder divs (what the client sends)
  const placeholderRegex = /<div[^>]*data-was-placeholder="true"[^>]*>([\s\S]*?)<\/div>/gi;
  const placeholders = [];
  let match;

  while ((match = placeholderRegex.exec(html)) !== null) {
    placeholders.push(match[1]); // Extract inner HTML
  }

  console.log(`📊 Found ${placeholders.length} data-was-placeholder divs`);

  // Process each placeholder (simulate what servicenow.cjs does)
  placeholders.forEach((placeholderHtml, index) => {
    console.log(`\n🔍 Processing placeholder ${index + 1}:`);
    console.log(`📄 HTML length: ${placeholderHtml.length}`);

    // Check for H5 elements (this is what the server looks for)
    const h5Regex = /<h5[^>]*>([\s\S]*?)<\/h5>/gi;
    const h5Matches = [];
    let h5Match;

    while ((h5Match = h5Regex.exec(placeholderHtml)) !== null) {
      h5Matches.push(h5Match[1].trim());
    }

    console.log(`📊 Found ${h5Matches.length} H5 elements:`);
    h5Matches.forEach((h5, i) => {
      console.log(`   H5 ${i + 1}: "${h5}"`);
      if (h5.toLowerCase().includes('related content')) {
        console.log(`   ✅ This is Related Content!`);
      }
    });

    // Check for list items
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    const liMatches = [];
    let liMatch;

    while ((liMatch = liRegex.exec(placeholderHtml)) !== null) {
      liMatches.push(liMatch[1].trim());
    }

    console.log(`📊 Found ${liMatches.length} list items`);
    if (liMatches.length > 0) {
      console.log(`   Sample LI: "${liMatches[0].substring(0, 100)}..."`);
    }

    // Check if this placeholder has the structure we expect
    const hasRelatedContentH5 = h5Matches.some(h5 => h5.toLowerCase().includes('related content'));
    const hasListItems = liMatches.length > 0;

    if (hasRelatedContentH5 && hasListItems) {
      console.log(`✅ This placeholder has Related Content structure!`);
      return true;
    } else {
      console.log(`❌ This placeholder missing Related Content structure`);
      console.log(`   - Has Related Content H5: ${hasRelatedContentH5}`);
      console.log(`   - Has list items: ${hasListItems}`);
      return false;
    }
  });

  return placeholders.length > 0 && placeholders.some(p => {
    const hasH5 = /<h5[^>]*>[\s\S]*?<\/h5>/i.test(p);
    const hasRelatedContent = /related content/i.test(p);
    const hasList = /<li[^>]*>[\s\S]*?<\/li>/i.test(p);
    return hasH5 && hasRelatedContent && hasList;
  });
}

// Test with the HTML that the client filtering test generates
function runServerSimulationTest() {
  console.log('🧪 Server-Side Processing Simulation Test');
  console.log('=' .repeat(50));

  // Read the test HTML fixture
  const testHtmlPath = path.join(__dirname, 'tests/fixtures/activate-procurement-with-placeholders.html');
  const originalHtml = fs.readFileSync(testHtmlPath, 'utf8');

  console.log(`📄 Original HTML length: ${originalHtml.length}`);

  // Simulate what the client does (from the filtering test)
  function simulateClientProcessing(html) {
    // Find all content placeholders
    const placeholderRegex = /<div[^>]*class="[^"]*contentPlaceholder[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const placeholders = [];
    let match;

    while ((match = placeholderRegex.exec(html)) !== null) {
      placeholders.push({
        fullMatch: match[0],
        innerHtml: match[1]
      });
    }

    console.log(`🔍 Found ${placeholders.length} contentPlaceholder divs`);

    // Apply filtering logic (from v11.0.241)
    const filteredPlaceholders = placeholders.filter(p => {
      const headings = [];
      // Extract headings from inner HTML
      const h5Match = p.innerHtml.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
      if (h5Match) headings.push(h5Match[1].trim());

      // Check if this is Related Content (KEEP IT)
      const hasRelatedContent = headings.some(h => h.toLowerCase() === 'related content');

      if (hasRelatedContent) {
        console.log(`✅ Keeping placeholder: Related Content detected`);
        return true;
      }

      // Check if this is Mini TOC (FILTER IT OUT)
      const hasMiniTocClass = p.fullMatch.includes('zDocsMiniTocCollapseButton');
      const hasMiniTocText = p.innerHtml.toLowerCase().includes('mini toc') || p.innerHtml.toLowerCase().includes('minitoc');

      if (hasMiniTocClass || hasMiniTocText) {
        console.log(`🔍 Filtering out placeholder: hasMiniTocClass=${hasMiniTocClass}, hasMiniTocText=${hasMiniTocText}`);
        return false;
      }

      // Keep any other placeholders by default
      return true;
    });

    console.log(`🔍 After filtering: ${filteredPlaceholders.length} placeholders remaining`);

    // Process filtered placeholders (add data-was-placeholder)
    let resultHtml = html;
    filteredPlaceholders.forEach(p => {
      // Replace the original div with data-was-placeholder version
      const originalDiv = p.fullMatch;
      const placeholderDiv = originalDiv.replace(
        /class="[^"]*contentPlaceholder[^"]*"/,
        'class="contentPlaceholder" data-was-placeholder="true"'
      ).replace(
        /style="[^"]*"/,
        'style="display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;"'
      );

      resultHtml = resultHtml.replace(originalDiv, placeholderDiv);
    });

    return resultHtml;
  }

  // Process HTML through client simulation
  const clientProcessedHtml = simulateClientProcessing(originalHtml);
  console.log(`\n📄 Client processed HTML length: ${clientProcessedHtml.length}`);

  // Check what the client sends to server
  const dataWasPlaceholderCount = (clientProcessedHtml.match(/data-was-placeholder="true"/g) || []).length;
  console.log(`📊 Client sends ${dataWasPlaceholderCount} data-was-placeholder divs to server`);

  // Simulate server processing
  const serverSuccess = simulateServerProcessing(clientProcessedHtml);

  if (serverSuccess) {
    console.log(`\n🎉 SUCCESS! Server can process Related Content from client HTML.`);
    console.log(`The issue is NOT in the client filtering or server parsing.`);
    console.log(`Check server logs for other issues (rate limiting, API errors, etc.).`);
  } else {
    console.log(`\n❌ FAILURE: Server cannot find Related Content in client HTML.`);
    console.log(`The issue is in the client→server data flow.`);

    // Save the processed HTML for debugging
    const debugFile = path.join(__dirname, 'debug-client-processed.html');
    fs.writeFileSync(debugFile, clientProcessedHtml);
    console.log(`📄 Client processed HTML saved to: ${debugFile}`);
  }
}

// Run if called directly
if (require.main === module) {
  runServerSimulationTest();
}