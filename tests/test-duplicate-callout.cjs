const axios = require('axios');

// Exact structure from ServiceNow with Note inside itemgroup.info
const html = `
<ul class="ul">
  <li class="li">Admin account in GitHub.
    <div class="itemgroup info">
      <div class="note note note_note">
        <span class="note__title">Note:</span> 
        The OAuth 2.0 JWT grant type is supported for GitHub &amp; GitHub Enterprise with MID server.
      </div>
    </div>
  </li>
</ul>
`;

console.log('Testing exact ServiceNow structure...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Duplicate Callout Test',
  contentHtml: html,
  dryRun: false // Actually create the page to see what happens
})
.then(response => {
  console.log('\n✅ Page created!');
  console.log('URL:', response.data.data.url);
  console.log('\nPlease check the page and count how many callouts you see.');
})
.catch(error => {
  console.error('❌ Error:', error.response?.data?.message || error.message);
  if (error.response?.data?.details) {
    console.error('Details:', JSON.stringify(error.response.data.details, null, 2));
  }
});
