#!/usr/bin/env node

/**
 * Test script to debug inline image placement in promoted paragraphs
 * Extracts a sample HTML snippet with inline images in ordered list items
 */

const fs = require('fs');
const path = require('path');

// Read a recent HTML fixture that has the problematic structure
const fixtureDir = path.join(__dirname, '../tests/fixtures');
const htmlFiles = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.html'));

console.log('\n🔍 Looking for HTML fixtures with nested OL > LI > P > IMG structure...\n');

htmlFiles.forEach(file => {
  const content = fs.readFileSync(path.join(fixtureDir, file), 'utf8');
  
  // Look for nested ordered lists with paragraphs containing images
  const hasNestedOL = content.includes('<ol') && content.includes('<li') && content.includes('<p');
  const hasImage = content.includes('<img');
  
  if (hasNestedOL && hasImage) {
    console.log(`✅ Found candidate: ${file}`);
    
    // Check if it matches our pattern
    const matchesPattern = /<ol[^>]*>[\s\S]*?<li[^>]*>[\s\S]*?<p[^>]*>[\s\S]*?<img[\s\S]*?<\/p>[\s\S]*?<\/li>[\s\S]*?<\/ol>/i.test(content);
    if (matchesPattern) {
      console.log(`   ✨ MATCHES pattern: OL > LI > P > IMG`);
    }
  }
});

console.log('\n💡 To test with real extraction, re-extract the "Add a document to a contract" page.');
console.log('💡 Look for these log patterns in the terminal:');
console.log('   - 🔍 [PROMO-DEBUG] remainingChildren types: ...');
console.log('   - 🔍 [IMAGE-INLINE-FIX] remainingChild[N] is image (...) - keeping as immediate child');
console.log('   - 🔍 [IMAGE-INLINE-FIX] Added N immediate child(ren) to promoted list item');
console.log('');
