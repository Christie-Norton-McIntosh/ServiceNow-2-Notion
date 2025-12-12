#!/usr/bin/env node

/**
 * Diagnostic script to check Related Content extraction in live ServiceNow pages
 * Run this in browser console on a ServiceNow page to debug extraction issues
 */

console.log('🔍 ServiceNow-2-Notion Related Content Diagnostic');
console.log('================================================');

// Check 1: Find content element
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

// Check 3: Wait for Related Content to load (like the userscript does)
async function waitForRelatedContent() {
  console.log('⏳ Waiting for Related Content to load (10s timeout)...');

  return new Promise((resolve) => {
    const startTime = Date.now();
    const maxWaitMs = 10000;

    const checkRelatedContent = () => {
      const placeholders = document.querySelectorAll('.contentPlaceholder') || [];
      for (const placeholder of placeholders) {
        const h5 = placeholder.querySelector('h5');
        if (h5 && h5.textContent.toLowerCase().includes('related content')) {
          return true;
        }
      }
      return false;
    };

    if (checkRelatedContent()) {
      console.log('✅ Related Content already present');
      resolve();
      return;
    }

    const observer = new MutationObserver(() => {
      if (checkRelatedContent()) {
        console.log(`✅ Related Content appeared after ${Date.now() - startTime}ms`);
        observer.disconnect();
        resolve();
      } else if (Date.now() - startTime > maxWaitMs) {
        console.log(`⏱️ Timeout after ${maxWaitMs}ms - Related Content did not appear`);
        observer.disconnect();
        resolve();
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    setTimeout(() => {
      observer.disconnect();
      resolve();
    }, maxWaitMs);
  });
}

// Check 4: Simulate content extraction
async function simulateExtraction() {
  console.log('🔄 Simulating content extraction...');

  const contentElement = findContentElement();
  if (!contentElement) {
    console.log('❌ Cannot simulate extraction - no content element found');
    return;
  }

  // Wait for Related Content
  await waitForRelatedContent();

  // Check placeholders again after waiting
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
      // Simulate the serialization process
      const tempContainer = document.createElement('div');
      tempContainer.style.display = 'block';
      const clone = p.cloneNode(true);
      const allElements = [clone, ...clone.querySelectorAll('*')];
      allElements.forEach(el => {
        el.setAttribute('style', 'display: block !important; visibility: visible !important; position: static !important; opacity: 1 !important;');
      });
      clone.classList.remove('contentPlaceholder');
      clone.setAttribute('data-was-placeholder', 'true');

      tempContainer.appendChild(clone);
      document.body.appendChild(tempContainer);
      const serializedHtml = clone.outerHTML;
      document.body.removeChild(tempContainer);

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
async function runDiagnostics() {
  console.log('🚀 Starting Related Content diagnostics...\n');

  console.log('1️⃣ Finding content element:');
  findContentElement();
  console.log('');

  console.log('2️⃣ Checking Related Content placeholders:');
  checkRelatedContentPlaceholders();
  console.log('');

  console.log('3️⃣ Simulating extraction:');
  const extractedHtml = await simulateExtraction();
  console.log('');

  console.log('📋 SUMMARY:');
  console.log(`   - Content element found: ${!!findContentElement()}`);
  console.log(`   - Related Content placeholders: ${document.querySelectorAll('.contentPlaceholder').length}`);
  console.log(`   - Related Content in DOM: ${Array.from(document.querySelectorAll('.contentPlaceholder')).some(p => p.querySelector('h5')?.textContent.toLowerCase().includes('related content'))}`);
  console.log(`   - Extracted HTML length: ${extractedHtml?.length || 0}`);
  console.log(`   - Related Content in extracted HTML: ${extractedHtml?.toLowerCase().includes('related content') || false}`);

  console.log('\n✅ Diagnostics complete!');
  console.log('Copy the extracted HTML above and compare with test fixture if needed.');
}

// Auto-run if this script is executed
if (typeof window !== 'undefined') {
  runDiagnostics();
}

export { runDiagnostics, findContentElement, checkRelatedContentPlaceholders, waitForRelatedContent, simulateExtraction };