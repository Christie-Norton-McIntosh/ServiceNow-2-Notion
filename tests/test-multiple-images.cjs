const axios = require('axios');

// Test with multiple ServiceNow images exactly as provided
const html = `
<p>First image:</p>
<img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-jwt-config-01.png?_LANG=enus" class="image expandable" id="dev-ops-config-github-acct-jwt__image_omg_pk4_ybc" alt="Auto configure with existing token." data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-jwt-config-01.png?_LANG=enus" data-title="Auto configure with existing token." role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;">

<p>Second image:</p>
<img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-oauth-jwt-app-registries.png?_LANG=enus" class="image expandable" id="dev-ops-reg-github-oauth-prov-jwt__image_b5x_jgp_31c" alt="Application Registry form" data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-oauth-jwt-app-registries.png?_LANG=enus" data-title="Application Registry form" role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;">

<p>Third image:</p>
<img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/concept/../image/github-oauth-provider.png?_LANG=enus" class="image expandable" alt="Form that shows the result field is set to track." data-fancy="gallery" data-gallery="gallery" data-remote="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/page/product/enterprise-dev-ops/image/github-oauth-provider.png?_LANG=enus" data-title="Form that shows the result field is set to track." role="button" tabindex="0" aria-label="Open image in gallery mode" style="cursor: pointer;">

<p>After images.</p>
`;

console.log('Testing multiple ServiceNow images...\n');

axios.post('http://localhost:3004/api/W2N', {
  title: 'Multiple Images Test',
  contentHtml: html,
  dryRun: true
})
.then(response => {
  const blocks = response.data.data.children;
  console.log(`Got ${blocks.length} block(s)\n`);
  
  let imageCount = 0;
  blocks.forEach((block, i) => {
    console.log(`Block ${i + 1}: ${block.type}`);
    if (block.type === 'image') {
      imageCount++;
      console.log(`  ✅ IMAGE #${imageCount}`);
      console.log(`  Type: ${block.image.type}`);
      if (block.image.external) {
        console.log(`  External URL: ${block.image.external.url.substring(0, 80)}...`);
      }
      if (block.image.file_upload) {
        console.log(`  Upload ID: ${block.image.file_upload.id}`);
      }
      if (block.image.caption && block.image.caption.length > 0) {
        console.log(`  Caption: ${block.image.caption.map(c => c.text.content).join('')}`);
      }
    }
    console.log();
  });
  
  console.log(`\n📊 Summary: ${imageCount} images found out of ${blocks.length} total blocks`);
  if (imageCount !== 3) {
    console.log(`\n⚠️ WARNING: Expected 3 images, but found ${imageCount}!`);
  }
})
.catch(error => {
  console.error('❌ Error:', error.response?.data || error.message);
  if (error.response?.data?.error) {
    console.error('Error details:', error.response.data.error);
  }
});
