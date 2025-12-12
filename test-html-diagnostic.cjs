#!/usr/bin/env node

/**
 * Quick test: Check if Related Content H5 is in browser HTML
 * This helps diagnose if the problem is in client extraction or server processing
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🔍 Related Content Diagnostic Tool\n');
console.log('This will help us find where the H5 element is getting lost.\n');
console.log('📋 Steps:');
console.log('   1. In browser console, run: window.DEBUG_LAST_EXPORT_HTML');
console.log('   2. Copy the entire HTML output');
console.log('   3. Paste it below and press Enter');
console.log('   4. Press Enter again on empty line to finish\n');

let htmlLines = [];

console.log('Paste HTML here (press Enter twice when done):');

rl.on('line', (line) => {
  if (line === '' && htmlLines.length > 0) {
    rl.close();
  } else {
    htmlLines.push(line);
  }
});

rl.on('close', () => {
  const html = htmlLines.join('\n');
  
  if (!html || html.length < 100) {
    console.log('\n❌ No HTML received or too short. Exiting.');
    process.exit(1);
  }
  
  console.log(`\n✅ Received HTML: ${html.length} characters`);
  console.log('\n📊 Analysis:\n');
  
  // Check for key markers
  const checks = [
    { name: 'data-was-placeholder="true"', pattern: 'data-was-placeholder="true"' },
    { name: 'Related Content (case-insensitive)', pattern: /related content/i },
    { name: '<h5> tag', pattern: /<h5[\s>]/i },
    { name: '<h5>Related Content</h5>', pattern: /<h5[^>]*>Related Content<\/h5>/i },
    { name: 'contentPlaceholder class', pattern: /class="[^"]*contentPlaceholder[^"]*"/ },
  ];
  
  checks.forEach(check => {
    const found = typeof check.pattern === 'string' 
      ? html.includes(check.pattern)
      : check.pattern.test(html);
    console.log(`   ${found ? '✅' : '❌'} ${check.name}: ${found}`);
  });
  
  // Find data-was-placeholder div
  console.log('\n🔍 Searching for data-was-placeholder div...\n');
  
  const placeholderRegex = /<div[^>]*data-was-placeholder="true"[^>]*>/i;
  const match = html.match(placeholderRegex);
  
  if (match) {
    console.log('✅ Found data-was-placeholder div tag!');
    console.log(`   Full tag: ${match[0].substring(0, 200)}...\n`);
    
    // Try to extract the full div (this is tricky with nested divs)
    const startIndex = html.indexOf(match[0]);
    const snippet = html.substring(startIndex, startIndex + 1000);
    
    console.log('📄 First 1000 chars of div content:');
    console.log(snippet.replace(/</g, '\n<').substring(0, 800));
    console.log('...\n');
    
    // Check for H5 in snippet
    const hasH5 = /<h5[^>]*>.*?Related Content.*?<\/h5>/i.test(snippet);
    console.log(`${hasH5 ? '✅' : '❌'} H5 with "Related Content" found in this section: ${hasH5}`);
    
  } else {
    console.log('❌ No data-was-placeholder div found!');
  }
  
  console.log('\n');
  process.exit(0);
});
