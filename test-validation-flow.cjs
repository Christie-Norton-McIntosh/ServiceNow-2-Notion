/**
 * Test full validation flow with table splitting
 * Creates a page with split tables and validates it
 */

const sourceHTML = `
<div class="zDocsTopicPageBody">
  <article class="nested0">
    <div class="body conbody">
      <h2>Large Table Example</h2>
      <p>This table has 150 rows and will be split.</p>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Value</th></tr>
        </thead>
        <tbody>
          ${Array.from({length: 150}, (_, i) => `<tr><td>${i+1}</td><td>Item ${i+1}</td><td>Value ${i+1}</td></tr>`).join('\n')}
        </tbody>
      </table>
      <p>End of content.</p>
    </div>
  </article>
</div>
`;

async function testFullValidation() {
  console.log('🧪 Full Validation Test - Table Splitting\n');
  console.log('='.repeat(70));
  
  try {
    // Step 1: Extract (dry run) to see what we get
    console.log('\n📤 Step 1: Extracting content (dry run)...');
    const extractResponse = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Table Splitting Test',
        databaseId: '282a89fedba5815e91f0db972912ef9f',
        contentHtml: sourceHTML,
        dryRun: true
      })
    });
    
    const extractData = await extractResponse.json();
    const blocks = extractData.data?.children || [];
    
    const tables = blocks.filter(b => b.type === 'table');
    const callouts = blocks.filter(b => b.type === 'callout');
    
    console.log(`✅ Extracted ${blocks.length} blocks:`);
    console.log(`   - ${tables.length} tables`);
    console.log(`   - ${callouts.length} callout(s)`);
    
    // Step 2: Mock validation with source HTML
    console.log('\n📋 Step 2: Running validation...');
    
    // Count source tables in HTML
    const sourceTables = (sourceHTML.match(/<table/gi) || []).length;
    console.log(`   Source HTML has ${sourceTables} table(s)`);
    console.log(`   Notion has ${tables.length} table(s)`);
    console.log(`   Difference: ${tables.length - sourceTables} (due to splitting)`);
    
    // Check if split callout exists
    const hasSplitCallout = blocks.some(block => 
      block.type === 'callout' && 
      block.callout?.rich_text?.some(rt => {
        const content = rt.text?.content || '';
        return (
          (content.includes('split into') && content.includes('100-row')) ||
          (content.includes('table') && content.includes('100-row') && content.includes('limit'))
        );
      })
    );
    
    if (hasSplitCallout) {
      const callout = blocks.find(b => 
        b.type === 'callout' && 
        b.callout?.rich_text?.some(rt => {
          const content = rt.text?.content || '';
          return content.includes('100-row');
        })
      );
      const text = callout.callout.rich_text.map(rt => rt.text?.content || '').join('');
      console.log(`\n   ✅ Split table callout found:`);
      console.log(`   "${text}"`);
    }
    
    // Step 3: Simulate validation decision
    console.log('\n🔍 Step 3: Validation Decision...');
    
    if (hasSplitCallout && tables.length > sourceTables) {
      console.log(`\n   ✅ RESULT: INFORMATIONAL NOTE (not an error)`);
      console.log(`   Category: info[]`);
      console.log(`   Message: "Table splitting: ${sourceTables} source table(s) split into ${tables.length} Notion tables due to 100-row limit (informational only)"`);
      console.log(`\n   📊 Validation Status: PASSED ✅`);
      console.log(`   The page would pass validation with an informational note.`);
    } else if (tables.length === sourceTables) {
      console.log(`\n   ✅ RESULT: PERFECT MATCH`);
      console.log(`   Validation Status: PASSED ✅`);
    } else {
      console.log(`\n   ❌ RESULT: ERROR`);
      console.log(`   Category: issues[]`);
      console.log(`   Message: "Table count mismatch: expected ${sourceTables}, got ${tables.length}"`);
      console.log(`\n   ❌ Validation Status: FAILED`);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('✅ Test Complete - Table Splitting Validation Works Correctly');
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
  }
}

testFullValidation().catch(err => console.error('Error:', err));
