#!/usr/bin/env node

/**
 * Test script: Verify LCS comparator is significantly less strict than phrase-based
 * Tests the compareTexts() function directly with controlled inputs
 */

const { compareTexts, canonicalizeText, tokenizeWords } = require('./server/utils/lcs-comparator.cjs');

function testCase(name, htmlText, notionText, expectedCoverageMin, expectedMethod = 'presence') {
  console.log(`\n📌 Test: ${name}`);
  console.log(`   HTML: "${htmlText}"`);
  console.log(`   Notion: "${notionText}"`);

  const result = compareTexts(htmlText, notionText, {
    sectionBased: false,
    minMissingSpanTokens: 40,
    maxCells: 50000000,
  });

  const passed = result.coverage >= expectedCoverageMin && result.method === expectedMethod;
  const icon = passed ? '✅' : '❌';

  console.log(`   ${icon} Coverage: ${(result.coverage * 100).toFixed(2)}% (expected ≥ ${(expectedCoverageMin * 100).toFixed(0)}%)`);
  console.log(`   ${icon} Method: ${result.method} (expected ${expectedMethod})`);
  console.log(`   Matched: ${result.lcsLength}/${result.srcTokenCount} tokens`);

  if (result.missingSpans?.length > 0) {
    console.log(`   Missing spans: ${result.missingSpans.length}`);
  }

  return passed;
}

async function runTests() {
  console.log('🧪 LCS Comparator Test Suite\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  let passed = 0;
  let total = 0;

  // Test 1: Identical content
  total++;
  if (testCase(
    'Identical content',
    'The quick brown fox jumps over the lazy dog',
    'The quick brown fox jumps over the lazy dog',
    1.0  // Should have 100% coverage
  )) passed++;

  // Test 2: Content reordered (LCS should handle this well)
  total++;
  if (testCase(
    'Content reordered (LCS strength)',
    'alpha beta gamma delta epsilon',
    'epsilon delta gamma beta alpha',
    0.8  // LCS should match all tokens regardless of order
  )) passed++;

  // Test 3: Some words missing from Notion (but present in HTML)
  total++;
  if (testCase(
    'Some words deleted from Notion',
    'the quick brown fox jumps over the lazy dog',
    'quick fox jumps dog',
    0.4  // 4/9 tokens matched (44.44%)
  )) passed++;

  // Test 4: Extra words in Notion (shouldn't affect coverage)
  total++;
  if (testCase(
    'Extra words in Notion (HTML tokens still covered)',
    'alpha beta gamma',
    'alpha extra words beta more gamma text',
    1.0  // All 3 HTML tokens present in Notion
  )) passed++;

  // Test 5: Almost no overlap
  total++;
  if (testCase(
    'Almost no overlap',
    'foo bar baz',
    'qux quux corge',
    0.0  // No common tokens
  )) passed++;

  // Test 6: Partial overlap with reordering
  total++;
  if (testCase(
    'Partial overlap with reordering (realistic scenario)',
    'ServiceNow integration allows automated task creation and status updates',
    'status updates are automated ServiceNow integration for task creation',
    0.7  // Most tokens present, different order
  )) passed++;

  // Test 7: Whitespace normalization (should be identical after canonicalization)
  total++;
  if (testCase(
    'Whitespace handling',
    'foo   bar\n\nbaz',
    'foo bar baz',
    1.0  // Should normalize to same tokens
  )) passed++;

  // Test 8: Punctuation normalization
  total++;
  if (testCase(
    'Punctuation handling',
    'Hello, world! That\'s "wonderful".',
    'Hello world Thats wonderful',
    1.0  // Punctuation should be stripped/normalized
  )) passed++;

  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`\n📊 Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('🎉 All tests passed! LCS comparator working as expected.\n');
    process.exit(0);
  } else {
    console.log(`⚠️  ${total - passed} test(s) failed. Check algorithm logic.\n`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
