const fs = require('fs');
const html = fs.readFileSync('test-input.html', 'utf-8');

async function testAllIssues() {
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
  
  console.log('=== ISSUE 1: Connection Properties Sub-Bullets ===\n');
  
  // Find "In Connection Properties" at children[9].children[1].children[2]
  const numbered = children[9];
  const addConnections = numbered.numbered_list_item.children[1];
  const inConnectionProps = addConnections.bulleted_list_item.children[2];
  
  console.log('📦 "In Connection Properties" numbered item:');
  console.log(`   Immediate children: ${inConnectionProps.numbered_list_item.children?.length || 0}`);
  console.log(`   Deferred children: ${inConnectionProps._sn2n_deferred_children?.length || 0}`);
  
  if (inConnectionProps._sn2n_deferred_children && inConnectionProps._sn2n_deferred_children.length === 2) {
    const hasRelationship = inConnectionProps._sn2n_deferred_children.some(c => 
      c[c.type]?.rich_text?.[0]?.text?.content?.includes('Relationship Direction')
    );
    const hasServiceQuery = inConnectionProps._sn2n_deferred_children.some(c => 
      c[c.type]?.rich_text?.[0]?.text?.content?.includes('Service Query')
    );
    
    if (hasRelationship && hasServiceQuery) {
      console.log('✅ ISSUE 1 FIXED: Sub-bullets are deferred (will be added via orchestration)\n');
    } else {
      console.log('❌ ISSUE 1 FAILED: Deferred children are not the expected sub-bullets\n');
    }
  } else {
    console.log('❌ ISSUE 1 FAILED: Expected 2 deferred children\n');
  }
  
  console.log('=== ISSUE 2: "Not Connected" Example Paragraph ===\n');
  
  // The Service Query Properties bullet should have the paragraph as a deferred child
  const serviceQueryBullet = inConnectionProps._sn2n_deferred_children?.find(c => 
    c[c.type]?.rich_text?.[0]?.text?.content?.includes('Service Query')
  );
  
  if (serviceQueryBullet) {
    const hasParagraphChild = serviceQueryBullet._sn2n_deferred_children?.some(c => 
      c.type === 'paragraph' && c.paragraph?.rich_text?.[0]?.text?.content?.includes('not connected')
    );
    
    console.log('📦 "Service Query Properties" bullet:');
    console.log(`   Deferred children: ${serviceQueryBullet._sn2n_deferred_children?.length || 0}`);
    
    if (hasParagraphChild) {
      console.log('✅ ISSUE 2 FIXED: "Not connected" paragraph is deferred under Service Query bullet\n');
    } else {
      console.log('❌ ISSUE 2 FAILED: Paragraph not found as deferred child\n');
    }
  } else {
    console.log('⚠️  Cannot verify Issue 2: Service Query bullet not found\n');
  }
  
  console.log('=== ISSUE 3: "First 100 Results" Sentence ===\n');
  
  // Find "Select Run" bullet (block 12)
  const selectRunBlock = children[12];
  const selectRunChildren = selectRunBlock.bulleted_list_item.children || [];
  
  console.log('📦 "Select Run" bullet children:');
  selectRunChildren.forEach((child, idx) => {
    const type = child.type;
    const text = child[type]?.rich_text?.[0]?.text?.content || '';
    console.log(`   [${idx}] ${type}: "${text.substring(0, 60)}..."`);
  });
  
  // Check if first child is the "first 100 results" paragraph
  const firstChild = selectRunChildren[0];
  if (firstChild && firstChild.type === 'paragraph' && firstChild.paragraph.rich_text[0]?.text?.content?.includes('first 100 results')) {
    console.log('\n✅ ISSUE 3 FIXED: "first 100 results" paragraph appears BEFORE Load More/Load All bullets\n');
  } else {
    console.log('\n❌ ISSUE 3 FAILED: First child is not the expected paragraph\n');
  }
  
  // Also verify nesting depth compliance
  console.log('=== NESTING DEPTH VALIDATION ===\n');
  
  function checkNestingDepth(blocks, depth = 0, path = 'root') {
    let violations = [];
    
    blocks.forEach((block, idx) => {
      const type = block.type;
      const childrenKey = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout'].includes(type) ? type : null;
      
      if (childrenKey && block[childrenKey]?.children?.length > 0) {
        if (depth >= 2) {
          violations.push({
            path: `${path}[${idx}].${type}.children`,
            depth: depth + 1,
            count: block[childrenKey].children.length
          });
        }
        
        // Recurse into children
        const childViolations = checkNestingDepth(block[childrenKey].children, depth + 1, `${path}[${idx}].children`);
        violations.push(...childViolations);
      }
    });
    
    return violations;
  }
  
  const violations = checkNestingDepth(children);
  
  if (violations.length === 0) {
    console.log('✅ NESTING VALIDATION PASSED: No violations found');
  } else {
    console.log(`❌ NESTING VALIDATION FAILED: Found ${violations.length} violation(s):`);
    violations.forEach((v, idx) => {
      console.log(`   [${idx + 1}] ${v.path} has ${v.count} children at depth ${v.depth}`);
    });
  }
}

testAllIssues().catch(console.error);
