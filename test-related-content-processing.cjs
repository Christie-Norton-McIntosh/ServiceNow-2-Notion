#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function testRelatedContent() {
  try {
    // Read test HTML
    const htmlPath = path.join(__dirname, 'test-related-content.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    console.log('Testing Related Content processing...');
    console.log('HTML content length:', htmlContent.length);

    // Send to server (without dryRun since it's not supported for POST)
    const response = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Test Related Content',
      databaseId: 'test-db-id',
      contentHtml: htmlContent
    });

    console.log('Server response received');
    console.log('Response status:', response.status);
    console.log('Response success:', response.data.success);

    if (response.data.success) {
      console.log('✅ Request successful - page created');
      console.log('Page ID:', response.data.data?.id || 'unknown');
    } else {
      console.log('❌ Request failed:', response.data.error);
    }

  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Server response:', error.response.status, error.response.data);
    }
  }
}

testRelatedContent();