// Simple test for nested <kbd> inside <span class="ph cmd">
// Simulates the processing order

const testHtml = `<span class="ph cmd">Leave the remaining permissions as <kbd class="ph userinput">No access</kbd> (default).</span>`;

console.log('\n📝 Testing nested <kbd> inside <span class="ph cmd">...\n');
console.log('Input:', testHtml);

let text = testHtml;

// Step 1: Extract <kbd> tags (like line 252 in servicenow.cjs)
const kbdPlaceholders = [];
text = text.replace(/<kbd[^>]*>([\s\S]*?)<\/kbd>/gi, (match, content) => {
  let decoded = content
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  const placeholder = `__KBD_PLACEHOLDER_${kbdPlaceholders.length}__`;
  kbdPlaceholders.push(decoded);
  console.log(`\n🔍 Extracted <kbd>: "${decoded}" → ${placeholder}`);
  return placeholder;
});

console.log('\nAfter kbd extraction:', text);

// Step 2: Restore <kbd> placeholders with markers (like line 320)
kbdPlaceholders.forEach((content, index) => {
  const placeholder = `__KBD_PLACEHOLDER_${index}__`;
  
  // Check if technical or UI label
  const isTechnical = 
    /^https?:\/\//i.test(content) ||
    /^[\/~]/i.test(content) ||
    /<[^>]+>/i.test(content) ||
    /\.(com|net|org|io|dev|gov|edu)/i.test(content) ||
    /^[\w\-]+\.[\w\-]+\./.test(content) ||
    /^[A-Z_]{4,}$/.test(content) ||
    /[\[\]{}();]/.test(content) ||
    /^[a-z_][a-z0-9_]*$/i.test(content) &&
      (content.includes('_') || /[a-z][A-Z]/.test(content));
  
  if (isTechnical) {
    text = text.replace(placeholder, `__CODE_START__${content}__CODE_END__`);
    console.log(`\n🔍 Restored <kbd> as CODE: "${content}"`);
  } else {
    text = text.replace(placeholder, `__BOLD_START__${content}__BOLD_END__`);
    console.log(`\n🔍 Restored <kbd> as BOLD: "${content}"`);
  }
});

console.log('\nAfter kbd restoration:', text);

// Step 3: Process <span class="ph cmd"> (this should now see markers, not placeholders)
text = text.replace(/<span[^>]*class=["'][^"']*\bcmd\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (match, content) => {
  console.log(`\n🔍 Processing cmd span, content: "${content}"`);
  return `__BOLD_START__${content}__BOLD_END__`;
});

console.log('\nAfter cmd processing:', text);

// Check result
if (text.includes('__KBD_PLACEHOLDER__')) {
  console.log('\n❌ FAILED: Still has __KBD_PLACEHOLDER__ markers!');
} else if (text.includes('__BOLD_START__')) {
  console.log('\n✅ PASSED: Has __BOLD_START__ markers (correct formatting)');
  console.log('Expected: "Leave the remaining permissions as" should be bold');
  console.log('Expected: "No access" should be nested bold');
} else {
  console.log('\n⚠️  Unexpected result');
}
