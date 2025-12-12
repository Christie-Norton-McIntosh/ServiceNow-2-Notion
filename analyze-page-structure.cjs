#!/usr/bin/env node

/**
 * Enhanced diagnostic to analyze the fetched HTML structure
 */

const axios = require('axios');
const { JSDOM } = require('jsdom');

async function analyzePageStructure(url) {
  console.log(`🔍 Enhanced ServiceNow Page Structure Analysis for: ${url}`);
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

    console.log(`📄 Total HTML length: ${html.length.toLocaleString()} characters`);

    // Find content element
    const contentElement = document.querySelector('main section');
    if (!contentElement) {
      console.log('❌ No content element found');
      return;
    }

    console.log(`📋 Content element found: ${contentElement.tagName}#${contentElement.id || 'no-id'}`);
    console.log(`   - Classes: ${contentElement.className}`);
    console.log(`   - Child elements: ${contentElement.children.length}`);
    console.log(`   - Inner HTML length: ${contentElement.innerHTML.length.toLocaleString()}`);

    // Analyze child elements
    console.log('\n🔍 Content element children:');
    Array.from(contentElement.children).forEach((child, idx) => {
      const childType = child.tagName.toLowerCase();
      const childId = child.id || 'no-id';
      const childClasses = child.className || 'no-classes';
      const childText = child.textContent.trim().substring(0, 100);
      const hasChildren = child.children.length > 0;

      console.log(`   ${idx + 1}. ${childType}#${childId} (.${childClasses})`);
      console.log(`      - Has children: ${hasChildren}`);
      console.log(`      - Text preview: "${childText}${childText.length > 100 ? '...' : ''}"`);
    });

    // Look for any scripts that might load content
    const scripts = document.querySelectorAll('script');
    console.log(`\n📜 Scripts found: ${scripts.length}`);

    const relevantScripts = Array.from(scripts).filter(script => {
      const src = script.src || '';
      const content = script.textContent || '';
      return src.includes('servicenow') || content.includes('contentPlaceholder') ||
             content.includes('Related') || content.includes('zDocs');
    });

    console.log(`   Relevant scripts: ${relevantScripts.length}`);
    relevantScripts.forEach((script, idx) => {
      const src = script.src || 'inline';
      console.log(`   ${idx + 1}. ${src}`);
      if (!script.src && script.textContent.length < 500) {
        console.log(`      Content: ${script.textContent.substring(0, 200)}...`);
      }
    });

    // Look for any data attributes or placeholders
    const allElements = document.querySelectorAll('*');
    const placeholderElements = Array.from(allElements).filter(el => {
      const className = el.className || '';
      const id = el.id || '';
      return className.includes && className.includes('placeholder') ||
             id.includes && id.includes('placeholder') ||
             el.getAttribute('data-placeholder') ||
             el.getAttribute('data-dynamic');
    });

    console.log(`\n🏷️  Placeholder-like elements: ${placeholderElements.length}`);
    placeholderElements.forEach((el, idx) => {
      console.log(`   ${idx + 1}. ${el.tagName}#${el.id || 'no-id'} (.${el.className || 'no-class'})`);
      console.log(`      - Attributes: ${Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`).join(', ')}`);
    });

    // Check for any elements with "related" in text or attributes
    const relatedElements = Array.from(allElements).filter(el => {
      const text = el.textContent.toLowerCase();
      const html = el.innerHTML.toLowerCase();
      const id = (el.id || '').toLowerCase();
      const className = (typeof el.className === 'string' ? el.className : '').toLowerCase();
      return text.includes('related') || html.includes('related') ||
             id.includes('related') || className.includes('related');
    });

    console.log(`\n🔗 Elements containing "related": ${relatedElements.length}`);
    relatedElements.forEach((el, idx) => {
      console.log(`   ${idx + 1}. ${el.tagName}#${el.id || 'no-id'} (.${el.className || 'no-class'})`);
      console.log(`      - Text: "${el.textContent.trim().substring(0, 150)}${el.textContent.length > 150 ? '...' : ''}"`);
    });

    // Check for iframe content
    const iframes = document.querySelectorAll('iframe');
    console.log(`\n🖼️  Iframes found: ${iframes.length}`);
    iframes.forEach((iframe, idx) => {
      console.log(`   ${idx + 1}. ${iframe.src || 'no-src'}`);
      console.log(`      - ID: ${iframe.id || 'no-id'}`);
      console.log(`      - Classes: ${iframe.className || 'no-class'}`);
    });

    console.log('\n✅ Analysis complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

if (require.main === module) {
  const url = process.argv[2] || 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/procurement/task/t_ActivateProcurement.html';
  analyzePageStructure(url);
}