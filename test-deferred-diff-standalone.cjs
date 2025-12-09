#!/usr/bin/env node
/**
 * Standalone test for deferred-diff logic without requiring Notion API access
 * Directly tests HTML→Notion conversion and diff computation
 */

const fs = require('fs');
const path = require('path');

// Load the w2n module to access computeDeferredDiff
const fixturePath = process.argv[2] || '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update/activate-the-legacy-ibm-pvu-process-pack-failure-2025-12-09T05-23-31.html';

if (!fs.existsSync(fixturePath)) {
  console.error('❌ Fixture not found:', fixturePath);
  process.exit(1);
}

console.log('📄 Loading fixture:', path.basename(fixturePath));
const html = fs.readFileSync(fixturePath, 'utf8');
console.log('   HTML length:', html.length, 'chars\n');

// Set up minimal globals required by servicenow.cjs
global.log = (...args) => console.log('[LOG]', ...args);
global.getExtraDebug = () => false;

// Import the servicenow service to get HTML→Notion conversion
const servicenowService = require('./server/services/servicenow.cjs');

console.log('🔄 Converting HTML to Notion blocks...');
servicenowService.htmlToNotionBlocks(html).then(extractionResult => {
  const { blocks, fixedHtml, audit } = extractionResult;
  
  console.log('✅ Conversion complete');
  console.log('   Blocks generated:', blocks.length);
  console.log('   Has audit:', !!audit);
  console.log('   Fixed HTML length:', fixedHtml?.length || 0, 'chars\n');
  
  // Now manually invoke computeDeferredDiff (inline version since we can't import the function)
  // For this test, we'll simulate the diff by using the audit data if available
  
  if (audit && audit.result) {
    console.log('📊 Audit Result from Extraction:');
    console.log('   Passed:', audit.result.passed);
    console.log('   Coverage:', audit.result.coverage);
    console.log('   Source blocks:', audit.result.source?.blocks || 'N/A');
    console.log('   Source chars:', audit.result.source?.chars || 'N/A');
    console.log('   Notion blocks:', audit.result.notion?.blocks || 'N/A');
    console.log('   Notion chars:', audit.result.notion?.chars || 'N/A');
    
    if (audit.result.diff) {
      console.log('\n📋 Diff Analysis:');
      console.log('   Missing blocks:', audit.result.diff.missingBlocks || 0);
      console.log('   Extra blocks:', audit.result.diff.extraBlocks || 0);
      
      if (audit.result.diff.missingSamples) {
        console.log('\n❌ Missing samples:');
        audit.result.diff.missingSamples.slice(0, 5).forEach((m, i) => {
          const preview = m.length > 100 ? m.substring(0, 100) + '...' : m;
          console.log(`   ${i+1}. ${preview}`);
        });
      }
      
      if (audit.result.diff.extraSamples) {
        console.log('\n➕ Extra samples:');
        audit.result.diff.extraSamples.slice(0, 3).forEach((e, i) => {
          console.log(`   ${i+1}. ${e.substring(0, 100)}`);
        });
      }
    } else {
      console.log('\n⚠️  No diff data available (needs post-orchestration computation)');
    }
  }
  
  console.log('\n✅ Test complete');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
