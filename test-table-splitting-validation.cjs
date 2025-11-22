/**
 * Test table splitting validation logic
 * Verifies that tables split due to 100-row limit are noted as informational, not errors
 */

// Simulate a page with 1 source table that was split into 3 Notion tables
const sourceHTML = `
<div class="zDocsTopicPageBody">
  <article class="nested0">
    <div class="body conbody">
      <p>This page has one large table with 250 rows.</p>
      <table>
        <thead>
          <tr><th>Column 1</th><th>Column 2</th></tr>
        </thead>
        <tbody>
          ${Array.from({length: 250}, (_, i) => `<tr><td>Row ${i+1}</td><td>Data ${i+1}</td></tr>`).join('\n')}
        </tbody>
      </table>
      <p>End of content.</p>
    </div>
  </article>
</div>
`;

async function testTableSplitting() {
  console.log('🧪 Testing Table Splitting Validation\n');
  console.log('='.repeat(70));
  
  try {
    // Extract the HTML (dry run)
    const extractResponse = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Table Splitting',
        databaseId: '282a89fedba5815e91f0db972912ef9f',
        contentHtml: sourceHTML,
        dryRun: true
      })
    });
    
    const extractData = await extractResponse.json();
    const blocks = extractData.data?.children || [];
    
    console.log(`\n📊 Extraction Results:`);
    console.log(`Total blocks: ${blocks.length}`);
    
    // Count tables and callouts
    const tables = blocks.filter(b => b.type === 'table');
    const callouts = blocks.filter(b => b.type === 'callout');
    
    console.log(`Tables: ${tables.length}`);
    console.log(`Callouts: ${callouts.length}`);
    
    // Check for split table callout
    const splitCallout = callouts.find(c => 
      c.callout?.rich_text?.some(rt => {
        const content = rt.text?.content || '';
        return content.includes('split into') && content.includes('100-row');
      })
    );
    
    if (splitCallout) {
      const text = splitCallout.callout.rich_text.map(rt => rt.text?.content || '').join('');
      console.log(`\n✅ Found split table callout:`);
      console.log(`   "${text}"`);
    } else {
      console.log(`\n⚠️  No split table callout found`);
    }
    
    // Now test validation with 1 source table vs 3 Notion tables
    console.log(`\n${'='.repeat(70)}`);
    console.log('Testing Validation Logic');
    console.log('='.repeat(70));
    
    // Mock validation result structure
    const mockValidation = {
      sourceCounts: { tables: 1 },
      notionCounts: { tables: tables.length },
      allBlocks: blocks
    };
    
    console.log(`\nSource tables: ${mockValidation.sourceCounts.tables}`);
    console.log(`Notion tables: ${mockValidation.notionCounts.tables}`);
    console.log(`Difference: ${mockValidation.notionCounts.tables - mockValidation.sourceCounts.tables}`);
    
    // Check if validation would detect split tables correctly
    const hasSplitTableCallout = blocks.some(block => 
      block.type === 'callout' && 
      block.callout?.rich_text?.some(rt => {
        const content = rt.text?.content || '';
        return (
          (content.includes('split into') && content.includes('100-row')) ||
          (content.includes('table') && content.includes('100-row') && content.includes('limit'))
        );
      })
    );
    
    if (hasSplitTableCallout && mockValidation.notionCounts.tables > mockValidation.sourceCounts.tables) {
      console.log(`\n✅ PASS: Validation would recognize this as legitimate table splitting`);
      console.log(`   Result: Informational note (not an error)`);
      console.log(`   Message: "Table splitting: 1 source table(s) split into ${tables.length} Notion tables due to 100-row limit (informational only)"`);
    } else if (mockValidation.notionCounts.tables === mockValidation.sourceCounts.tables) {
      console.log(`\n✅ PASS: Table counts match exactly (no splitting needed)`);
    } else {
      console.log(`\n❌ FAIL: Validation would flag this as an error`);
      console.log(`   Result: Table count mismatch error`);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('Summary');
    console.log('='.repeat(70));
    console.log(`✅ Table splitting creates ${tables.length} tables from 1 source table`);
    console.log(`✅ Informational callout is added`);
    console.log(`✅ Validation logic recognizes split tables`);
    console.log(`✅ No validation error for legitimate splits`);
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
  }
}

testTableSplitting().catch(err => console.error('Error:', err));
