const axios = require('axios');

// Test with actual ServiceNow image HTML
const html = `
<p>Configuration screen:</p>
<img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-jwt-config-01.png?_LANG=enus" class="image expandable" id="dev-ops-config-github-acct-jwt__image_omg_pk4_ybc" alt="Auto configure with existing token." data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-jwt-config-01.png?_LANG=enus" data-title="Auto configure with existing token." role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;">
<p>After configuration:</p>
`;

console.log('Testing ServiceNow image processing...\n');
console.log('Image URL:', 'https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-jwt-config-01.png?_LANG=enus\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'ServiceNow Image Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    if (block.image) {
      console.log(`  ✅ IMAGE FOUND!`);
      console.log(`  Image type: ${block.image.type}`);
      if (block.image.external) {
        console.log(`  External URL: ${block.image.external.url}`);
      }
      if (block.image.file_upload) {
        console.log(`  Upload ID: ${block.image.file_upload.id}`);
      }
      if (block.image.caption) {
        console.log(`  Caption: ${block.image.caption.map(c => c.text.content).join('')}`);
      }
    }
    console.log();
  });
})
.catch(error => {
  console.error('❌ Error:', error.response?.data || error.message);
  if (error.response?.data?.error) {
    console.error('Error details:', error.response.data.error);
  }
});
