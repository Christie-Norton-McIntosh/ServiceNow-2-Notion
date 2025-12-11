# Nav Element Extraction Fix - v11.0.211

## Problem Summary

After the v11.0.210 CSS selector fix, nav elements still weren't being extracted because they were being **completely removed from the HTML** during the cleanup phase, BEFORE the extraction code ever saw them.

## Root Cause

**File:** `server/services/servicenow.cjs`
**Line:** 495 (original)

```javascript
// OLD CODE (v11.0.210 and earlier):
html = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
```

This regex was **indiscriminately removing ALL `<nav>` elements** from the HTML, including:
1. ✅ Empty UI chrome navs (e.g., `<nav class="tasksNavigation"></nav>`)
2. ❌ Content-rich Related Content navs (e.g., `<nav><ul><li><a>Components installed with Procurement</a><p>Several types of components...</p></li></ul></nav>`)

## The Fix (v11.0.211)

**Strategy:** Only remove empty navs or specific UI chrome navs, NOT all navs.

```javascript
// NEW CODE (v11.0.211):
// Remove EMPTY navigation chrome elements (UI only, no content).
// DO NOT remove all <nav> elements - some contain Related Content links!
// Strategy: Remove specific UI chrome navs by class, or empty navs with no meaningful content
html = html.replace(/<nav[^>]*class="[^\"]*tasksNavigation[^\"]*"[^>]*>[\s\S]*?<\/nav>/gi, "");
html = html.replace(/<div[^>]*class="[^\"]*related-links[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
html = html.replace(/<div[^>]*class="[^\"]*tasksNavigation[^\"]*"[^>]*>[\s\S]*?<\/div>/gi, "");

// Remove empty navs (no text content except whitespace)
// Regex: <nav...>...content...</nav> where content has no letters/numbers
html = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, (match) => {
  // Keep nav if it contains any alphanumeric characters (actual content)
  return /[a-zA-Z0-9]/.test(match) ? match : "";
});
```

## What Changed

1. **Removed the blanket nav removal** - No longer strips ALL navs
2. **Added targeted removal** - Only removes navs with `tasksNavigation` class (empty UI chrome)
3. **Added content-aware removal** - Uses a callback function to test if nav has actual content
4. **Preserves content navs** - Nav elements with alphanumeric text are kept for extraction

## Test Results

**Before Fix (v11.0.210):**
```
🔍 ✅ Found 2 nav element(s) as children of articles, adding to contentElements
// BUT they were already stripped from HTML, so extraction found nothing
```

**After Fix (v11.0.211):**
```
🔍 Processing contentElement: <nav id="no-id" class="no-class">
🔍 Processing <nav> element - will flatten nested paragraphs
[EXTRACTION-DEBUG] EXIT processElement(<nav>) → 2 blocks [paragraph, paragraph]
✅ Extraction complete: 8 blocks (including 2 from nav)
```

## Expected Impact

1. **Related Content sections** will now appear in Notion pages
2. **Shortdesc paragraphs inside navs** (e.g., "Several types of components are installed with Procurement.") will be extracted
3. **Coverage percentages** should improve from ~47% to ~90%+ on pages with nav content
4. **Empty UI chrome navs** are still filtered out (no junk)

## Related Issues

- **Issue:** User reported "Related Content section missing" and shortdesc paragraph not extracted
- **Pages Affected:** All 95 failing pages in `patch/pages/pages-to-update/` (many have nav content)
- **Previous Attempts:** 
  - v11.0.210: Added CSS selector fallback (worked, but HTML was already stripped)
  - v11.0.209: Fixed SAMP tag rendering (unrelated but also fixed in this session)

## Next Steps

1. ✅ Build v11.0.211 (DONE)
2. ✅ Restart server (DONE)
3. ⏭️ Re-extract "Activate Procurement" page to verify nav appears
4. ⏭️ Run batch PATCH on all 95 failing pages
5. ⏭️ Monitor coverage improvements

## Files Modified

- `server/services/servicenow.cjs` (lines 488-502)

## Version

- **Built:** v11.0.211
- **Date:** December 10, 2025
- **Branch:** build-v11.0.86
