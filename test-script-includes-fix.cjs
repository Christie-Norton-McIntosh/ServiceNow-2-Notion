#!/usr/bin/env node
/**
 * Test PATCH dry-run for the failing "Script includes and customization" page
 * to verify Fix #1 (marker stripping) and Fix #2 (menu collapsing) improvements
 */

const fs = require('fs');
const axios = require('axios');

const API_URL = 'http://localhost:3004/api/W2N';

// The HTML from the attached failing page
const htmlFile = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/updated-pages/script-includes-and-customization-content-validation-failed-2025-12-06T01-40-18.html';
const fileContent = fs.readFileSync(htmlFile, 'utf8');

// Extract page ID from comment at top
const pageIdMatch = fileContent.match(/Page ID:\s*([a-f0-9\-]+)/i);
const pageId = pageIdMatch ? pageIdMatch[1] : '2c1a89fe-dba5-81dc-b0e6-e55d5fd9db30';

// Extract the actual HTML content (remove the comment header)
const htmlStart = fileContent.indexOf('<div class="zDocsTopicPageBody"');
const actualHtml = fileContent.substring(htmlStart);

const payload = {
  title: 'Script includes and customization',
  contentHtml: actualHtml,
  dryRun: true,
  url: 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html'
};

console.log(`🧪 Running PATCH dry-run with fixes #1 + #2 for page ${pageId}...\n`);

axios.patch(`${API_URL}/${pageId}`, payload)
  .then(response => {
    const result = response.data;
    console.log('Full response:', JSON.stringify(result, null, 2).substring(0, 2000));
    
    console.log('✅ PATCH dry-run completed!\n');
    console.log('=== AUDIT RESULTS ===');
    console.log(`Coverage: ${audit.coverage}% (threshold: ${audit.threshold})`);
    console.log(`Passed: ${audit.passed ? '✅ YES' : '❌ NO'}`);
    
    if (audit.detailedComparison) {
      const dc = audit.detailedComparison;
      console.log('\n=== DETAILED COMPARISON ===');
      console.log(`HTML segments: ${dc.htmlSegmentCount}`);
      console.log(`Notion segments: ${dc.notionSegmentCount}`);
      console.log(`Missing segments (reported): ${dc.missingSegments ? dc.missingSegments.length : 0}`);
      console.log(`Extra segments (reported): ${dc.extraSegments ? dc.extraSegments.length : 0}`);
      console.log(`Group matches found: ${dc.groupMatches ? dc.groupMatches.length : 0}`);
      
      if (dc.groupMatches && dc.groupMatches.length > 0) {
        console.log('\n=== GROUP MATCHES (first 10) ===');
        dc.groupMatches.slice(0, 10).forEach((match, idx) => {
          const conf = match.confidence ? ` (confidence: ${match.confidence.toFixed(4)})` : '';
          console.log(`${idx + 1}. ${match.type}${conf}`);
          if (match.missingGroup && match.missingGroup.length <= 3) {
            console.log(`   Missing: ${match.missingGroup.map(s => `"${s.text}"`).join(' + ')}`);
          } else if (match.missingGroup) {
            console.log(`   Missing: [${match.missingGroup.length} segments]`);
          }
          if (match.extraSegment) {
            const txt = match.extraSegment.text.substring(0, 80);
            console.log(`   Extra: "${txt}${match.extraSegment.text.length > 80 ? '...' : ''}"`);
          }
        });
      }
      
      console.log(`\nTotal missing chars: ${dc.totalMissingChars}`);
      console.log(`Total extra chars: ${dc.totalExtraChars}`);
      console.log(`Fuzzy matched chars: ${audit.fuzzyMatchedChars || 0}`);
      console.log(`Adjusted coverage: ${audit.adjustedCoverage}%`);
    }
    
    console.log('\n=== COMPARISON TO PREVIOUS FAILURE ===');
    console.log('Previous: coverage 72.5% (FAILED), fuzzyMatchedChars: 0');
    console.log(`Current:  coverage ${audit.coverage}% (${audit.passed ? 'PASSED ✅' : 'FAILED ❌'}), fuzzyMatchedChars: ${audit.fuzzyMatchedChars || 0}`);
    
    console.log('\n=== IMPROVEMENT ANALYSIS ===');
    if (audit.coverage > 72.5) {
      console.log(`✅ Coverage improved by ${(audit.coverage - 72.5).toFixed(1)}%`);
    }
    if ((audit.fuzzyMatchedChars || 0) > 0) {
      console.log(`✅ Fuzzy matching now counts ${audit.fuzzyMatchedChars} chars toward adjusted coverage`);
    }
    if (audit.passed && !result.passed) {
      console.log('✅ Validation status changed: now passes!');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error during PATCH dry-run:');
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Data:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
    process.exit(1);
  });
