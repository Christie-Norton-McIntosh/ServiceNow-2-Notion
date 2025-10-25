const axios = require('axios');

// Test callout with nested list (creates marker)
const html = `
<div class="note note note_note">
  <span class="note__title">Note:</span>
  <p>This callout contains a nested list:</p>
  <ul>
    <li>First item</li>
    <li>Second item</li>
  </ul>
</div>
`;

console.log('Testing callout with nested content (marker cleanup)...\n');
console.log('HTML:', html);
console.log('\n---\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Marker Cleanup Test',
  databaseId: '24ca89fe-dba5-806f-91a6-e831a6efe344',
  contentHtml: html,
  dryRun: false  // Actually create the page to test orchestration
})
.then(response => {
  console.log('✅ Page created successfully!');
  console.log('Page URL:', response.data.data.pageUrl);
  console.log('\nPlease check the Notion page to verify:');
  console.log('1. The callout contains the note text');
  console.log('2. The list items appear after the callout');
  console.log('3. NO marker text like "(sn2n:xxxxx)" is visible');
})
.catch(error => {
  console.error('❌ Error:', error.response?.data || error.message);
});
