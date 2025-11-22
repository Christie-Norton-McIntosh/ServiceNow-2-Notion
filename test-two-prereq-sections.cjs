/**
 * Test "missing callouts" issue
 * Verifies that two sibling prereq sections both create callouts
 */

const http = require('http');

// Test HTML with TWO SEPARATE prereq sections (siblings, not nested)
const testHtml = `
<article>
  <article class="task">
    <h2>Task 1</h2>
    <section class="section prereq">
      <div class="tasklabel"><p>Before you begin</p></div>
      <p>Role required: admin</p>
    </section>
    <ol class="steps">
      <li>Step 1</li>
      <li>Step 2</li>
    </ol>
  </article>
  <article class="task">
    <h2>Task 2</h2>
    <section class="section prereq">
      <div class="tasklabel"><p>Before you begin</p></div>
      <p>Role required: user</p>
    </section>
    <ol class="steps">
      <li>Step A</li>
      <li>Step B</li>
    </ol>
  </article>
</article>
`;

const data = JSON.stringify({
  title: 'Test Two Prereq Sections',
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

console.log('🧪 Testing two sibling prereq sections...\n');
console.log('Test HTML structure:');
console.log('  <article>');
console.log('    <article class="task">');
console.log('      <section class="prereq"> (Role: admin)');
console.log('    </article>');
console.log('    <article class="task">');
console.log('      <section class="prereq"> (Role: user)');
console.log('    </article>');
console.log('  </article>');
console.log('  Expected result: 2 callouts (one for each prereq)\n');

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
        return;
      }
      
      // Count callouts
      const callouts = children.filter(b => b.type === 'callout');
      const beforeYouBeginCallouts = callouts.filter(c => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('');
        return /Before you begin/i.test(text);
      });
      
      console.log('\n📊 Results:');
      console.log('  Total blocks:', children.length);
      console.log('  Total callouts:', callouts.length);
      console.log('  "Before you begin" callouts:', beforeYouBeginCallouts.length);
      
      if (callouts.length === 2 && beforeYouBeginCallouts.length === 2) {
        console.log('\n✅ SUCCESS: Both prereq sections created callouts');
      } else {
        console.log('\n❌ FAILED: Expected 2 callouts, got', callouts.length);
      }
      
      console.log('\nCallout details:');
      callouts.forEach((c, i) => {
        const text = c.callout?.rich_text?.map(rt => rt.text?.content || '').join('').substring(0, 100);
        const emoji = c.callout?.icon?.emoji;
        console.log(`  [${i + 1}] ${emoji} ${text.replace(/\n/g, ' ')}...`);
      });
      
      console.log('\nAll block types:');
      const blockTypes = {};
      children.forEach(b => {
        blockTypes[b.type] = (blockTypes[b.type] || 0) + 1;
      });
      Object.entries(blockTypes).forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
      
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
