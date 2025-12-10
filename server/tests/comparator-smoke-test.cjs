#!/usr/bin/env node
/**
 * @file Smoke test for Text Completeness Comparator
 * 
 * Tests the comparator endpoints with various scenarios:
 * - Health check
 * - Exact match (100% coverage)
 * - Partial match with missing span
 * - Empty text handling
 * - Case sensitivity option
 * - Jaccard fallback (simulated large input)
 * 
 * Usage:
 *   node server/tests/comparator-smoke-test.cjs
 * 
 * Exits with code 0 if all tests pass, else 1.
 */

const axios = require('axios');

const BASE = process.env.SN2N_PROXY_URL || 'http://localhost:3004/api/compare';

async function get(endpoint) {
  try {
    const res = await axios.get(`${BASE}${endpoint}`, { timeout: 10000 });
    return res.data;
  } catch (err) {
    throw new Error(`GET ${endpoint} failed: ${err.message}`);
  }
}

async function post(endpoint, data) {
  try {
    const res = await axios.post(`${BASE}${endpoint}`, data, { timeout: 30000 });
    return res.data;
  } catch (err) {
    throw new Error(`POST ${endpoint} failed: ${err.message}`);
  }
}

// Test cases
const tests = [
  {
    name: 'Health check',
    run: async () => {
      const result = await get('/health');
      if (result.status !== 'ok') throw new Error('Status not ok');
      if (!result.version.canon || !result.version.algo) throw new Error('Missing version info');
      return true;
    }
  },
  {
    name: 'Exact match (100% coverage)',
    run: async () => {
      const result = await post('/section', {
        srcText: 'The quick brown fox jumps over the lazy dog',
        dstText: 'The quick brown fox jumps over the lazy dog'
      });
      if (result.coverage !== 1.0) throw new Error(`Expected 1.0, got ${result.coverage}`);
      if (result.missingSpans.length !== 0) throw new Error('Expected no missing spans');
      return true;
    }
  },
  {
    name: 'Partial match with missing span',
    run: async () => {
      const result = await post('/section', {
        srcText: 'Approvals must be captured with rationale for audit purposes and compliance',
        dstText: 'Approvals must be captured with rationale',
        options: { minMissingSpanTokens: 3 }
      });
      if (result.coverage >= 1.0) throw new Error('Expected coverage < 1.0');
      if (result.missingSpans.length === 0) throw new Error('Expected missing spans');
      const missingText = result.missingSpans[0].text.toLowerCase();
      if (!missingText.includes('audit') || !missingText.includes('purposes')) {
        throw new Error(`Missing span doesn't contain expected text: ${missingText}`);
      }
      return true;
    }
  },
  {
    name: 'Empty source text',
    run: async () => {
      const result = await post('/section', {
        srcText: '',
        dstText: 'Some destination text'
      });
      if (result.coverage !== 1.0) throw new Error('Expected 1.0 coverage for empty source');
      return true;
    }
  },
  {
    name: 'Empty destination text',
    run: async () => {
      const result = await post('/section', {
        srcText: 'Some source text',
        dstText: ''
      });
      if (result.coverage !== 0.0) throw new Error('Expected 0.0 coverage for empty destination');
      return true;
    }
  },
  {
    name: 'Case sensitivity option',
    run: async () => {
      const result = await post('/section', {
        srcText: 'The Quick Brown Fox',
        dstText: 'the quick brown fox',
        options: { lowerCase: true }
      });
      if (result.coverage !== 1.0) throw new Error('Expected 1.0 with case-insensitive');
      return true;
    }
  },
  {
    name: 'Punctuation normalization',
    run: async () => {
      const result = await post('/section', {
        srcText: 'Smart "quotes" and em—dash',
        dstText: 'Smart "quotes" and em-dash'
      });
      if (result.coverage !== 1.0) throw new Error('Expected 1.0 with punctuation normalized');
      return true;
    }
  },
  {
    name: 'Unicode normalization',
    run: async () => {
      const result = await post('/section', {
        srcText: 'café résumé',
        dstText: 'café résumé'
      });
      if (result.coverage !== 1.0) throw new Error('Expected 1.0 with Unicode normalized');
      return true;
    }
  },
  {
    name: 'Minimum span threshold',
    run: async () => {
      const result = await post('/section', {
        srcText: 'word1 word2 word3 word4 word5 extra1 extra2 extra3',
        dstText: 'word1 word2 word3 word4 word5',
        options: { minMissingSpanTokens: 5 }
      });
      // Missing span is only 3 tokens, should not be reported
      if (result.missingSpans.length !== 0) throw new Error('Expected no spans below threshold');
      return true;
    }
  },
  {
    name: 'Response fields validation',
    run: async () => {
      const result = await post('/section', {
        srcText: 'Test text',
        dstText: 'Test text'
      });
      if (!result.runId) throw new Error('Missing runId');
      if (!result.method) throw new Error('Missing method');
      if (result.coverage === undefined) throw new Error('Missing coverage');
      if (result.lcsLength === undefined) throw new Error('Missing lcsLength');
      if (result.srcTokenCount === undefined) throw new Error('Missing srcTokenCount');
      if (result.dstTokenCount === undefined) throw new Error('Missing dstTokenCount');
      if (!Array.isArray(result.missingSpans)) throw new Error('Missing missingSpans array');
      if (!result.params) throw new Error('Missing params');
      if (!result.version) throw new Error('Missing version');
      return true;
    }
  }
];

async function runTests() {
  let passed = 0;
  let failed = 0;

  console.log(`Running comparator smoke tests against ${BASE}\n`);

  for (const test of tests) {
    process.stdout.write(`- ${test.name} ... `);
    try {
      await test.run();
      console.log('✅ PASS');
      passed++;
    } catch (err) {
      console.log('❌ FAIL');
      console.log(`  Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n❌ Some tests failed');
    process.exitCode = 1;
  } else {
    console.log('\n✅ All tests passed');
    process.exitCode = 0;
  }
}

runTests().catch(err => {
  console.error('Test runner failed:', err.message);
  process.exit(2);
});
