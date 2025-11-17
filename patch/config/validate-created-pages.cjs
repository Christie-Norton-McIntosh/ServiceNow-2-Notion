#!/usr/bin/env node

/**
 * Validate all created pages against their source HTML
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const FAILED_PAGES_DIR = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/failed-pages';
const SERVER_URL = 'http://localhost:3004';

async function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          resolve({ rawBody: body });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function validateCreatedPages() {
  console.log('🔍 Validating created pages against source HTML\n');
  
  // Read all error files (which actually contain success data)
  const errorFiles = fs.readdirSync(FAILED_PAGES_DIR).filter(f => f.endsWith('-error.json'));
  
  let successCount = 0;
  let failCount = 0;
  const failures = [];
  
  for (const errorFile of errorFiles) {
    const errorFilePath = path.join(FAILED_PAGES_DIR, errorFile);
    const errorData = JSON.parse(fs.readFileSync(errorFilePath, 'utf8'));
    
    // Extract page ID and find corresponding HTML file
    const pageId = errorData.data?.page?.id;
    const pageTitle = errorData.data?.page?.title;
    
    if (!pageId) {
      console.log(`❌ ${errorFile}: No page ID found`);
      continue;
    }
    
    // Find HTML file
    const htmlFileName = errorFile.replace('-error.json', '.html');
    const htmlFilePath = path.join(FAILED_PAGES_DIR, htmlFileName);
    
    if (!fs.existsSync(htmlFilePath)) {
      console.log(`⚠️  ${pageTitle}: HTML file not found`);
      continue;
    }
    
    console.log(`📄 ${pageTitle}`);
    console.log(`   Page ID: ${pageId}`);
    
    // Validate page
    const cleanPageId = pageId.replace(/-/g, '');
    const validationResponse = await makeRequest('GET', `/api/validate/${cleanPageId}`);
    
    if (validationResponse.success && validationResponse.data?.validation) {
      const validation = validationResponse.data.validation;
      
      if (validation.hasErrors) {
        failCount++;
        console.log(`   ❌ VALIDATION FAILED`);
        console.log(`   Errors:`);
        validation.errors.forEach(err => console.log(`      - ${err}`));
        failures.push({ pageTitle, pageId, errors: validation.errors });
      } else {
        successCount++;
        console.log(`   ✅ VALIDATION PASSED`);
        
        // Show metrics
        const metrics = validation.metrics;
        console.log(`   Metrics:`);
        console.log(`      - ${metrics.totalBlocks} total blocks`);
        console.log(`      - ${metrics.calloutBlocks} callouts`);
        console.log(`      - ${metrics.tableBlocks} tables`);
        console.log(`      - ${metrics.imageBlocks} images`);
        console.log(`      - ${metrics.listBlocks} lists`);
      }
    } else {
      console.log(`   ⚠️  Could not validate: ${validationResponse.message || 'Unknown error'}`);
    }
    
    console.log('');
  }
  
  console.log('================================');
  console.log('📊 Validation Summary');
  console.log('================================');
  console.log(`✅ Passed: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log('');
  
  if (failures.length > 0) {
    console.log('❌ Failed Pages:');
    failures.forEach(({ pageTitle, pageId, errors }) => {
      console.log(`\n   ${pageTitle} (${pageId})`);
      errors.forEach(err => console.log(`      - ${err}`));
    });
  } else {
    console.log('🎉 ALL PAGES VALIDATED SUCCESSFULLY!');
  }
}

validateCreatedPages().catch(console.error);
