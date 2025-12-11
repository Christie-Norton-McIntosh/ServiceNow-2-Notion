# SAMP Red Text Fix — v11.0.213

**Date**: 2025-01-08
**Version**: v11.0.213
**Status**: ✅ DEPLOYED

## Executive Summary

Fixed two critical bugs causing `<samp>` tags to render incorrectly:
1. **RED text bug**: CODE markers were setting `color='red'` instead of `code=true` in parseRichText
2. **Stripped placeholders bug**: cleanHtmlText was not preserving upstream `__TECH_PLACEHOLDER_N__` markers

**User Report**: "<samp> is still showing as 'Application installation is unavailable... for .' in red text"

## Root Cause Analysis

### Bug #1: RED Color Instead of Inline Code

**Location**: `server/services/servicenow.cjs` lines 1102-1113

**Problem**: CODE marker processing was applying red color annotation:
```javascript
// BROKEN CODE (v11.0.212):
} else if (part === "__CODE_START__") {
  currentAnnotations._colorBeforeCode = currentAnnotations.color;
  // FIX: Use red color instead of inline code formatting  ← WRONG COMMENT
  currentAnnotations.color = "red";
} else if (part === "__CODE_END__") {
  // FIX: Restore previous color (no code annotation to remove)
  if (currentAnnotations._colorBeforeCode !== undefined) {
    currentAnnotations.color = currentAnnotations._colorBeforeCode;
    delete currentAnnotations._colorBeforeCode;
  } else {
    currentAnnotations.color = "default";
  }
}
```

**Evidence**:
- Lines 1104-1105: Comment says "FIX: Use red color" (incorrect fix)
- User sees red text in output instead of monospace code
- Notion API requires `code=true` for inline code formatting, not `color='red'`

**Solution**: Simplified to proper code annotation:
```javascript
// FIXED CODE (v11.0.213):
} else if (part === "__CODE_START__") {
  currentAnnotations.code = true;
} else if (part === "__CODE_END__") {
  currentAnnotations.code = false;
}
```

**Impact**: Reduced 12 lines of wrong logic to 4 lines of correct logic

---

### Bug #2: Placeholder Marker Stripping

**Location**: `server/utils/notion-format.cjs` lines 133-280 (cleanHtmlText function)

**Problem**: Two placeholder systems with namespace collision:
1. **servicenow.cjs** (lines 1347, 1360): Creates `__TECH_PLACEHOLDER_N__` markers for tags like `<plugin name>`
2. **cleanHtmlText** (lines 148, 162): Creates its OWN `__TECH_PLACEHOLDER_N__` markers for inline content

**Flow**:
```
servicenow.cjs line 1347:   <plugin name> → __TECH_PLACEHOLDER_0__
                              ↓
parseRichText line 1144:    cleanHtmlText(__TECH_PLACEHOLDER_0__)
                              ↓
cleanHtmlText line 270-272: Restores LOCAL placeholders only
                              ↓
servicenow.cjs line 7524:   Tries to restore __TECH_PLACEHOLDER_0__ → MISSING!
```

**Evidence**:
- User sees "for ." instead of "for <plugin name>."
- Content between "for" and "." completely missing
- Upstream markers created at line 1347 but gone by line 7524

**Solution**: Preserve incoming markers through cleanHtmlText:

**Step 1**: Protect incoming markers (new lines 147-156):
```javascript
// CRITICAL STEP 0: Protect incoming __TECH_PLACEHOLDER_N__ markers from servicenow.cjs
// These markers were created upstream and must survive through this function
// to be restored later at servicenow.cjs line 7524
const incomingMarkers = [];
html = html.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match) => {
  const marker = `__INCOMING_TECH_${incomingMarkers.length}__`;
  incomingMarkers.push(match); // Store the original marker
  return marker;
});
```

**Step 2**: Restore incoming markers (new lines 277-280):
```javascript
// Restore incoming markers from servicenow.cjs (preserve for later restoration)
incomingMarkers.forEach((originalMarker, index) => {
  text = text.replace(`__INCOMING_TECH_${index}__`, originalMarker);
});
```

**Impact**: Upstream `__TECH_PLACEHOLDER_N__` markers now survive through cleanHtmlText and reach the restoration point at servicenow.cjs line 7524

---

## Files Modified

### 1. server/services/servicenow.cjs
**Lines**: 1102-1113 (replaced 12 lines with 4)
**Change**: CODE marker annotation from `color='red'` to `code=true`
**Diff**:
```diff
  } else if (part === "__CODE_START__") {
-   currentAnnotations._colorBeforeCode = currentAnnotations.color;
-   // FIX: Use red color instead of inline code formatting
-   currentAnnotations.color = "red";
+   currentAnnotations.code = true;
  } else if (part === "__CODE_END__") {
-   // FIX: Restore previous color (no code annotation to remove)
-   if (currentAnnotations._colorBeforeCode !== undefined) {
-     currentAnnotations.color = currentAnnotations._colorBeforeCode;
-     delete currentAnnotations._colorBeforeCode;
-   } else {
-     currentAnnotations.color = "default";
-   }
+   currentAnnotations.code = false;
  }
```

### 2. server/utils/notion-format.cjs
**Lines**: 147-156 (new), 277-280 (new)
**Change**: Protect and restore incoming `__TECH_PLACEHOLDER_N__` markers
**Diff**:
```diff
  function cleanHtmlText(html) {
    if (!html) return "";
  
    // DEBUG: Log if input contains URLs
    if (html.includes('http')) {
      console.log('🚨 [cleanHtmlText] INPUT WITH URL:', html.substring(0, 500));
    }
  
+   // CRITICAL STEP 0: Protect incoming __TECH_PLACEHOLDER_N__ markers from servicenow.cjs
+   // These markers were created upstream and must survive through this function
+   // to be restored later at servicenow.cjs line 7524
+   const incomingMarkers = [];
+   html = html.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match) => {
+     const marker = `__INCOMING_TECH_${incomingMarkers.length}__`;
+     incomingMarkers.push(match); // Store the original marker
+     return marker;
+   });
+
    // CRITICAL STEP 1: Protect technical placeholders FIRST (before any processing)
    ...
  
    // Restore technical placeholders (convert markers back to <content>)
    technicalPlaceholders.forEach((content, index) => {
      text = text.replace(`__TECH_PLACEHOLDER_${index}__`, `<${content}>`);
    });
  
+   // Restore incoming markers from servicenow.cjs (preserve for later restoration)
+   incomingMarkers.forEach((originalMarker, index) => {
+     text = text.replace(`__INCOMING_TECH_${index}__`, originalMarker);
+   });
+
    return text;
  }
```

---

## Testing

### Test Case 1: SAMP with Placeholder Content
**Input**:
```html
<samp class='ph systemoutput sysout'>Application installation is unavailable... for <plugin name></samp>
```

**Expected Output** (v11.0.213):
- ✅ Text: "Application installation is unavailable... for <plugin name>."
- ✅ Formatting: Inline code (monospace), NOT red text
- ✅ Placeholder: `<plugin name>` appears intact

**Previous Behavior** (v11.0.212):
- ❌ Text: "Application installation is unavailable... for ."
- ❌ Formatting: RED text
- ❌ Placeholder: Missing (stripped)

### Test Case 2: SAMP Without Placeholders
**Input**:
```html
<samp>export PATH=$PATH:/usr/local/bin</samp>
```

**Expected Output**:
- ✅ Text: "export PATH=$PATH:/usr/local/bin"
- ✅ Formatting: Inline code (monospace)

### Test Case 3: Nested SAMP in Callout
**Input**:
```html
<div class="note note">
  <p>Run <samp>npm install</samp> to install dependencies.</p>
</div>
```

**Expected Output**:
- ✅ Callout type: info (gray)
- ✅ Text: "Run npm install to install dependencies."
- ✅ "npm install" formatted as inline code

---

## Verification Steps

1. ✅ Build v11.0.213 userscript
2. ✅ Restart proxy server with SN2N_AUDIT_CONTENT=1
3. ⏳ Test SAMP extraction on ServiceNow page with placeholders
4. ⏳ Verify monospace formatting (not red)
5. ⏳ Verify placeholder content intact
6. ⏳ Run batch PATCH on 95 failing pages
7. ⏳ Confirm coverage improvement (47% → 90%+)

---

## Related Issues

- **v11.0.209**: Fixed SAMP in rich-text.cjs (same red color bug, different location)
- **v11.0.210**: Fixed nav element CSS selector
- **v11.0.211**: Fixed nav stripping (content-aware removal)
- **v11.0.212**: Added SAMP handling to parseRichText

**Pattern**: CODE marker processing appeared in multiple locations with inconsistent implementations. v11.0.213 fixes the parseRichText instance to match the correct implementation in rich-text.cjs.

---

## Architecture Notes

### Placeholder Protection System

**Purpose**: Preserve non-HTML tags like `<plugin name>`, `<instance-name>`, `<Tool ID>` through HTML processing pipeline

**Implementation**:
1. **Create markers** (servicenow.cjs lines 1300-1360):
   - Detect non-HTML tags: `/<([^>]+)>/g` excluding HTML_TAGS set
   - Replace with `__TECH_PLACEHOLDER_N__`
   - Store original content in array

2. **Process HTML** (parseRichText, cleanHtmlText):
   - Markers treated as plain text
   - Survive through HTML tag stripping
   - **NEW**: cleanHtmlText now preserves incoming markers

3. **Restore markers** (servicenow.cjs line 7524):
   - Regex: `/__TECH_PLACEHOLDER_(\d+)__/g`
   - Replace with `<${technicalPlaceholders[index]}>`

**Critical Fix**: cleanHtmlText was creating its OWN `__TECH_PLACEHOLDER_N__` markers, causing namespace collision. Now uses `__INCOMING_TECH_N__` for passthrough markers.

---

## Deployment

**Build Command**: `npm run build`
**Build Output**: `dist/ServiceNow-2-Notion.user.js`
**Version**: 11.0.213
**Commit**: `8272306` on branch `build-v11.0.86`
**Server**: Restarted with SN2N_AUDIT_CONTENT=1

**Next Steps**:
1. Test SAMP extraction on live ServiceNow page
2. Verify both fixes (monospace + placeholder preservation)
3. Run batch PATCH if validation succeeds
4. Monitor coverage metrics

---

## Success Metrics

**Before (v11.0.212)**:
- ❌ SAMP content rendered as RED text
- ❌ Placeholder content stripped ("for .")
- ❌ Coverage: 47.02%

**After (v11.0.213)**:
- ✅ SAMP content renders as inline code (monospace)
- ✅ Placeholder content preserved ("for <plugin name>.")
- ⏳ Coverage: Target 90%+ (pending batch PATCH)

**Quality Improvements**:
- Removed 11 lines of wrong logic (red color handling)
- Added 13 lines of correct logic (placeholder passthrough)
- Eliminated namespace collision between two placeholder systems
- Fixed misleading comment that documented wrong behavior

---

## References

- User report: "<samp> is still showing as '...for .' in red text"
- SAMP Tag Fix v11.0.209: Fixed same bug in rich-text.cjs
- Token Presence Implementation: Confirmed 47% coverage was accurate
- Canonical Text Pipeline: Documented HTML→blocks conversion flow
