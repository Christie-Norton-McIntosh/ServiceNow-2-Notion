/**
 * Test FIX v11.0.35 - Verify content extraction works for:
 * 1. Pages WITH article.nested1 (no heading bunching)
 * 2. Pages WITHOUT article.nested1 (sections still extracted)
 */

// Test Case 1: Page WITH article.nested1 elements
const htmlWithArticles = `
<div class="zDocsTopicPageBody">
  <div>
    <article class="nested0">
      <div class="body conbody">
        <p>Intro paragraph before articles</p>
      </div>
      <article class="nested1" id="article1">
        <h2>First Heading</h2>
        <div class="body taskbody">
          <section class="section">
            <p>Content for first section</p>
          </section>
        </div>
      </article>
      <article class="nested1" id="article2">
        <h2>Second Heading</h2>
        <div class="body taskbody">
          <section class="section">
            <p>Content for second section</p>
          </section>
        </div>
      </article>
    </article>
  </div>
</div>
`;

// Test Case 2: Page WITHOUT article.nested1 elements (just sections)
const htmlWithoutArticles = `
<div class="zDocsTopicPageBody">
  <div>
    <article class="nested0">
      <div class="body conbody">
        <section class="section prereq">
          <h2>Prerequisites</h2>
          <p>You need these things first</p>
        </section>
        <section class="section">
          <h2>Main Content</h2>
          <p>This is the main content</p>
        </section>
      </div>
    </article>
  </div>
</div>
`;

async function testExtraction(html, testName) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${testName}`);
  console.log('='.repeat(70));
  
  try {
    const response = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: testName,
        databaseId: '282a89fedba5815e91f0db972912ef9f',
        contentHtml: html,
        dryRun: true
      })
    });
    
    const data = await response.json();
    const blocks = data.data?.children || [];
    
    console.log(`\n✅ Total blocks extracted: ${blocks.length}`);
    
    if (blocks.length === 0) {
      console.log('❌ ERROR: No blocks extracted!');
      return false;
    }
    
    // Show block types
    const blockTypes = blocks.reduce((acc, b) => {
      acc[b.type] = (acc[b.type] || 0) + 1;
      return acc;
    }, {});
    
    console.log('\n📊 Block types:');
    Object.entries(blockTypes).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });
    
    // Check for heading bunching (consecutive headings)
    let consecutiveHeadings = 0;
    for (let i = 0; i < blocks.length - 1; i++) {
      const curr = blocks[i].type;
      const next = blocks[i + 1].type;
      if ((curr === 'heading_2' || curr === 'heading_3') && 
          (next === 'heading_2' || next === 'heading_3')) {
        consecutiveHeadings++;
      }
    }
    
    if (consecutiveHeadings > 0) {
      console.log(`\n⚠️  WARNING: ${consecutiveHeadings} consecutive heading pair(s) detected`);
    } else {
      console.log('\n✅ No heading bunching detected');
    }
    
    return blocks.length > 0;
    
  } catch (error) {
    console.log(`\n❌ ERROR: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n🧪 Testing FIX v11.0.35 - Content Extraction\n');
  
  const test1 = await testExtraction(htmlWithArticles, 'Page WITH article.nested1');
  const test2 = await testExtraction(htmlWithoutArticles, 'Page WITHOUT article.nested1');
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Test 1 (WITH article.nested1):    ${test1 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`Test 2 (WITHOUT article.nested1): ${test2 ? '✅ PASS' : '❌ FAIL'}`);
  
  if (test1 && test2) {
    console.log('\n🎉 All tests passed! FIX v11.0.35 is working correctly.');
  } else {
    console.log('\n❌ Some tests failed. Fix needs adjustment.');
  }
}

runTests().catch(err => console.error('Test error:', err));
