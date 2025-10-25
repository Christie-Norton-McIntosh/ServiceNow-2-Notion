// Test the identifier regex patterns

const testCases = [
  '[com.glide.service-portal]',
  '[com.snc.app_common.service_portal]',
  'com.glide.service-portal',
  'com.snc.app_common.service_portal',
  'sys_user_table',
  'my-hyphenated.class-name'
];

console.log('Testing identifier regex patterns:\n');

// Pattern from brackets handler
const bracketPattern = /([\(\[])[ \t\n\r]*([a-zA-Z][-a-zA-Z0-9]*(?:[_.][-a-zA-Z0-9]+)+)[ \t\n\r]*([\)\]])/g;

// Pattern from standalone handler  
const standalonePattern = /\b([a-zA-Z][-a-zA-Z0-9]*(?:[_.][a-zA-Z][-a-zA-Z0-9]*)+)\b/g;

testCases.forEach(test => {
  console.log(`\nTest: "${test}"`);
  
  // Test bracket pattern
  bracketPattern.lastIndex = 0;
  const bracketMatch = bracketPattern.exec(test);
  if (bracketMatch) {
    console.log(`  Bracket pattern matched: "${bracketMatch[2]}"`);
  } else {
    console.log(`  Bracket pattern: NO MATCH`);
  }
  
  // Test standalone pattern
  standalonePattern.lastIndex = 0;
  const standaloneMatch = standalonePattern.exec(test);
  if (standaloneMatch) {
    console.log(`  Standalone pattern matched: "${standaloneMatch[1]}"`);
  } else {
    console.log(`  Standalone pattern: NO MATCH`);
  }
});

console.log('\n\n=== SIMULATING FULL CONVERSION ===\n');

testCases.forEach(test => {
  let html = test;
  console.log(`\nOriginal: "${html}"`);
  
  // Step 1: Bracket handler
  html = html.replace(/([\(\[])[ \t\n\r]*([a-zA-Z][-a-zA-Z0-9]*(?:[_.][-a-zA-Z0-9]+)+)[ \t\n\r]*([\)\]])/g, (match, open, code, close) => {
    console.log(`  Bracket handler: Found "${code}"`);
    return `__CODE_START__${code.trim()}__CODE_END__`;
  });
  
  console.log(`After brackets: "${html}"`);
  
  // Step 2: Standalone handler (with context check)
  html = html.replace(/\b([a-zA-Z][-a-zA-Z0-9]*(?:[_.][a-zA-Z][-a-zA-Z0-9]*)+)\b/g, (match, identifier, offset, string) => {
    // Check if we're inside a __CODE_START__...__CODE_END__ block
    const beforeMatch = string.substring(0, offset);
    const lastCodeStart = beforeMatch.lastIndexOf('__CODE_START__');
    const lastCodeEnd = beforeMatch.lastIndexOf('__CODE_END__');
    
    // If there's a CODE_START after the last CODE_END, we're inside a code block
    if (lastCodeStart > lastCodeEnd) {
      console.log(`  Standalone handler: Found "${identifier}" but SKIPPING (inside code block)`);
      return match; // Don't wrap, already in code block
    }
    
    console.log(`  Standalone handler: Found "${identifier}"`);
    if (match.includes('http') || match.includes('__LINK_')) {
      console.log(`    Skipping (URL or link)`);
      return match;
    }
    return `__CODE_START__${identifier}__CODE_END__`;
  });
  
  console.log(`Final: "${html}"`);
});
