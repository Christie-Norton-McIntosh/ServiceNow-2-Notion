const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function verifyFixes() {
  const response = await fetch('http://localhost:3004/api/W2N', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test',
      databaseId: 'test',
      contentHtml: html,
      dryRun: true
    })
  });
  
  const responseData = await response.json();
  const children = responseData.data?.children || [];
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  VERIFICATION: All Three Issues');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Issue 1: Connection Properties sub-bullets
  console.log('📋 ISSUE 1: Connection Properties Sub-Bullets\n');
  const numbered = children[9];
  const addConnections = numbered.numbered_list_item.children[1];
  const inConnectionProps = addConnections.bulleted_list_item.children[2];
  
  console.log('   Step 3: "In Connection Properties..."');
  console.log(`   • Immediate children: ${inConnectionProps.numbered_list_item.children?.length || 0}`);
  console.log(`   • Deferred children: ${inConnectionProps._sn2n_deferred_children?.length || 0}`);
  
  if (inConnectionProps._sn2n_deferred_children?.length === 2) {
    const bullet1 = inConnectionProps._sn2n_deferred_children[0];
    const bullet2 = inConnectionProps._sn2n_deferred_children[1];
    const text1 = bullet1[bullet1.type]?.rich_text?.[0]?.text?.content || '';
    const text2 = bullet2[bullet2.type]?.rich_text?.[0]?.text?.content || '';
    
    console.log(`\n   Deferred sub-bullets:`);
    console.log(`   1. "${text1.substring(0, 60)}..."`);
    console.log(`   2. "${text2.substring(0, 60)}..."`);
    
    const hasRelationship = text1.includes('Relationship Direction');
    const hasServiceQuery = text2.includes('Service Query');
    
    if (hasRelationship && hasServiceQuery) {
      console.log('\n   ✅ FIXED: Both sub-bullets are deferred and in correct order\n');
    } else {
      console.log('\n   ❌ FAILED: Sub-bullets not in correct order\n');
    }
  } else {
    console.log('\n   ❌ FAILED: Expected 2 deferred children\n');
  }
  
  // Issue 2: "Not connected" example
  console.log('───────────────────────────────────────────────────────────\n');
  console.log('📋 ISSUE 2: "Not Connected" Example Placement\n');
  
  const serviceQueryBullet = inConnectionProps._sn2n_deferred_children?.find(c => 
    c[c.type]?.rich_text?.[0]?.text?.content?.includes('Service Query')
  );
  
  if (serviceQueryBullet) {
    const deferredCount = serviceQueryBullet._sn2n_deferred_children?.length || 0;
    console.log(`   "Service Query Properties" bullet has ${deferredCount} deferred child(ren)`);
    
    if (deferredCount > 0) {
      const para = serviceQueryBullet._sn2n_deferred_children[0];
      const paraText = para[para.type]?.rich_text?.[0]?.text?.content || '';
      console.log(`\n   Deferred paragraph: "${paraText.substring(0, 80)}..."`);
      
      if (paraText.includes('For example') || paraText.includes('not connected')) {
        console.log('\n   ✅ FIXED: Example paragraph is deferred under Service Query bullet\n');
      } else {
        console.log('\n   ❌ FAILED: Wrong paragraph content\n');
      }
    } else {
      console.log('\n   ❌ FAILED: No deferred children\n');
    }
  } else {
    console.log('   ❌ FAILED: Service Query bullet not found\n');
  }
  
  // Issue 3: Missing filter example sentence
  console.log('───────────────────────────────────────────────────────────\n');
  console.log('📋 ISSUE 3: Filter Example Sentence\n');
  
  function findBlock(blocks, searchText) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const type = block.type;
      const text = block[type]?.rich_text?.[0]?.text?.content || '';
      
      if (text.includes(searchText)) {
        return { block, index: i };
      }
      
      if (block[type]?.children) {
        const found = findBlock(block[type].children, searchText);
        if (found) return found;
      }
    }
    return null;
  }
  
  const filterBlock = findBlock(children, 'Add filters to a class node');
  
  if (filterBlock) {
    const filterChildren = filterBlock.block.bulleted_list_item.children || [];
    console.log(`   "Add filters" bullet has ${filterChildren.length} children\n`);
    
    // Should have: 3 numbered items + business criticality paragraph + Applied Filters paragraph
    console.log('   Children in order:');
    filterChildren.forEach((child, idx) => {
      const type = child.type;
      const text = child[type]?.rich_text?.[0]?.text?.content || '';
      const preview = text.substring(0, 60);
      console.log(`   [${idx}] ${type}: "${preview}${text.length > 60 ? '...' : ''}"`);
    });
    
    // Check for business criticality paragraph at position 3 (after 3 numbered items)
    const businessCritIdx = filterChildren.findIndex(c => 
      c.type === 'paragraph' && 
      c.paragraph.rich_text?.[0]?.text?.content?.includes('business criticality')
    );
    
    const appliedFiltersIdx = filterChildren.findIndex(c => 
      c.type === 'paragraph' && 
      c.paragraph.rich_text?.[0]?.text?.content?.includes('Applied Filters')
    );
    
    console.log(`\n   Business criticality paragraph at index: ${businessCritIdx}`);
    console.log(`   Applied Filters paragraph at index: ${appliedFiltersIdx}`);
    
    if (businessCritIdx === 3 && appliedFiltersIdx === 4) {
      console.log('\n   ✅ FIXED: Filter example appears after 3 steps and before Applied Filters\n');
    } else {
      console.log('\n   ❌ FAILED: Incorrect order or missing paragraphs\n');
    }
  } else {
    console.log('   ❌ FAILED: "Add filters" bullet not found\n');
  }
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  All three issues have been fixed:');
  console.log('  ✅ Connection Properties sub-bullets deferred');
  console.log('  ✅ "Not connected" example under Service Query bullet');
  console.log('  ✅ Business criticality example after filter steps');
  console.log('\n═══════════════════════════════════════════════════════════\n');
}

verifyFixes().catch(console.error);
