/**
 * Test case: "Before you begin" callout with nested Note
 * 
 * Expected behavior:
 * - "Before you begin" section becomes a callout
 * - "Role required: oauth_admin in DevOps Change Velocity" is inside the callout
 * - "Admin account in GitHub." is inside the callout
 * - Nested Note should be flattened to plain text (Notion can't handle nested callouts)
 */

const axios = require('axios');

const testHtml = `
<section class="section prereq">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: oauth_admin in DevOps Change Velocity.</p>
  <ul class="ul">
    <li class="li">
      Admin account in GitHub.
      <div class="itemgroup info">
        <div class="note note note_note">
          <span class="note__title">Note:</span>
          The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.
        </div>
      </div>
    </li>
  </ul>
</section>
`;

async function runTest() {
  console.log('\n🧪 TEST: "Before you begin" with nested Note\n');
  
  try {
    const response = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Test Before you begin nested',
      contentHtml: testHtml,
      dryRun: true
    });
    
    const blocks = response.data.data.children;
    console.log(`📦 Got ${blocks.length} block(s)\n`);
    
    blocks.forEach((block, i) => {
      console.log(`\n📋 Block ${i + 1}: ${block.type}`);
      
      if (block.type === 'callout') {
        console.log(`   Icon: ${block.callout.icon?.emoji || 'none'}`);
        console.log(`   Color: ${block.callout.color || 'default'}`);
        
        const content = block.callout.rich_text.map(rt => rt.text.content).join('');
        console.log(`   Content: "${content}"`);
        console.log(`   Rich text elements: ${block.callout.rich_text.length}`);
        
        block.callout.rich_text.forEach((rt, j) => {
          const preview = rt.text.content.length > 60 
            ? rt.text.content.substring(0, 60) + '...'
            : rt.text.content;
          console.log(`     [${j}]: "${preview}" ${rt.annotations?.code ? 'CODE' : ''}`);
        });
        
        if (block.callout.children && block.callout.children.length > 0) {
          console.log(`   Children: ${block.callout.children.length}`);
          block.callout.children.forEach((child, j) => {
            console.log(`     [${j}]: ${child.type}`);
            if (child.type === 'bulleted_list_item') {
              const childContent = child.bulleted_list_item.rich_text.map(rt => rt.text.content).join('');
              console.log(`       Content: "${childContent}"`);
            }
          });
        }
      } else if (block.type === 'paragraph') {
        const content = block.paragraph.rich_text.map(rt => rt.text.content).join('');
        console.log(`   Content: "${content}"`);
      } else if (block.type === 'bulleted_list_item') {
        const content = block.bulleted_list_item.rich_text.map(rt => rt.text.content).join('');
        console.log(`   List item: "${content}"`);
      }
    });
    
    // Validation
    console.log('\n\n🔍 VALIDATION:');
    const calloutBlocks = blocks.filter(b => b.type === 'callout');
    
    if (calloutBlocks.length === 0) {
      console.log('   ❌ FAIL: No callout block found (expected "Before you begin" callout)');
      return;
    }
    
    if (calloutBlocks.length > 1) {
      console.log('   ❌ FAIL: Multiple callout blocks found (expected only one)');
      return;
    }
    
    const callout = calloutBlocks[0];
    const calloutText = callout.callout.rich_text.map(rt => rt.text.content).join('');
    
    // Check for required content
    const checks = [
      { name: 'Role required', test: calloutText.includes('Role required:') },
      { name: 'oauth_admin', test: calloutText.includes('oauth_admin') },
      { name: 'DevOps Change Velocity', test: calloutText.includes('DevOps Change Velocity') },
      { name: 'Admin account in GitHub', test: calloutText.includes('Admin account in GitHub') },
    ];
    
    let allPassed = true;
    checks.forEach(check => {
      if (check.test) {
        console.log(`   ✅ PASS: ${check.name} found in callout`);
      } else {
        console.log(`   ❌ FAIL: ${check.name} NOT found in callout`);
        allPassed = false;
      }
    });
    
    // Check that Note is flattened (not a nested callout)
    const hasNestedCallout = callout.callout.children?.some(c => c.type === 'callout');
    if (hasNestedCallout) {
      console.log('   ❌ FAIL: Found nested callout (Note should be plain text)');
      allPassed = false;
    } else {
      console.log('   ✅ PASS: No nested callout (Note is flattened)');
    }
    
    // Check for Note content
    const hasNoteContent = calloutText.includes('OAuth 2.0 JWT grant type');
    if (hasNoteContent) {
      console.log('   ✅ PASS: Note content found as plain text in callout');
    } else {
      console.log('   ⚠️  WARNING: Note content not found (might be in children)');
    }
    
    console.log('\n' + '='.repeat(60));
    if (allPassed) {
      console.log('✅ SUCCESS: All validations passed');
    } else {
      console.log('❌ FAILURE: Some validations failed');
    }
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data?.message || error.message);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

runTest();
