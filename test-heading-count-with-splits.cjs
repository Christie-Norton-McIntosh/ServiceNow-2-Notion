/**
 * Test heading count validation with table splitting continuation headings
 */

const sourceHTML = `
<div class="zDocsTopicPageBody">
  <article class="nested0">
    <div class="body conbody">
      <h2>Main Heading 1</h2>
      <p>This page has 3 headings in the source and a large table.</p>
      
      <h2>Main Heading 2</h2>
      <p>Here's a table with 250 rows that will be split into 3 tables.</p>
      
      <table>
        <thead>
          <tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr>
        </thead>
        <tbody>
          ${Array.from({length: 250}, (_, i) => `<tr><td>Row ${i+1}</td><td>Data ${i+1}</td><td>Value ${i+1}</td></tr>`).join('\n')}
        </tbody>
      </table>
      
      <h2>Main Heading 3</h2>
      <p>End of content.</p>
    </div>
  </article>
</div>
`;

async function testHeadingCount() {
  console.log('🧪 Testing Heading Count with Table Splitting\n');
  console.log('='.repeat(70));
  
  try {
    // Extract the HTML (dry run)
    const extractResponse = await fetch('http://localhost:3004/api/W2N', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Heading Count',
        databaseId: '282a89fedba5815e91f0db972912ef9f',
        contentHtml: sourceHTML,
        dryRun: true
      })
    });
    
    const extractData = await extractResponse.json();
    const blocks = extractData.data?.children || [];
    
    console.log(`\n📊 Extraction Results:`);
    console.log(`Total blocks: ${blocks.length}`);
    
    // Count different types
    const allHeadings = blocks.filter(b => b.type === 'heading_2' || b.type === 'heading_3');
    const continuationHeadings = allHeadings.filter(h => {
      const text = h[h.type]?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
      return text.match(/^\(continued - rows \d+-\d+\)$/);
    });
    const mainHeadings = allHeadings.filter(h => {
      const text = h[h.type]?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
      return !text.match(/^\(continued - rows \d+-\d+\)$/);
    });
    const tables = blocks.filter(b => b.type === 'table');
    
    console.log(`\nTotal headings: ${allHeadings.length}`);
    console.log(`  - Main content headings: ${mainHeadings.length}`);
    console.log(`  - Continuation headings: ${continuationHeadings.length}`);
    console.log(`Tables: ${tables.length}`);
    
    console.log(`\n📝 Heading breakdown:`);
    allHeadings.forEach((h, i) => {
      const text = h[h.type]?.rich_text?.map(rt => rt.text?.content || '').join('') || '';
      const isContinuation = text.match(/^\(continued - rows \d+-\d+\)$/);
      console.log(`  ${i+1}. ${isContinuation ? '🔄' : '📌'} ${h.type}: "${text}"`);
    });
    
    // Count source headings
    const sourceHeadings = (sourceHTML.match(/<h[1-6][^>]*>/gi) || []).length;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('Validation Logic Check');
    console.log('='.repeat(70));
    
    console.log(`\nSource HTML: ${sourceHeadings} headings`);
    console.log(`Notion blocks: ${allHeadings.length} total headings`);
    console.log(`  - Excluding ${continuationHeadings.length} continuation heading(s)`);
    console.log(`  - Actual content headings: ${mainHeadings.length}`);
    
    const minExpected = Math.floor(sourceHeadings * 0.8);
    const maxExpected = Math.ceil(sourceHeadings * 1.2);
    
    console.log(`\nExpected range: ${minExpected}-${maxExpected} (±20%)`);
    console.log(`Actual count: ${mainHeadings.length}`);
    
    if (mainHeadings.length >= minExpected && mainHeadings.length <= maxExpected) {
      console.log(`\n✅ PASS: Heading count within acceptable range`);
      console.log(`   ${sourceHeadings} source → ${mainHeadings.length} Notion (${continuationHeadings.length} continuation headings excluded)`);
    } else if (mainHeadings.length < minExpected) {
      console.log(`\n❌ FAIL: Too few headings (${mainHeadings.length} < ${minExpected})`);
    } else {
      console.log(`\n⚠️  WARNING: More headings than expected (${mainHeadings.length} > ${maxExpected})`);
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('Expected Validation Result');
    console.log('='.repeat(70));
    console.log(`✅ Validation should PASS`);
    console.log(`📝 Informational notes:`);
    console.log(`   1. Table splitting: 1 source table(s) split into ${tables.length} Notion tables`);
    console.log(`   2. Table continuation headings: ${continuationHeadings.length} synthetic heading(s) excluded`);
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
  }
}

testHeadingCount().catch(err => console.error('Error:', err));
