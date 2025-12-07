#!/usr/bin/env node

/**
 * Test CurrentReleaseURL property population
 * Tests the regex conversion and property mapping
 */

const testUrl = 'https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/asset-management/task/t_AutoMatchExistingModel.html';

console.log('Testing CurrentReleaseURL conversion:');
console.log('Input URL:', testUrl);

const urlMatch = testUrl.match(/\/docs\/bundle\/[^\/]+\/page\/.*\/(.*\.html)/);
if (urlMatch && urlMatch[1]) {
  const topicName = urlMatch[1];
  const currentReleaseURL = `https://www.servicenow.com/docs/csh?topicname=${topicName}&version=latest`;
  console.log('✅ Match found:', topicName);
  console.log('✅ CurrentReleaseURL:', currentReleaseURL);
} else {
  console.log('❌ No match found');
}

// Test with the actual page from user's request
const actualPageUrl = 'https://www.servicenow.com/docs/bundle/xanadu-it-service-management/page/product/asset-management/concept/swam-legacy-plugin.html';
console.log('\n\nTesting with actual page URL:');
console.log('Input URL:', actualPageUrl);

const actualMatch = actualPageUrl.match(/\/docs\/bundle\/[^\/]+\/page\/.*\/(.*\.html)/);
if (actualMatch && actualMatch[1]) {
  const topicName = actualMatch[1];
  const currentReleaseURL = `https://www.servicenow.com/docs/csh?topicname=${topicName}&version=latest`;
  console.log('✅ Match found:', topicName);
  console.log('✅ CurrentReleaseURL:', currentReleaseURL);
} else {
  console.log('❌ No match found');
}
