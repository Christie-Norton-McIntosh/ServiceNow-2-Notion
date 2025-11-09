#!/usr/bin/env node
/**
 * Test fixture runner - processes saved HTML fixtures through the converter
 * Usage: node tests/test-fixture.js <fixture-file.html>
 * 
 * Example:
 *   node tests/test-fixture.js tests/fixtures/validation-failures/add-or-modify-2025-11-09.html
 *   node tests/test-fixture.js tests/fixtures/manual-samples/nested-tables.html
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

function parseMetadata(html) {
  const metadataMatch = html.match(/<!--\s*([\s\S]*?)\s*-->/);
  if (!metadataMatch) return null;
  
  const metadata = {};
  const lines = metadataMatch[1].split('\n');
  
  for (const line of lines) {
    const match = line.trim().match(/^([^:]+):\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      metadata[key] = value;
    }
  }
  
  return metadata;
}

async function testFixture(fixtureFile) {
  log('\n' + '='.repeat(80), colors.bright);
  log('Test Fixture Runner', colors.bright);
  log('='.repeat(80) + '\n', colors.bright);
  
  // Read fixture file
  if (!fs.existsSync(fixtureFile)) {
    log(`❌ Fixture file not found: ${fixtureFile}`, colors.red);
    process.exit(1);
  }
  
  const html = fs.readFileSync(fixtureFile, 'utf8');
  const metadata = parseMetadata(html);
  
  // Display metadata
  if (metadata) {
    log('📋 Fixture Metadata:', colors.cyan);
    Object.keys(metadata).forEach(key => {
      log(`   ${key}: ${metadata[key]}`, colors.cyan);
    });
    log('');
  }
  
  // Strip metadata comment from HTML
  const cleanHtml = html.replace(/<!--\s*[\s\S]*?\s*-->/, '').trim();
  
  log(`📊 HTML length: ${cleanHtml.length} characters`, colors.blue);
  log(`📊 Contains ${(cleanHtml.match(/<table/g) || []).length} table(s)`, colors.blue);
  log(`📊 Contains ${(cleanHtml.match(/<ol/g) || []).length} ordered list(s)`, colors.blue);
  log(`📊 Contains ${(cleanHtml.match(/<ul/g) || []).length} unordered list(s)`, colors.blue);
  log('');
  
  // Send to proxy for dry-run conversion
  const payload = {
    title: metadata?.Page || path.basename(fixtureFile, '.html'),
    contentHtml: cleanHtml,
    dryRun: true
  };
  
  const postData = JSON.stringify(payload);
  
  const options = {
    hostname: 'localhost',
    port: 3004,
    path: '/api/W2N',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  log('🚀 Sending to proxy server (dryRun mode)...', colors.yellow);
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          log('\n✅ Conversion successful!', colors.green);
          log(`📦 Generated ${result.children?.length || 0} blocks`, colors.green);
          
          if (result.hasVideos) {
            log('🎥 Video content detected', colors.yellow);
          }
          
          if (result.warnings && result.warnings.length > 0) {
            log(`\n⚠️  ${result.warnings.length} warning(s):`, colors.yellow);
            result.warnings.forEach((w, i) => {
              log(`   ${i + 1}. ${w}`, colors.yellow);
            });
          }
          
          // Display block summary
          if (result.children && result.children.length > 0) {
            log('\n📋 Block Summary:', colors.cyan);
            const blockTypes = {};
            result.children.forEach(block => {
              blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
            });
            
            Object.keys(blockTypes).sort().forEach(type => {
              log(`   ${type}: ${blockTypes[type]}`, colors.cyan);
            });
            
            // Show first few blocks
            log('\n📝 First 5 blocks:', colors.cyan);
            result.children.slice(0, 5).forEach((block, i) => {
              const preview = JSON.stringify(block).substring(0, 100);
              log(`   ${i}: ${block.type} - ${preview}...`, colors.cyan);
            });
          }
          
          // Compare with expected metadata
          if (metadata && metadata['Block Count (expected)']) {
            const expected = parseInt(metadata['Block Count (expected)']);
            const actual = result.children?.length || 0;
            const diff = actual - expected;
            
            log('\n📊 Block Count Comparison:', colors.cyan);
            log(`   Expected: ${expected}`, colors.cyan);
            log(`   Actual: ${actual}`, colors.cyan);
            log(`   Difference: ${diff >= 0 ? '+' : ''}${diff}`, diff === 0 ? colors.green : colors.yellow);
          }
          
          log('\n' + '='.repeat(80), colors.bright);
          log('Test Complete', colors.green);
          log('='.repeat(80) + '\n', colors.bright);
          
          resolve(result);
        } catch (parseError) {
          log(`\n❌ Failed to parse response: ${parseError.message}`, colors.red);
          log(`Response data: ${data}`, colors.red);
          reject(parseError);
        }
      });
    });
    
    req.on('error', (error) => {
      log(`\n❌ Request failed: ${error.message}`, colors.red);
      log('Make sure the server is running on port 3004', colors.yellow);
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  log('Usage: node tests/test-fixture.js <fixture-file.html>', colors.yellow);
  log('\nExamples:', colors.cyan);
  log('  node tests/test-fixture.js tests/fixtures/validation-failures/add-or-modify.html', colors.cyan);
  log('  node tests/test-fixture.js tests/fixtures/manual-samples/nested-tables.html', colors.cyan);
  log('\nTo run all fixtures in a directory:', colors.cyan);
  log('  for f in tests/fixtures/validation-failures/*.html; do node tests/test-fixture.js "$f"; done', colors.cyan);
  process.exit(1);
}

const fixtureFile = args[0];

testFixture(fixtureFile)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    log(`\n❌ Test failed: ${error.message}`, colors.red);
    process.exit(1);
  });
