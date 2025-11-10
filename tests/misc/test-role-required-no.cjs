/**
 * Test case: "Role required: No" should NOT use inline code
 * 
 * Expected: "Role required: No" with no inline code formatting
 * Actual (before fix): "Role required: No" with "No" as inline code
 */

const { extractContentFromHtml } = require('../../server/services/servicenow.cjs');

async function testRoleRequiredNo() {
  console.log('\n🧪 TEST: "Role required: No" should NOT use inline code\n');

  const testCases = [
    {
      name: 'Role required: No',
      html: '<p class="p">Role required: No</p>',
      shouldHaveCode: false
    },
    {
      name: 'Role required: None',
      html: '<p class="p">Role required: None</p>',
      shouldHaveCode: false
    },
    {
      name: 'Role required: admin',
      html: '<p class="p">Role required: admin</p>',
      shouldHaveCode: true
    },
    {
      name: 'Role required: sn_devops.admin',
      html: '<p class="p">Role required: sn_devops.admin</p>',
      shouldHaveCode: true
    }
  ];

  let allPassed = true;

  for (const testCase of testCases) {
    console.log(`\n📋 Testing: ${testCase.name}`);
    console.log(`   HTML: ${testCase.html}`);
    console.log(`   Should have code: ${testCase.shouldHaveCode}`);

    try {
      const result = await extractContentFromHtml(testCase.html);
      
      if (!result.blocks || result.blocks.length === 0) {
        console.log('   ❌ FAIL: No blocks returned');
        allPassed = false;
        continue;
      }

      const block = result.blocks[0];
      if (block.type !== 'paragraph') {
        console.log(`   ❌ FAIL: Expected paragraph, got ${block.type}`);
        allPassed = false;
        continue;
      }

      const richText = block.paragraph.rich_text;
      const hasCodeAnnotation = richText.some(rt => rt.annotations?.code === true);
      
      // Log the rich text elements
      console.log(`   Rich text elements: ${richText.length}`);
      richText.forEach((rt, idx) => {
        console.log(`     [${idx}] "${rt.text?.content || ''}" code=${rt.annotations?.code || false}`);
      });

      if (testCase.shouldHaveCode && !hasCodeAnnotation) {
        console.log('   ❌ FAIL: Expected inline code but none found');
        allPassed = false;
      } else if (!testCase.shouldHaveCode && hasCodeAnnotation) {
        console.log('   ❌ FAIL: Found inline code but should not have any');
        allPassed = false;
      } else {
        console.log('   ✅ PASS');
      }

    } catch (error) {
      console.error('   ❌ FAIL: Error:', error.message);
      allPassed = false;
    }
  }

  console.log('\n' + '='.repeat(80));
  if (allPassed) {
    console.log('✅ SUCCESS: All test cases passed');
    process.exit(0);
  } else {
    console.log('❌ FAILURE: Some test cases failed');
    process.exit(1);
  }
}

testRoleRequiredNo();
