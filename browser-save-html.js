/**
 * Browser Console Helper: Save Last Export HTML
 * 
 * Run this in the browser console after extracting a page:
 * 
 * 1. Extract the page in Tampermonkey
 * 2. Open browser console
 * 3. Copy and paste this entire script
 * 4. The HTML will be downloaded as 'extracted-html.html'
 * 5. Rename it to 'test-related-content-input.html'
 * 6. Move it to the ServiceNow-2-Notion root directory
 * 7. Run: node test-related-content-dryrun.cjs
 */

(function saveLastExportHTML() {
  if (!window.DEBUG_LAST_EXPORT_HTML) {
    console.error('❌ No HTML found! Extract a page first.');
    return;
  }

  const html = window.DEBUG_LAST_EXPORT_HTML;
  console.log(`📦 Found HTML: ${html.length} characters`);

  // Check for Related Content
  const hasRelatedContent = html.toLowerCase().includes('related content');
  const hasDataWasPlaceholder = html.includes('data-was-placeholder="true"');
  
  console.log(`✅ Contains "related content": ${hasRelatedContent}`);
  console.log(`✅ Contains data-was-placeholder: ${hasDataWasPlaceholder}`);

  if (!hasRelatedContent || !hasDataWasPlaceholder) {
    console.warn('⚠️  Warning: HTML may not contain Related Content section!');
  }

  // Create download
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'extracted-html.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('✅ HTML saved to: extracted-html.html');
  console.log('\n📋 Next steps:');
  console.log('   1. Rename file to: test-related-content-input.html');
  console.log('   2. Move to project root directory');
  console.log('   3. Run: node test-related-content-dryrun.cjs');
})();
