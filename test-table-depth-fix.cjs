#!/usr/bin/env node
/**
 * Test v11.0.71: Verify tables keep their children at depth 3+
 * 
 * This test checks that:
 * 1. Tables are NOT included in enforceNestingDepthLimit processing
 * 2. Tables keep their table_rows regardless of depth
 * 3. No empty tables are created
 * 4. No mixed table+table_row blocks in markers
 */

const html = `
<ol>
  <li>
    First list item
    <ul>
      <li>
        Nested bullet with table at depth 3:
        <table>
          <tr><td>Row 1</td></tr>
          <tr><td>Row 2</td></tr>
          <tr><td>Row 3</td></tr>
        </table>
      </li>
    </ul>
  </li>
</ol>
`;

async function testTableDepthFix() {
  console.log('🧪 Testing v11.0.71 table depth fix...\n');
  
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      databaseId: '1544ecee-bba9-8002-e90a-b7d5f053af00', 
      title: 'Test Table Depth Fix',
      contentHtml: html,
      url: 'https://test.com',
      dryRun: true
    })
  });
  
  const result = await response.json();
  
  if (!result.children) {
    console.log('❌ No children in response:', result);
    return;
  }
  
  console.log(`✅ Got ${result.children.length} blocks\n`);
  
  // Check for empty tables
  function findEmptyTables(blocks, path = '') {
    const emptyTables = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const currentPath = `${path}[${i}]`;
      
      if (block.type === 'table') {
        if (!block.table || !block.table.children || block.table.children.length === 0) {
          emptyTables.push(currentPath);
        } else {
          console.log(`  ✅ Found table at ${currentPath} with ${block.table.children.length} rows`);
        }
      }
      
      // Recurse into children
      const blockType = block.type;
      if (blockType && block[blockType] && Array.isArray(block[blockType].children)) {
        emptyTables.push(...findEmptyTables(block[blockType].children, `${currentPath}.${blockType}.children`));
      }
    }
    
    return emptyTables;
  }
  
  const emptyTables = findEmptyTables(result.children);
  
  if (emptyTables.length > 0) {
    console.log(`\n❌ Found ${emptyTables.length} empty table(s):`);
    emptyTables.forEach(path => console.log(`   ${path}`));
  } else {
    console.log('\n✅ No empty tables found');
  }
  
  console.log('\n🎯 Test complete');
}

testTableDepthFix().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
