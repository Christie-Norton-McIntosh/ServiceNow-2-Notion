#!/usr/bin/env node

/**
 * Re-test validation failure HTML files to see if they now pass with the duplicate callout fix.
 * This script sends each captured validation failure HTML to the proxy server for conversion
 * and tracks which ones now pass vs still fail.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'validation-failures');
const RESULTS_FILE = path.join(__dirname, '..', 'validation-retest-results.json');
const PROXY_HOST = 'localhost';
const PROXY_PORT = 3004;

// Test database ID (you may need to update this)
// Set to null to use dry-run mode (validation only, no page creation)
const TEST_DATABASE_ID = process.env.TEST_DATABASE_ID || null;
const DRY_RUN = !TEST_DATABASE_ID; // Dry run if no database ID provided

async function sendToProxy(html, title) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      contentHtml: html,
      title: title,
      databaseId: TEST_DATABASE_ID,
      dryRun: DRY_RUN
    });

    const options = {
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      path: '/api/W2N',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          resolve({
            success: res.statusCode === 200,
            statusCode: res.statusCode,
            response: response
          });
        } catch (e) {
          reject(new Error(`Failed to parse response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(payload);
    req.end();
  });
}

async function testFile(filename) {
  const filePath = path.join(FIXTURES_DIR, filename);
  
  console.log(`\n📄 Testing: ${filename}`);
  
  try {
    const html = fs.readFileSync(filePath, 'utf8');
    
    // Extract title from filename (remove timestamp)
    const title = filename
      .replace(/-2025-11-\d{2}T\d{2}-\d{2}-\d{2}\.html$/, '')
      .replace(/-/g, ' ');
    
    console.log(`   Title: ${title}`);
    console.log(`   Sending to proxy...`);
    
    const result = await sendToProxy(html, title);
    
    if (result.success) {
      console.log(`   ✅ PASSED - No validation errors`);
      console.log(`   🗑️  Removing from validation-failures folder...`);
      
      // Delete the file since it now passes
      try {
        fs.unlinkSync(filePath);
        console.log(`   ✓ Deleted`);
      } catch (deleteError) {
        console.log(`   ⚠️  Could not delete file: ${deleteError.message}`);
      }
      
      return { filename, status: 'passed', removed: true, ...result };
    } else {
      console.log(`   ❌ FAILED - Status: ${result.statusCode}`);
      if (result.response.validationErrors) {
        console.log(`   Validation errors:`, JSON.stringify(result.response.validationErrors, null, 2));
      }
      console.log(`   📌 Keeping in validation-failures folder for further investigation`);
      return { filename, status: 'failed', ...result };
    }
  } catch (error) {
    console.log(`   ⚠️  ERROR - ${error.message}`);
    console.log(`   📌 Keeping in validation-failures folder`);
    return { filename, status: 'error', error: error.message };
  }
}

async function main() {
  console.log('🔄 Re-testing validation failures with duplicate callout fix...\n');
  
  // Get all HTML files
  const files = fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.html'))
    .sort();
  
  console.log(`Found ${files.length} validation failure files to re-test\n`);
  
  // Check mode
  if (DRY_RUN) {
    console.log('🔍 Running in DRY-RUN mode (validation only, no pages created)');
    console.log('   To create actual pages, set TEST_DATABASE_ID environment variable\n');
  } else {
    console.log(`📝 Running in LIVE mode - pages will be created in database: ${TEST_DATABASE_ID}\n`);
  }
  
  const results = {
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    passed: [],
    failed: [],
    errors: []
  };
  
  // Test each file with a small delay between requests
  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    
    console.log(`\n[${i + 1}/${files.length}]`);
    
    const result = await testFile(filename);
    
    if (result.status === 'passed') {
      results.passed.push(result);
    } else if (result.status === 'failed') {
      results.failed.push(result);
    } else {
      results.errors.push(result);
    }
    
    // Small delay to avoid overwhelming the server
    if (i < files.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  
  // Print summary
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total files tested: ${results.totalFiles}`);
  console.log(`✅ Passed (removed): ${results.passed.length} (${(results.passed.length/results.totalFiles*100).toFixed(1)}%)`);
  console.log(`❌ Still failing: ${results.failed.length} (${(results.failed.length/results.totalFiles*100).toFixed(1)}%)`);
  console.log(`⚠️  Errors: ${results.errors.length} (${(results.errors.length/results.totalFiles*100).toFixed(1)}%)`);
  console.log('\n📄 Results saved to:', RESULTS_FILE);
  
  // Count remaining files in validation-failures folder
  const remainingFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.html'));
  
  console.log('\n📁 VALIDATION-FAILURES FOLDER:');
  console.log(`   Files before: ${results.totalFiles}`);
  console.log(`   Files removed: ${results.passed.length}`);
  console.log(`   Files remaining: ${remainingFiles.length}`);
  if (remainingFiles.length > 0) {
    console.log(`   → These ${remainingFiles.length} files still need investigation for other issues`);
  } else {
    console.log(`   → All validation failures fixed! 🎉`);
  }
  
  // Show improvement estimate
  const beforeFailures = results.totalFiles; // All were failures before
  const afterFailures = results.failed.length + results.errors.length;
  const improvement = beforeFailures - afterFailures;
  
  console.log('\n📈 IMPROVEMENT FROM DUPLICATE CALLOUT FIX:');
  console.log(`   Before fix: ${beforeFailures} failures`);
  console.log(`   After fix:  ${afterFailures} failures`);
  console.log(`   Fixed by this change: ${improvement} pages (${(improvement/beforeFailures*100).toFixed(1)}%)`);
  console.log('='.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
