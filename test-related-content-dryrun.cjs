#!/usr/bin/env node

/**
 * Dry-run test for Related Content extraction
 * Repeatedly tests extraction until "Related Content" section is found
 */

const fs = require('fs');
const path = require('path');

async function testRelatedContent() {
  console.log('\n🔍 Testing Related Content extraction with dry-run...\n');

  // Read the most recent HTML from saved export
  const htmlPath = path.join(__dirname, 'test-related-content-input.html');
  
  if (!fs.existsSync(htmlPath)) {
    console.log('❌ No test HTML found!');
    console.log('📋 Steps to create test file:');
    console.log('   1. Extract a page with Related Content in the browser');
    console.log('   2. In browser console, run: copy(window.DEBUG_LAST_EXPORT_HTML)');
    console.log('   3. Save to: test-related-content-input.html');
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  console.log(`✅ Loaded HTML: ${html.length} characters`);
  
  // Check if raw HTML contains Related Content
  const hasDataWasPlaceholder = html.includes('data-was-placeholder="true"');
  const hasRelatedContentText = html.toLowerCase().includes('related content');
  const hasH5Tag = html.includes('<h5');
  
  console.log('\n📊 Raw HTML Analysis:');
  console.log(`   - Contains data-was-placeholder: ${hasDataWasPlaceholder}`);
  console.log(`   - Contains "related content" text: ${hasRelatedContentText}`);
  console.log(`   - Contains <h5> tags: ${hasH5Tag}`);
  
  if (hasDataWasPlaceholder && hasRelatedContentText && hasH5Tag) {
    // Find the data-was-placeholder div
    const placeholderMatch = html.match(/<div[^>]*data-was-placeholder="true"[^>]*>[\s\S]*?<\/div>/);
    if (placeholderMatch) {
      const placeholderHtml = placeholderMatch[0];
      console.log(`\n📦 Found data-was-placeholder div: ${placeholderHtml.length} chars`);
      
      // Check for H5 inside
      const h5Match = placeholderHtml.match(/<h5[^>]*>([^<]*)<\/h5>/);
      if (h5Match) {
        console.log(`   ✅ Contains H5: "${h5Match[1]}"`);
      } else {
        console.log(`   ❌ No H5 found inside div!`);
      }
      
      // Show first 500 chars
      console.log(`\n📄 Placeholder div preview (first 500 chars):`);
      console.log(placeholderHtml.substring(0, 500));
    }
  }

  // Send dry-run request
  console.log('\n🌐 Sending dry-run request to server...\n');
  
  const payload = {
    title: 'Test: Related Content Extraction',
    databaseId: 'test-database-id',
    contentHtml: html,
    url: 'https://test.servicenow.com/test',
    dryRun: true
  };

  try {
    const response = await fetch('http://127.0.0.1:3004/api/W2N', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    console.log('✅ Dry-run completed!\n');
    console.log(`📊 Blocks created: ${result.children ? result.children.length : 0}`);
    
    if (result.children && result.children.length > 0) {
      // Check for Related Content heading
      const relatedContentHeading = result.children.find(block => 
        block.type === 'heading_3' && 
        block.heading_3?.rich_text?.some(rt => rt.text.content.includes('Related Content'))
      );
      
      if (relatedContentHeading) {
        console.log('🎉 SUCCESS! Found "Related Content" heading block!');
        
        // Count list items after the heading
        const headingIndex = result.children.indexOf(relatedContentHeading);
        const listItemsAfter = result.children.slice(headingIndex + 1).filter(b => b.type === 'bulleted_list_item');
        console.log(`   📋 Followed by ${listItemsAfter.length} list items`);
        
        return true;
      } else {
        console.log('❌ "Related Content" heading NOT found in blocks');
        
        // Show what headings we DID find
        const headings = result.children.filter(b => b.type.startsWith('heading'));
        if (headings.length > 0) {
          console.log('\n📝 Found these headings instead:');
          headings.forEach((h, i) => {
            const text = h[h.type]?.rich_text?.[0]?.text?.content || '(empty)';
            console.log(`   ${i+1}. ${text}`);
          });
        }
        
        return false;
      }
    } else {
      console.log('❌ No blocks created!');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

// Run the test
testRelatedContent().then(success => {
  process.exit(success ? 0 : 1);
});
