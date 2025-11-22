/**
 * Test nested callout detection fix
 * Verifies that nested callouts are not double-counted in expectedCallouts
 */

const http = require('http');

// Test HTML with:
// 1. A prereq section (callout #1)
// 2. A nested note inside the prereq (should be child block, NOT a separate callout)
const testHtml = `
<article>
  <section class="section prereq">
    <div class="tasklabel"><p class="sectiontitle tasklabel">Before you begin</p></div>
    <p class="p">Role required: admin</p>
    <div class="p">Additional context:
      <ul class="ul">
        <li class="li">Item 1</li>
        <li class="li">Item 2
          <div class="note note note_note">
            <span class="note__title">Note:</span> This is a nested note inside a list item
          </div>
        </li>
      </ul>
    </div>
  </section>
  <p class="p">Some regular content after the prereq.</p>
</article>
`;

const data = JSON.stringify({
  title: 'Test Nested Callout Detection',
  databaseId: '11de89fe23a78137afa0ebcbae8c02f2',
  contentHtml: testHtml,
  dryRun: true
});

const options = {
  hostname: 'localhost',
  port: 3004,
  path: '/api/W2N',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log('🧪 Testing nested callout detection fix...\n');
console.log('Test HTML structure:');
console.log('  1. <section class="prereq"> (should be callout #1)');
console.log('  2. <div class="note note note_note"> NESTED inside prereq (should be child block, NOT separate callout)');
console.log('  Expected result: 1 top-level callout\n');

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    
    if (res.statusCode !== 200) {
      console.error('❌ Request failed with status:', res.statusCode);
      console.log('Response:', responseData.substring(0, 500));
      return;
    }
    
    try {
      const json = JSON.parse(responseData);
      
      const children = json.children || json.data?.children;
      
      if (!children) {
        console.error('❌ No children in response');
        console.log('Response:', JSON.stringify(json, null, 2).substring(0, 500));
        return;
      }
      
      // Count top-level callouts
      const topLevelCallouts = children.filter(b => b.type === 'callout');
      
      console.log('\n📊 Results:');
      console.log('  Total top-level blocks:', children.length);
      console.log('  Top-level callouts:', topLevelCallouts.length);
      
      if (topLevelCallouts.length === 1) {
        console.log('\n✅ SUCCESS: Only 1 top-level callout detected (nested note not counted)');
        
        // Check if the callout has the nested note as a child
        const callout = topLevelCallouts[0];
        const hasChildren = callout._sn2n_marker || callout.callout?.children;
        console.log('  Callout has children marker:', !!callout._sn2n_marker);
        
        const text = callout.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 150);
        console.log('  Callout text preview:', text);
      } else {
        console.log('\n❌ FAILED: Expected 1 top-level callout, got', topLevelCallouts.length);
        console.log('\nCallout details:');
        topLevelCallouts.forEach((c, i) => {
          const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
          const emoji = c.callout?.icon?.emoji;
          console.log(`  [${i + 1}] ${emoji} ${text}...`);
        });
      }
      
    } catch (e) {
      console.error('❌ Parse error:', e.message);
      console.log('Response:', responseData.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.write(data);
req.end();
