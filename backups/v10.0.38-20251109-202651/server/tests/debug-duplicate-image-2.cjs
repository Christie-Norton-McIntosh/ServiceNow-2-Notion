const axios = require('axios');
const BASE = process.env.SN2N_PROXY_URL || 'http://localhost:3004/api/W2N';
(async function(){
  const payload = {
    title: 'Debug duplicate image 2',
    contentHtml: `
      <p>Figure repeated below</p>
      <figure><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/image1.png?_LANG=enus" alt="img"/></figure>
      <p>Some text</p>
      <figure><img src="https://servicenow-be-prod.servicenow.com/bundle/yokohama-it-service-management/image1.png?_LANG=enus" alt="img"/></figure>
    `,
    dryRun: true
  };
  try {
    const res = await axios.post(BASE, payload, { timeout: 120000 });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (e) {
    console.error('Request error', e && e.message);
  }
})();
