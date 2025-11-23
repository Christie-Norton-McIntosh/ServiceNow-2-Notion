#!/usr/bin/env node

const fs = require('fs');

// Read the dry-run result
const rawData = fs.readFileSync('/tmp/dryrun-payload.json', 'utf8');
const lines = rawData.split('\n');
const jsonStart = lines.findIndex(l => l.trim().startsWith('{'));
const jsonData = lines.slice(jsonStart).join('\n');
const result = JSON.parse(jsonData);

// Navigate to the problematic block
const child9 = result.children[9];
console.log('\n=== children[9] ===');
console.log('Type:', child9.type);
console.log('Has children:', !!child9.numbered_list_item?.children);
console.log('Children count:', child9.numbered_list_item?.children?.length || 0);

if (child9.numbered_list_item?.children?.[3]) {
  const child9_3 = child9.numbered_list_item.children[3];
  console.log('\n=== children[9].children[3] ===');
  console.log('Type:', child9_3.type);
  console.log('Has children:', !!child9_3.bulleted_list_item?.children);
  console.log('Children count:', child9_3.bulleted_list_item?.children?.length || 0);
  
  if (child9_3.bulleted_list_item?.children) {
    console.log('\n=== children[9].children[3].children (all) ===');
    child9_3.bulleted_list_item.children.forEach((child, idx) => {
      console.log(`  [${idx}]: type=${child.type}, keys=${Object.keys(child).filter(k => k !== 'type').join(',')}`);
    });
    
    if (child9_3.bulleted_list_item.children[2]) {
      const problematicBlock = child9_3.bulleted_list_item.children[2];
      console.log('\n=== children[9].children[3].children[2] (THE PROBLEMATIC BLOCK) ===');
      console.log(JSON.stringify(problematicBlock, null, 2).substring(0, 1000));
    }
  }
}
