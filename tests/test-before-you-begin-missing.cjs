/**
 * Test: Before you begin section with multiple roles should be converted to callout
 */
const axios = require('axios');

const html = `
<section class="section prereq" id="dev-ops-reg-github-oauth-prov-jwt__prereq_ihr_rpr_4mb">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: admin, sn_devops.admin</p>
</section>
`;

(async () => {
  try {
    const res = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Before you begin with multiple roles test',
      contentHtml: html,
      dryRun: true
    });
    const blocks = res.data.data.children;
    console.log(`\n📦 Total blocks: ${blocks.length}\n`);
    
    blocks.forEach((b, i) => {
      console.log(`Block ${i + 1}: ${b.type}`);
      if (b.type === 'callout') {
        const text = b.callout.rich_text.map(rt => rt.text.content).join('');
        console.log(`  Text: "${text}"`);
        console.log(`  Icon: ${b.callout.icon?.emoji || 'none'}`);
      } else if (b.type === 'paragraph') {
        const text = b.paragraph.rich_text.map(rt => rt.text.content).join('');
        console.log(`  Text: "${text}"`);
      }
    });
    
    // Validation
    const hasCallout = blocks.some(b => b.type === 'callout');
    const hasBeforeYouBegin = blocks.some(b => {
      if (b.type === 'callout') {
        const text = b.callout.rich_text.map(rt => rt.text.content).join('');
        return text.includes('Before you begin');
      }
      return false;
    });
    const hasRoleRequired = blocks.some(b => {
      if (b.type === 'callout') {
        const text = b.callout.rich_text.map(rt => rt.text.content).join('');
        return text.includes('Role required');
      }
      return false;
    });
    
    console.log('\n📋 Validation:');
    if (blocks.length === 0) {
      console.log('❌ FAIL: No blocks created');
    } else if (!hasCallout) {
      console.log('❌ FAIL: No callout block found (expected "Before you begin" callout)');
    } else if (!hasBeforeYouBegin) {
      console.log('❌ FAIL: "Before you begin" text not found in callout');
    } else if (!hasRoleRequired) {
      console.log('❌ FAIL: "Role required" text not found in callout');
    } else {
      console.log('✅ PASS: Before you begin callout with roles created correctly');
    }
  } catch (e) {
    console.error('❌ Error:', e.response?.data?.message || e.message);
    if (e.response?.data) {
      console.error('Response:', JSON.stringify(e.response.data, null, 2));
    }
  }
})();
