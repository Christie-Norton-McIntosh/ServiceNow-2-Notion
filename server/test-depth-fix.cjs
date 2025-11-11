const fs = require('fs');
const path = require('path');
const { extractContentFromHtml } = require('./services/servicenow.cjs');

(async () => {
const htmlPath = path.resolve(__dirname, '../tests/fixtures/validation-failures/add-a-new-change-request-type-2025-11-11T07-13-25.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const result = await extractContentFromHtml(html);
const blocks = result.children;

console.log('\n=== CHECKING DEPTH 3 TABLE ISSUE ===\n');

// Check block 5 (numbered_list_item with nested numbered_list_item that had table at depth 3)
const block5 = blocks[5];
if (!block5 || block5.type !== 'numbered_list_item') {
  console.log('❌ Block 5 is not a numbered_list_item');
  process.exit(1);
}

console.log('Block 5: numbered_list_item');
const block5Children = block5.numbered_list_item?.children || [];
console.log(`  Children count: ${block5Children.length}`);
console.log(`  Child types: ${block5Children.map(c => c.type).join(', ')}`);

// Check second child (numbered_list_item that had table at depth 3)
const child2 = block5Children[2];
if (!child2) {
  console.log('\n❌ Block 5 child 2 not found');
  process.exit(1);
}

console.log(`\nBlock 5 child 2:`);
console.log(`  Type: ${child2.type}`);
const child2Children = child2.numbered_list_item?.children || [];
console.log(`  Has children? ${child2Children.length > 0}`);
console.log(`  Children count: ${child2Children.length}`);

if (child2Children.length > 0) {
  console.log(`  Child types: ${child2Children.map(c => c.type).join(', ')}`);
  
  // Check if any children are tables
  const hasTables = child2Children.some(c => c.type === 'table');
  if (hasTables) {
    console.log('\n❌ ISSUE: Depth 3 table still present!');
    process.exit(1);
  }
}

console.log('\n✅ SUCCESS: No tables at depth 3!');

// Now check if tables exist at top level with markers
console.log('\n=== CHECKING TOP-LEVEL TABLES WITH MARKERS ===\n');
const topLevelTables = blocks.filter(b => b.type === 'table');
console.log(`Top-level tables: ${topLevelTables.length}`);

topLevelTables.forEach((table, i) => {
  console.log(`\nTable ${i + 1}:`);
  console.log(`  Has _sn2n_marker? ${!!table._sn2n_marker}`);
  if (table._sn2n_marker) {
    console.log(`  Marker: ${table._sn2n_marker}`);
  }
});

if (topLevelTables.length > 0 && topLevelTables.every(t => t._sn2n_marker)) {
  console.log('\n✅ All top-level tables have markers for orchestration!');
} else {
  console.log('\n⚠️ Some tables missing markers');
}
})();
