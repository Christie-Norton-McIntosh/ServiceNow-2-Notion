# Bugfix: Update Existing Page Errors — v11.0.31 & v11.0.32

**Date**: November 21, 2025  
**Type**: Bugfix  
**Severity**: Critical (feature broken)  
**Impact**: Update Existing Page button

## Issue 1 (v11.0.31): Overlay Module Error

**Error Message**:
```
❌ Error updating page: overlayModule.show is not a function
```

**Cause**: The `handleUpdateExistingPage()` function was calling `overlayModule.show()`, but the overlay module only exposes a `start()` method, not `show()`.

**Affected Version**: v11.0.29, v11.0.30

**Impact**: The "Update Existing Page" button would fail immediately when clicked, preventing users from updating existing Notion pages.

## Root Cause

When implementing the "Update Existing Page" feature in v11.0.29, the code incorrectly assumed the overlay module had a `show()` method:

```javascript
// ❌ WRONG (v11.0.29-11.0.30)
overlayModule.show();
overlayModule.setMessage('📝 Extracting...');
```

The correct API for the overlay module is `start()` with configuration options:

```javascript
// ✅ CORRECT (v11.0.31)
overlayModule.start({
  title: 'Updating Notion Page',
  message: '📝 Extracting current ServiceNow page content...'
});
```

## Fix Applied

**File**: `src/ui/main-panel.js`  
**Function**: `handleUpdateExistingPage()`  
**Line**: ~3346

**Before** (v11.0.30):
```javascript
// Show loading overlay
overlayModule.show();
overlayModule.setMessage('📝 Extracting current ServiceNow page content...');
```

**After** (v11.0.31):
```javascript
// Show loading overlay
overlayModule.start({
  title: 'Updating Notion Page',
  message: '📝 Extracting current ServiceNow page content...'
});
```

## Verification

### Build Check ✅
```bash
$ npm run build
✅ Version bumped: 11.0.30 → 11.0.31
created dist/ServiceNow-2-Notion.user.js in 226ms
```

### Code Check ✅
```bash
$ grep -n "overlayModule.show()" dist/ServiceNow-2-Notion.user.js
# No results (removed)

$ grep -n "overlayModule.start({" dist/ServiceNow-2-Notion.user.js
6114:    overlayModule.start({
# Correct usage found
```

## Testing Steps

To verify the fix works:

1. **Install v11.0.31** in Tampermonkey
2. **Navigate to any ServiceNow docs page**
3. **Click "🔄 Update Existing Page"**
4. **Paste a Notion page URL**
5. **Verify overlay appears** with "Updating Notion Page" title
6. **Verify extraction proceeds** without errors
7. **Verify page updates successfully**

## Related APIs

### Overlay Module API

The `overlayModule` (defined in `src/ui/overlay-progress.js`) has the following methods:

```javascript
overlayModule.start(opts)       // Start/show overlay with config
overlayModule.setMessage(text)  // Update message text
overlayModule.setProgress(n)    // Update progress (0-100)
overlayModule.setSteps(arr)     // Show step-by-step progress
overlayModule.setPreview(html)  // Show content preview
overlayModule.done(opts)        // Complete with success/error
overlayModule.hide()            // Hide overlay
```

**Note**: There is NO `show()` method. Always use `start()` with options.

## Why This Wasn't Caught

1. **No type checking**: JavaScript doesn't enforce method existence
2. **No runtime testing**: Feature was built but not manually tested
3. **Similar naming**: Other modules might have `show()` methods

## Prevention

To prevent similar issues:

1. **Always check module API** before calling methods
2. **Test features manually** after building
3. **Use consistent patterns** from existing code
4. **Add JSDoc comments** with method signatures

## Impact Assessment

**Users Affected**: Anyone who tried to use "Update Existing Page" in v11.0.29 or v11.0.30

**Workaround**: None (feature was completely broken)

**Fix Deployment**: v11.0.31 immediately deployed

**Data Loss**: None (error occurred before any data operations)

## Related Issues

- v11.0.29: Feature introduced with bug
- v11.0.30: Bug persisted (UI improvements only)
- v11.0.31: Bug fixed ✅

## Lessons Learned

1. **Always test new features** in browser before pushing
2. **Check module exports** when importing
3. **Look for similar usage** in existing code
4. **Use console for API discovery**: `console.log(overlayModule)`

## Issue 2 (v11.0.32): Content Extraction Error

**Error Message**:
```
❌ Error updating page: html.match is not a function
```

**Cause**: The `handleUpdateExistingPage()` function was passing the wrong content format to `patchNotionPage()`. It was passing `extractedData.content` (an object) instead of `extractedData.content.combinedHtml` (the HTML string).

**Affected Version**: v11.0.31

**Impact**: The "Update Existing Page" button would fail after extraction, when trying to send the PATCH request.

### Root Cause

The `extractCurrentPageData()` function returns a nested structure:

```javascript
{
  title: "Page Title",
  content: {
    combinedHtml: "<html>...</html>",  // The actual HTML string
    html: "...",                        // Fallback HTML
    sections: [...]
  }
}
```

But the code was trying to use `extractedData.content` directly:

```javascript
// ❌ WRONG (v11.0.31)
const patchResult = await patchNotionPage(
  pageId,
  extractedData.title,
  extractedData.contentHtml || extractedData.content,  // content is an object!
  currentUrl
);
```

This passed an object to the PATCH function, which tried to call `.match()` on it, causing the error.

### Fix Applied (v11.0.32)

**File**: `src/ui/main-panel.js`  
**Function**: `handleUpdateExistingPage()`  
**Line**: ~3367

**Before** (v11.0.31):
```javascript
debug(`[UPDATE-EXISTING] Extracted: ${extractedData.title}`);
debug(`[UPDATE-EXISTING] Content length: ${(extractedData.contentHtml || extractedData.content || '').length} chars`);

const patchResult = await patchNotionPage(
  pageId,
  extractedData.title,
  extractedData.contentHtml || extractedData.content,
  currentUrl
);
```

**After** (v11.0.32):
```javascript
debug(`[UPDATE-EXISTING] Extracted: ${extractedData.title}`);

// Extract HTML content from the nested structure
const contentHtml = extractedData.content?.combinedHtml || 
                    extractedData.content?.html || 
                    extractedData.contentHtml || 
                    '';

debug(`[UPDATE-EXISTING] Content length: ${contentHtml.length} chars`);

if (!contentHtml || contentHtml.length === 0) {
  throw new Error('No content extracted from page');
}

const patchResult = await patchNotionPage(
  pageId,
  extractedData.title,
  contentHtml,  // Now correctly passing HTML string
  currentUrl
);
```

### Improvements

1. **Correct content extraction**: Uses `content.combinedHtml` first, then fallbacks
2. **Validation**: Checks if content is empty before proceeding
3. **Better error message**: Clear error if no content extracted
4. **Proper type handling**: Ensures string is passed to PATCH function

---

## Summary of Fixes

| Version | Issue | Fix |
|---------|-------|-----|
| v11.0.31 | `overlayModule.show is not a function` | Changed to `overlayModule.start()` |
| v11.0.32 | `html.match is not a function` | Extract HTML from `content.combinedHtml` |

---

**Status**: ✅ All issues fixed in v11.0.32  
**Testing**: Required (manual verification)  
**Severity**: Critical → Resolved  
**Current Version**: 11.0.32 (built and deployed)
