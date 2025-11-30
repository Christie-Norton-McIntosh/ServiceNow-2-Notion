#!/usr/bin/env node
/**
 * Validate all pages in pages-to-update directory with dry-run
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PAGES_DIR = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update';
const SERVER_URL = 'http://localhost:3004';
const DATABASE_ID = '282a89fedba5815e91f0db972912ef9f';

function makeRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 3004,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 120000
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.write(data);
    req.end();
  });
}

async function validateAllPages() {
  console.log('📋 Validating all pages in pages-to-update directory\n');
  
  // Get all HTML files
  const files = fs.readdirSync(PAGES_DIR)
    .filter(f => f.endsWith('.html'))
    .sort();
  
  console.log(`Found ${files.length} HTML files\n`);
  
  const results = [];
  
  for (const file of files) {
    const filePath = path.join(PAGES_DIR, file);
    const title = file.replace(/-2025.*\.html$/, '').replace(/-/g, ' ');
    
    process.stdout.write(`📄 ${title.substring(0, 50)}...`);
    
    try {
      const htmlContent = fs.readFileSync(filePath, 'utf-8');
      
      const payload = {
        title: title,
        databaseId: DATABASE_ID,
        contentHtml: htmlContent,
        dryRun: true
      };
      
      const response = await makeRequest('/api/W2N', payload);
      const data = response.data || response;
      const children = data.children || [];
      
      // Count block types
      const counts = {
        total: children.length,
        callouts: children.filter(b => b.type === 'callout').length,
        tables: children.filter(b => b.type === 'table').length,
        images: children.filter(b => b.type === 'image').length,
        lists: children.filter(b => b.type === 'bulleted_list_item' || b.type === 'numbered_list_item').length,
        code: children.filter(b => b.type === 'code').length
      };
      
      // Check for nested callouts in lists (the issue we just fixed)
      let nestedCalloutsFound = 0;
      function countNestedCallouts(blocks) {
        for (const block of blocks) {
          if ((block.type === 'bulleted_list_item' || block.type === 'numbered_list_item')) {
            const typed = block[block.type];
            if (typed && typed.children) {
              for (const child of typed.children) {
                if (child.type === 'callout') {
                  nestedCalloutsFound++;
                }
                countNestedCallouts([child]);
              }
            }
          }
        }
      }
      countNestedCallouts(children);
      
      results.push({
        file,
        title,
        success: true,
        counts,
        nestedCallouts: nestedCalloutsFound,
        warnings: data.warnings || []
      });
      
      console.log(` ✅ (${counts.total} blocks, ${counts.callouts} callouts)`);
      
    } catch (error) {
      results.push({
        file,
        title,
        success: false,
        error: error.message
      });
      console.log(` ❌ ${error.message}`);
    }
    
    // Small delay to avoid overwhelming server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 VALIDATION SUMMARY\n');
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  console.log(`❌ Failed: ${failed.length}\n`);
  
  if (failed.length > 0) {
    console.log('Failed validations:');
    failed.forEach(r => {
      console.log(`   ❌ ${r.title}: ${r.error}`);
    });
    console.log();
  }
  
  // Check for pages with potential issues
  const pagesWithNestedCallouts = successful.filter(r => r.nestedCallouts > 0);
  const pagesWithWarnings = successful.filter(r => r.warnings && r.warnings.length > 0);
  
  if (pagesWithNestedCallouts.length > 0) {
    console.log('⚠️  Pages with nested callouts in lists (fixed by our update):');
    pagesWithNestedCallouts.forEach(r => {
      console.log(`   • ${r.title}: ${r.nestedCallouts} nested callout(s)`);
    });
    console.log();
  }
  
  if (pagesWithWarnings.length > 0) {
    console.log('⚠️  Pages with warnings:');
    pagesWithWarnings.forEach(r => {
      console.log(`   • ${r.title}: ${r.warnings.length} warning(s)`);
      r.warnings.forEach(w => console.log(`      - ${w}`));
    });
    console.log();
  }
  
  // Summary statistics
  console.log('📈 Block type statistics:');
  const totals = {
    total: 0,
    callouts: 0,
    tables: 0,
    images: 0,
    lists: 0,
    code: 0
  };
  
  successful.forEach(r => {
    Object.keys(totals).forEach(key => {
      totals[key] += r.counts[key];
    });
  });
  
  console.log(`   Total blocks: ${totals.total}`);
  console.log(`   Callouts: ${totals.callouts}`);
  console.log(`   Tables: ${totals.tables}`);
  console.log(`   Images: ${totals.images}`);
  console.log(`   Lists: ${totals.lists}`);
  console.log(`   Code blocks: ${totals.code}`);
  
  return successful.length === results.length;
}

validateAllPages()
  .then(success => {
    console.log(`\n${success ? '✅ ALL PAGES VALIDATED SUCCESSFULLY' : '❌ SOME PAGES FAILED VALIDATION'}`);
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
