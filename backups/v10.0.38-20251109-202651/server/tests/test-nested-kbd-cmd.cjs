// Test nested <kbd> inside <span class="ph cmd">
const cheerio = require('cheerio');
const path = require('path');

// Mock the required modules
process.env.SN2N_VERBOSE = '1';
process.env.SN2N_EXTRA_DEBUG = '1';

// Load the service
const servicenowService = require('../services/servicenow.cjs');

// Test HTML: nested kbd inside cmd span (your exact case)
const testHtml = `<span class="ph cmd">Leave the remaining permissions as <kbd class="ph userinput">No access</kbd> (default).</span>`;

console.log('\n📝 Testing nested <kbd> inside <span class="ph cmd">...\n');
console.log('Input HTML:', testHtml);
console.log('');

// Process using servicenow service's parseRichText
try {
  const $ = cheerio.load(`<p>${testHtml}</p>`, { decodeEntities: false });
  const $p = $('p');
  
  // Extract rich text (this calls parseRichText internally)
  const result = servicenowService.parseRichText($p.html(), { $elem: $p });
  
  console.log('\n✅ Result:');
  console.log(JSON.stringify(result, null, 2));
  
  // Check annotations
  const hasCorrectFormatting = result.some(item => {
    if (item.type === 'text' && item.text?.content) {
      const text = item.text.content;
      // Should have both bold formatting AND nested bold for the kbd tag
      const hasBold = item.annotations?.bold === true;
      const hasNestedBold = text.includes('No access') || text === 'No access';
      return hasBold || hasNestedBold;
    }
    return false;
  });
  
  console.log('\n🔍 Analysis:');
  console.log('- Has formatting annotations:', hasCorrectFormatting);
  console.log('- Should show "Leave the remaining permissions as No access (default)" in bold');
  console.log('- Should NOT show __BOLD_START__ or __KBD_PLACEHOLDER__ markers');
  
  // Check for problematic markers
  const resultStr = JSON.stringify(result);
  const hasMarkers = resultStr.includes('__BOLD_START__') || 
                     resultStr.includes('__KBD_PLACEHOLDER__') ||
                     resultStr.includes('__CODE_START__');
  
  if (hasMarkers) {
    console.log('\n❌ FAILED: Found raw markers in output!');
    console.log(resultStr);
  } else {
    console.log('\n✅ PASSED: No raw markers in output');
  }
  
} catch (error) {
  console.error('\n❌ Error processing HTML:', error);
  console.error(error.stack);
}
