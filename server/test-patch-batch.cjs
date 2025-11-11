#!/usr/bin/env node

/**
 * @file Batch test PATCH endpoint with pages needing updates
 * @description Tests the PATCH endpoint with all HTML files in patch/pages-to-update folder
 * 
 * Usage:
 *   node test-patch-batch.cjs [--dry-run] [--verbose]
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// Parse command-line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

const fixturesDir = path.join(__dirname, '../patch/pages-to-update');

console.log('🧪 Batch PATCH Endpoint Test');
console.log('============================');
console.log(`📁 Fixtures directory: ${fixturesDir}`);
console.log(`🧪 Dry run: ${dryRun ? 'YES' : 'NO'}`);
console.log(`📢 Verbose: ${verbose ? 'YES' : 'NO'}`);
console.log('');

// Read all HTML files
const files = fs.readdirSync(fixturesDir)
  .filter(f => f.endsWith('.html'))
  .sort();

console.log(`📄 Found ${files.length} HTML files to test\n`);

// Results tracking
const results = {
  total: files.length,
  success: 0,
  failed: 0,
  skipped: 0,
  details: []
};

/**
 * Extract page ID from HTML file
 */
function extractPageId(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/Page ID:\s*([a-f0-9-]{36})/i);
  if (match) {
    return match[1].replace(/-/g, ''); // Convert to 32-char format
  }
  return null;
}

/**
 * Extract title from filename
 */
function extractTitle(filename) {
  const base = path.basename(filename, '.html');
  const titleMatch = base.match(/^(.+?)-\d{4}-\d{2}-\d{2}T/);
  if (titleMatch) {
    return titleMatch[1]
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return base;
}

/**
 * Test PATCH endpoint with a file
 */
async function testFile(file) {
  const filePath = path.join(fixturesDir, file);
  const title = extractTitle(file);
  const pageId = extractPageId(filePath);
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📄 Testing: ${file}`);
  console.log(`📝 Title: ${title}`);
  
  if (!pageId) {
    console.log('⚠️  No page ID found in file - SKIPPING');
    results.skipped++;
    results.details.push({
      file,
      title,
      status: 'skipped',
      reason: 'No page ID found'
    });
    return;
  }
  
  console.log(`🆔 Page ID: ${pageId}`);
  
  // Read HTML content
  const html = fs.readFileSync(filePath, 'utf8');
  console.log(`📦 HTML size: ${html.length} characters`);
  
  // Prepare request
  const payload = JSON.stringify({
    title,
    contentHtml: html,
    dryRun
  });
  
  const options = {
    hostname: 'localhost',
    port: 3004,
    path: `/api/W2N/${pageId}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  };
  
  // Send request
  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          const responseData = response.data || response;
          
          if (res.statusCode === 200) {
            console.log('✅ SUCCESS');
            
            if (dryRun) {
              console.log(`   📦 Extracted: ${responseData.blocksExtracted} blocks`);
              console.log(`   🎬 Videos: ${responseData.hasVideos ? 'YES' : 'NO'}`);
              
              if (verbose && responseData.blockTypes) {
                console.log('   📊 Block types:');
                Object.entries(responseData.blockTypes)
                  .sort((a, b) => b[1] - a[1])
                  .forEach(([type, count]) => {
                    console.log(`      ${type}: ${count}`);
                  });
              }
            } else {
              console.log(`   🗑️  Deleted: ${responseData.blocksDeleted} blocks`);
              console.log(`   📤 Added: ${responseData.blocksAdded} blocks`);
              console.log(`   🔗 URL: ${responseData.pageUrl}`);
              
              if (responseData.validation) {
                const valid = responseData.validation.valid;
                console.log(`   🔍 Validation: ${valid ? '✅ PASSED' : '⚠️  WARNINGS'}`);
                
                if (!valid && verbose && responseData.validation.issues) {
                  console.log('   Issues:');
                  responseData.validation.issues.forEach((issue, i) => {
                    console.log(`      ${i + 1}. ${issue.type}: ${issue.message}`);
                  });
                }
              }
            }
            
            results.success++;
            results.details.push({
              file,
              title,
              pageId,
              status: 'success',
              blocksExtracted: responseData.blocksExtracted || responseData.blocksAdded,
              hasVideos: responseData.hasVideos,
              validation: responseData.validation
            });
          } else {
            console.log(`❌ FAILED (${res.statusCode})`);
            console.log(`   Error: ${response.error || 'Unknown'}`);
            console.log(`   Message: ${response.message || 'No message'}`);
            
            results.failed++;
            results.details.push({
              file,
              title,
              pageId,
              status: 'failed',
              statusCode: res.statusCode,
              error: response.error,
              message: response.message
            });
          }
        } catch (err) {
          console.log('❌ FAILED (Parse Error)');
          console.log(`   ${err.message}`);
          
          results.failed++;
          results.details.push({
            file,
            title,
            pageId,
            status: 'failed',
            error: 'PARSE_ERROR',
            message: err.message
          });
        }
        
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.log('❌ FAILED (Request Error)');
      console.log(`   ${err.message}`);
      
      results.failed++;
      results.details.push({
        file,
        title,
        pageId,
        status: 'failed',
        error: 'REQUEST_ERROR',
        message: err.message
      });
      
      resolve();
    });
    
    req.write(payload);
    req.end();
  });
}

/**
 * Run tests sequentially
 */
async function runTests() {
  const startTime = Date.now();
  
  for (let i = 0; i < files.length; i++) {
    await testFile(files[i]);
    
    // Rate limit protection: delay between requests
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Print summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 BATCH TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`⏱️  Duration: ${duration}s`);
  console.log(`📄 Total files: ${results.total}`);
  console.log(`✅ Success: ${results.success}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠️  Skipped: ${results.skipped}`);
  console.log('');
  
  // Success rate
  const successRate = ((results.success / results.total) * 100).toFixed(1);
  console.log(`📈 Success rate: ${successRate}%`);
  
  // Show failures if any
  if (results.failed > 0) {
    console.log('\n❌ Failed files:');
    results.details
      .filter(d => d.status === 'failed')
      .forEach((d, i) => {
        console.log(`   ${i + 1}. ${d.file}`);
        console.log(`      Error: ${d.error}`);
        console.log(`      Message: ${d.message}`);
      });
  }
  
  // Show skipped if any
  if (results.skipped > 0) {
    console.log('\n⚠️  Skipped files:');
    results.details
      .filter(d => d.status === 'skipped')
      .forEach((d, i) => {
        console.log(`   ${i + 1}. ${d.file}`);
        console.log(`      Reason: ${d.reason}`);
      });
  }
  
  // Block extraction stats (dry run only)
  if (dryRun && results.success > 0) {
    console.log('\n📊 Block Extraction Statistics:');
    
    const successful = results.details.filter(d => d.status === 'success');
    const totalBlocks = successful.reduce((sum, d) => sum + (d.blocksExtracted || 0), 0);
    const avgBlocks = (totalBlocks / successful.length).toFixed(1);
    const withVideos = successful.filter(d => d.hasVideos).length;
    
    console.log(`   Total blocks extracted: ${totalBlocks}`);
    console.log(`   Average per page: ${avgBlocks}`);
    console.log(`   Pages with videos: ${withVideos}`);
  }
  
  // Validation stats (actual run only)
  if (!dryRun && results.success > 0) {
    console.log('\n🔍 Validation Statistics:');
    
    const withValidation = results.details.filter(d => d.status === 'success' && d.validation);
    if (withValidation.length > 0) {
      const validCount = withValidation.filter(d => d.validation.valid).length;
      const validRate = ((validCount / withValidation.length) * 100).toFixed(1);
      
      console.log(`   Pages validated: ${withValidation.length}`);
      console.log(`   Validation passed: ${validCount}`);
      console.log(`   Validation rate: ${validRate}%`);
    } else {
      console.log('   No validation data (set SN2N_VALIDATE_OUTPUT=1 to enable)');
    }
  }
  
  console.log('');
  console.log(dryRun ? '✅ Dry run complete!' : '✅ Batch update complete!');
  
  // Exit with error code if any failures
  process.exit(results.failed > 0 ? 1 : 0);
}

// Check if server is running
const checkServer = new Promise((resolve, reject) => {
  const req = http.get('http://localhost:3004/health', (res) => {
    resolve();
  });
  req.on('error', (err) => {
    reject(new Error('Server not running. Start it with: npm start'));
  });
  req.setTimeout(2000, () => {
    req.destroy();
    reject(new Error('Server not responding. Check if it\'s running on port 3004.'));
  });
});

// Run tests
checkServer
  .then(() => {
    console.log('✅ Server is running');
    console.log('');
    return runTests();
  })
  .catch((err) => {
    console.error('❌ Server check failed:', err.message);
    console.error('');
    console.error('Make sure the proxy server is running:');
    console.error('  cd server && npm start');
    process.exit(1);
  });
