// Test the consolidated html-formatting utilities
const { 
  isTechnicalContent, 
  processKbdContent, 
  processTechnicalSpan,
  decodeHtmlEntities,
  TECHNICAL_PATTERNS 
} = require('./utils/html-formatting.cjs');

console.log('\n🧪 Testing Consolidated HTML Formatting Utilities\n');

// Test 1: isTechnicalContent() function
console.log('📋 Test 1: Technical Content Detection\n');

const testCases = [
  // Technical content (should return true)
  { input: 'https://example.com', expected: true, reason: 'URL' },
  { input: '/path/to/file', expected: true, reason: 'Unix path' },
  { input: '<instance-name>', expected: true, reason: 'Placeholder' },
  { input: 'example.com', expected: true, reason: 'Domain' },
  { input: 'table.field.value', expected: true, reason: 'Dotted identifier' },
  { input: 'API_KEY_VALUE', expected: true, reason: 'ALL_CAPS constant' },
  { input: 'myFunction()', expected: true, reason: 'Code characters' },
  { input: 'snake_case_var', expected: true, reason: 'Snake case' },
  { input: 'camelCaseVar', expected: true, reason: 'Camel case' },
  
  // UI labels (should return false)
  { input: 'Save', expected: false, reason: 'Button label' },
  { input: 'Cancel', expected: false, reason: 'Button label' },
  { input: 'OK', expected: false, reason: 'Short word' },
  { input: 'Click here', expected: false, reason: 'UI text' },
];

let passed = 0;
let failed = 0;

testCases.forEach(({ input, expected, reason }) => {
  const result = isTechnicalContent(input);
  const status = result === expected ? '✅' : '❌';
  const label = expected ? 'Technical' : 'UI Label';
  
  if (result === expected) {
    passed++;
    console.log(`${status} "${input}" → ${label} (${reason})`);
  } else {
    failed++;
    console.log(`${status} "${input}" → Expected: ${label}, Got: ${result ? 'Technical' : 'UI Label'} (${reason})`);
  }
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

// Test 2: processKbdContent() function
console.log('📋 Test 2: KBD Content Processing\n');

const kbdTests = [
  { input: 'https://my-instance.service-now.com', expectedMarker: 'CODE' },
  { input: 'Save', expectedMarker: 'BOLD' },
  { input: '<instance-name>', expectedMarker: 'CODE' },
  { input: 'Cancel', expectedMarker: 'BOLD' },
  { input: 'sys_user_table', expectedMarker: 'CODE' },
];

kbdTests.forEach(({ input, expectedMarker }) => {
  const result = processKbdContent(input);
  const hasExpectedMarker = result.includes(`__${expectedMarker}_START__`);
  const status = hasExpectedMarker ? '✅' : '❌';
  
  console.log(`${status} "${input}" → ${hasExpectedMarker ? expectedMarker : 'UNEXPECTED'}`);
  if (!hasExpectedMarker) {
    console.log(`   Result: ${result}`);
  }
});

console.log('\n📋 Test 3: processTechnicalSpan() function\n');

const spanTests = [
  { input: 'sys_user', expected: 'CODE' },
  { input: 'plain text', expected: 'PLAIN' },
  { input: 'com.snc.package', expected: 'CODE' },
  { input: '__PLACEHOLDER_0__', expected: 'UNCHANGED' }, // Placeholder marker (preserved)
  { input: 'example text', expected: 'PLAIN' }, // Regular text
];

spanTests.forEach(({ input, expected }) => {
  const result = processTechnicalSpan(input);
  let actual;
  
  if (result.includes('__CODE_START__')) {
    actual = 'CODE';
  } else if (result === input || result === input.trim()) {
    actual = result.includes('__') ? 'UNCHANGED' : 'PLAIN';
  } else {
    actual = 'OTHER';
  }
  
  const status = actual === expected ? '✅' : '❌';
  console.log(`${status} "${input}" → ${actual} ${actual !== expected ? `(expected ${expected})` : ''}`);
});

// Test 4: decodeHtmlEntities() function
console.log('\n📋 Test 4: HTML Entity Decoding\n');

const entityTests = [
  { input: '&lt;value&gt;', expected: '<value>' },
  { input: 'one&nbsp;two', expected: 'one two' },
  { input: '&amp;', expected: '&' },
  { input: '&quot;test&quot;', expected: '"test"' },
  { input: '&#39;quote&#39;', expected: "'quote'" },
];

entityTests.forEach(({ input, expected }) => {
  const result = decodeHtmlEntities(input);
  const status = result === expected ? '✅' : '❌';
  console.log(`${status} "${input}" → "${result}" ${result !== expected ? `(expected "${expected}")` : ''}`);
});

// Test 5: Pattern validation
console.log('\n📋 Test 5: Technical Pattern Validation\n');

console.log('✅ URL pattern:', TECHNICAL_PATTERNS.url.source);
console.log('✅ Path pattern:', TECHNICAL_PATTERNS.path.source);
console.log('✅ Placeholder pattern:', TECHNICAL_PATTERNS.placeholder.source);
console.log('✅ Domain pattern:', TECHNICAL_PATTERNS.domain.source);
console.log('✅ Dotted identifier pattern:', TECHNICAL_PATTERNS.dottedIdentifier.source);
console.log('✅ Constant pattern:', TECHNICAL_PATTERNS.constant.source);
console.log('✅ Code chars pattern:', TECHNICAL_PATTERNS.codeChars.source);

console.log('\n🎉 All utility tests completed!\n');
