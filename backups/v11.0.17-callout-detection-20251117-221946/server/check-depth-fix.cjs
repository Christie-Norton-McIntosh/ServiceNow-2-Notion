const blocks = require('/tmp/blocks-after-clean.json');
const b5 = blocks[5];
const c2 = b5?.numbered_list_item?.children?.[2];
console.log('Block 5 child 2:');
console.log('  Type:', c2?.type);
console.log('  Has children?', !!c2?.numbered_list_item?.children);
console.log('  Children count:', c2?.numbered_list_item?.children?.length || 0);

if (c2?.numbered_list_item?.children && c2.numbered_list_item.children.length > 0) {
  console.log('\n❌ ISSUE: Block still has children that should have been removed');
  console.log('  Child types:', c2.numbered_list_item.children.map(c => c.type).join(', '));
} else {
  console.log('\n✅ SUCCESS: Deep nested children were removed for orchestration!');
}
