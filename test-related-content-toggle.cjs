#!/usr/bin/env node
/**
 * Test "Related Content" heading toggle conversion
 * 
 * This test verifies that headings containing "Related Content" are converted to
 * H3 toggles with content nested inside, instead of regular headings.
 */

const fs = require('fs');
const path = require('path');

// Test HTML with "Related Content" section
const testHtml = `
<div class="zDocsTopicPageBody">
  <article>
    <h2>Overview</h2>
    <p>This is the overview section with some content.</p>
    
    <h2>Features</h2>
    <p>Some feature information here.</p>
  </article>
  
  <div class="contentPlaceholder">
    <h2>Related Content</h2>
    <ul>
      <li><a href="/page1">Related Page 1</a></li>
      <li><a href="/page2">Related Page 2</a></li>
      <li><a href="/page3">Related Page 3</a></li>
    </ul>
    
    <h3>Related content</h3>
    <p>Another related content section (different case).</p>
    <ul>
      <li><a href="/page4">Related Page 4</a></li>
    </ul>
  </div>
</div>
`;

async function testRelatedContentToggle() {
  console.log('🧪 Testing "Related Content" toggle conversion...\n');
  
  try {
    const response = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Related Content Toggle',
        databaseId: '18f0a4f8134c804023f052e6feaad39e',
        contentHtml: testHtml,
        dryRun: true,
      }),
    });
    
    if (!response.ok) {
      console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
      const text = await response.text();
      console.error(text);
      process.exit(1);
    }
    
    const result = await response.json();
    
    // Handle wrapped response (success/data structure)
    const children = result.children || result.data?.children || [];
    
    if (children.length === 0) {
      console.error('❌ No children in response');
      console.log('Full response:', JSON.stringify(result, null, 2));
      process.exit(1);
    }
    
    console.log(`✅ Response has ${children.length} blocks\n`);
    
    // Find heading blocks
    const headings = children.filter(b => 
      b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3'
    );
    
    console.log(`📊 Found ${headings.length} heading blocks:\n`);
    
    headings.forEach((heading, idx) => {
      const level = heading.type.split('_')[1];
      const richText = heading[heading.type].rich_text;
      const text = richText.map(rt => rt.plain_text || rt.text?.content || '').join('');
      const isToggleable = heading[heading.type].is_toggleable;
      const hasChildren = heading.children && heading.children.length > 0;
      
      console.log(`  ${idx + 1}. ${heading.type.toUpperCase()}: "${text}"`);
      console.log(`     - Toggleable: ${isToggleable ? '✅ YES' : '❌ NO'}`);
      console.log(`     - Children: ${hasChildren ? `✅ ${heading.children.length} blocks` : '❌ None'}`);
      
      if (hasChildren) {
        console.log(`     - Child types: ${heading.children.map(c => c.type).join(', ')}`);
      }
      console.log('');
    });
    
    // Verify expectations
    const relatedContentHeadings = headings.filter(h => {
      const text = h[h.type].rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('');
      return /related\s+content/i.test(text);
    });
    
    console.log(`\n🔍 Verification:\n`);
    console.log(`  - Found ${relatedContentHeadings.length} "Related Content" headings`);
    
    if (relatedContentHeadings.length === 0) {
      console.error('  ❌ FAIL: No "Related Content" headings found');
      process.exit(1);
    }
    
    let allToggles = true;
    let allH3 = true;
    let allHaveMarkers = true;
    
    relatedContentHeadings.forEach((heading, idx) => {
      const text = heading[heading.type].rich_text.map(rt => rt.plain_text || rt.text?.content || '').join('');
      const isToggleable = heading[heading.type].is_toggleable;
      const hasMarker = /sn2n:marker:/.test(text);
      const isH3 = heading.type === 'heading_3';
      
      if (!isToggleable) {
        console.error(`  ❌ FAIL: "${text}" is not toggleable`);
        allToggles = false;
      }
      
      if (!isH3) {
        console.error(`  ❌ FAIL: "${text}" is ${heading.type}, not heading_3`);
        allH3 = false;
      }
      
      if (!hasMarker) {
        console.error(`  ❌ FAIL: "${text}" has no marker (children won't be appended)`);
        allHaveMarkers = false;
      } else {
        console.log(`  ✅ PASS: "${text.substring(0, 30)}..." has marker for orchestration`);
      }
    });
    
    // Note: In dryRun mode, children aren't appended (no page to PATCH)
    // Children will be appended via orchestration during actual page creation
    console.log('\n  ℹ️  Note: In dryRun mode, children are NOT appended (no page exists to PATCH)');
    console.log('  ℹ️  Children will be appended via orchestration during actual page creation\n');
    
    if (allToggles && allH3 && allHaveMarkers) {
      console.log('  ✅ PASS: All "Related Content" headings are H3 toggles with markers\n');
    } else {
      console.error('\n  ❌ FAIL: Some requirements not met\n');
      process.exit(1);
    }
    
    // Save results for inspection
    const outputPath = path.join(__dirname, 'test-related-content-output.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`💾 Full output saved to: ${outputPath}\n`);
    
    console.log('✅ All tests passed!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testRelatedContentToggle();
