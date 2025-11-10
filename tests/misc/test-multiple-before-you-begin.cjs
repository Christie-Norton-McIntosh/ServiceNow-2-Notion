/**
 * Test: Multiple "Before you begin" sections should all be kept (not deduped)
 */
const axios = require('axios');

const html = `
<section class="section prereq" id="prereq1">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: admin</p>
</section>

<h2>Some heading</h2>

<section class="section prereq" id="dev-ops-reg-github-oauth-prov-jwt__prereq_ihr_rpr_4mb">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: admin, sn_devops.admin</p>
</section>

<h2>Another heading</h2>

<section class="section prereq" id="prereq3">
  <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
  <p class="p">Role required: sn_devops.admin</p>
</section>
`;

(async () => {
  try {
    const res = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Multiple Before you begin sections test',
      contentHtml: html,
      dryRun: true
    });
    const blocks = res.data.data.children;
    console.log(`\n📦 Total blocks: ${blocks.length}\n`);
    
    const callouts = blocks.filter(b => b.type === 'callout');
    const beforeYouBeginCallouts = callouts.filter(b => {
      const text = b.callout.rich_text.map(rt => rt.text.content).join('');
      return text.includes('Before you begin');
    });
    
    console.log(`Found ${callouts.length} total callouts`);
    console.log(`Found ${beforeYouBeginCallouts.length} "Before you begin" callouts\n`);
    
    beforeYouBeginCallouts.forEach((c, i) => {
      const text = c.callout.rich_text.map(rt => rt.text.content).join('');
      console.log(`Callout ${i + 1}: ${text.substring(0, 100)}`);
    });
    
    // Validation
    console.log('\n📋 Validation:');
    if (beforeYouBeginCallouts.length < 3) {
      console.log(`❌ FAIL: Expected 3 "Before you begin" callouts, found ${beforeYouBeginCallouts.length}`);
    } else {
      console.log('✅ PASS: All 3 "Before you begin" callouts preserved (not deduped)');
    }
  } catch (e) {
    console.error('❌ Error:', e.response?.data?.message || e.message);
  }
})();
