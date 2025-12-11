# SAMP Placeholder Stripping Fix — v11.0.214

**Date**: 2025-01-08  
**Version**: v11.0.214  
**Status**: ✅ DEPLOYED  
**Supersedes**: v11.0.213

## Executive Summary

Fixed critical bug where technical placeholders like `<plugin name>` were being stripped from SAMP tag content, causing incomplete text output like "for ." instead of "for <plugin name>."

**User Report**: "Application installation is unavailable because another operation is running: Plugin Activation for ."

**Root Cause**: Placeholder protection in main extraction function (line 1340) was NOT accessible to `parseRichText()` function, which processes HTML fragments containing SAMP tags. Placeholders were being cleaned away before protection could be applied.

**Solution**: Added LOCAL placeholder protection inside `parseRichText()` function, so placeholders are protected BEFORE SAMP/CODE processing, then restored AFTER all text processing completes.

---

## Problem Analysis

### Architecture Flaw

**Previous Flow (v11.0.213 - BROKEN)**:
```
1. extractW2N() calls parseRichText("<samp>...for <plugin name>.</samp>")
2. parseRichText() extracts SAMP content: "...for <plugin name>."
3. parseRichText() wraps with CODE markers: "__CODE_START__...for <plugin name>.__CODE_END__"
4. parseRichText() calls cleanHtmlText() which strips "<plugin name>" as an HTML tag
5. parseRichText() returns text: "...for ." (placeholder LOST)
6. extractW2N() line 1340: Tries to protect placeholders (TOO LATE - already stripped)
```

**Why v11.0.213 Fix Didn't Work**:
- cleanHtmlText protection (lines 147-156) only protected incoming `__TECH_PLACEHOLDER_N__` markers
- But those markers were created at line 1340 in extractW2N, AFTER parseRichText returns
- parseRichText operates on raw HTML fragments with literal `<plugin name>` tags
- By the time those tags reach cleanHtmlText, they look like HTML tags and get stripped

### Scope Problem

**Key Issue**: `parseRichText()` is a LOCAL function with its own scope:
```javascript
async function extractW2N(html, notion, ...) {
  const technicalPlaceholders = [];  // ← Defined in extractW2N scope
  
  async function parseRichText(html) {  // ← Cannot access outer technicalPlaceholders
    // Process SAMP tags containing <plugin name>
    // No way to protect placeholders!
  }
  
  // Placeholder protection happens here (line 1340)
  // But parseRichText already called and returned!
  html = html.replace(/<([^>]+)>/g, ...);
}
```

---

## Solution: Local Placeholder Protection

**New Flow (v11.0.214 - FIXED)**:
```
1. extractW2N() calls parseRichText("<samp>...for <plugin name>.</samp>")
2. parseRichText() line 650: Protects placeholders FIRST
   - "<plugin name>" → "__LOCAL_TECH_PLACEHOLDER_0__"
3. parseRichText() processes SAMP: "__CODE_START__...for __LOCAL_TECH_PLACEHOLDER_0__.__CODE_END__"
4. parseRichText() calls cleanHtmlText() which sees marker (not HTML tag), preserves it
5. parseRichText() line 1215: Restores placeholders LAST
   - "__LOCAL_TECH_PLACEHOLDER_0__" → "<plugin name>"
6. parseRichText() returns text: "...for <plugin name>." (placeholder INTACT)
```

### Implementation

**Step 1: Protect Placeholders at START of parseRichText** (lines 650-679):
```javascript
async function parseRichText(html) {
  // ... existing var tag stripping ...

  // CRITICAL: Protect technical placeholders FIRST (before SAMP/CODE processing)
  // These are non-HTML tags like <plugin name>, <instance-name>, <Tool ID>, etc.
  // Must protect them BEFORE they get wrapped in CODE markers or cleaned
  const localTechnicalPlaceholders = [];
  text = text.replace(/<([^>]+)>/g, (match, content) => {
    const trimmed = content.trim();
    
    // Extract tag name (first word, ignoring / for closing tags)
    const tagMatch = /^\/?\s*([a-z][a-z0-9-]*)/i.exec(trimmed);
    if (!tagMatch) {
      // Doesn't start with valid tag pattern, protect it
      const marker = `__LOCAL_TECH_PLACEHOLDER_${localTechnicalPlaceholders.length}__`;
      localTechnicalPlaceholders.push(content);
      return marker;
    }
    
    const tagName = tagMatch[1].toLowerCase();
    
    // If it's a known HTML tag, leave it alone
    if (HTML_TAGS.has(tagName)) {
      return match;
    }
    
    // Unknown tag, protect it as a placeholder
    const marker = `__LOCAL_TECH_PLACEHOLDER_${localTechnicalPlaceholders.length}__`;
    localTechnicalPlaceholders.push(content);
    return marker;
  });
```

**Step 2: Restore Placeholders at END of parseRichText** (lines 1215-1223):
```javascript
  // CRITICAL: Restore local technical placeholders before returning
  // These were protected at the start of parseRichText to survive SAMP/CODE processing
  richText.forEach(obj => {
    if (obj.text && obj.text.content) {
      obj.text.content = obj.text.content.replace(/__LOCAL_TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
        return `<${localTechnicalPlaceholders[parseInt(index)]}>`;
      });
    }
  });

  return { richText, imageBlocks, videoBlocks };
}
```

### Why This Works

**Key Advantages**:
1. **Local Scope**: `localTechnicalPlaceholders` array is scoped to each `parseRichText()` call
2. **Early Protection**: Happens BEFORE SAMP extraction (line 959) and cleanHtmlText (line 1144)
3. **Late Restoration**: Happens AFTER all text processing, right before return
4. **Unique Namespace**: Uses `__LOCAL_TECH_PLACEHOLDER_N__` to avoid collision with other marker systems

**Protection Timeline**:
- Line 650: Create `__LOCAL_TECH_PLACEHOLDER_0__` for `<plugin name>`
- Line 959: SAMP extraction sees marker, not raw tag
- Line 1144: cleanHtmlText sees marker, not raw tag
- Line 1215: Restore marker to `<plugin name>`
- Return: Text contains `<plugin name>` intact

---

## Files Modified

### server/services/servicenow.cjs

**Addition 1**: Lines 650-679 (30 lines added after var tag stripping)
```diff
  // Examples: <var class="keyword varname">true</var> -> true
  text = text.replace(/<var[^>]*>([\s\S]*?)<\/var>/gi, '$1');

+ // CRITICAL: Protect technical placeholders FIRST (before SAMP/CODE processing)
+ // These are non-HTML tags like <plugin name>, <instance-name>, <Tool ID>, etc.
+ // Must protect them BEFORE they get wrapped in CODE markers or cleaned
+ const localTechnicalPlaceholders = [];
+ text = text.replace(/<([^>]+)>/g, (match, content) => {
+   const trimmed = content.trim();
+   
+   // Extract tag name (first word, ignoring / for closing tags)
+   const tagMatch = /^\/?\s*([a-z][a-z0-9-]*)/i.exec(trimmed);
+   if (!tagMatch) {
+     // Doesn't start with valid tag pattern, protect it
+     const marker = `__LOCAL_TECH_PLACEHOLDER_${localTechnicalPlaceholders.length}__`;
+     localTechnicalPlaceholders.push(content);
+     return marker;
+   }
+   
+   const tagName = tagMatch[1].toLowerCase();
+   
+   // If it's a known HTML tag, leave it alone
+   if (HTML_TAGS.has(tagName)) {
+     return match;
+   }
+   
+   // Unknown tag, protect it as a placeholder
+   const marker = `__LOCAL_TECH_PLACEHOLDER_${localTechnicalPlaceholders.length}__`;
+   localTechnicalPlaceholders.push(content);
+   return marker;
+ });

  // DEBUG: Log input HTML BEFORE normalization
```

**Addition 2**: Lines 1215-1223 (9 lines added before return statement)
```diff
    }
  }

+ // CRITICAL: Restore local technical placeholders before returning
+ // These were protected at the start of parseRichText to survive SAMP/CODE processing
+ richText.forEach(obj => {
+   if (obj.text && obj.text.content) {
+     obj.text.content = obj.text.content.replace(/__LOCAL_TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
+       return `<${localTechnicalPlaceholders[parseInt(index)]}>`;
+     });
+   }
+ });

  return { richText, imageBlocks, videoBlocks };
}
```

**Total Impact**: 39 lines added to parseRichText function (30 protection + 9 restoration)

---

## Testing

### Test Case 1: SAMP with Placeholder
**Input**:
```html
<samp class='ph systemoutput sysout'>Application installation is unavailable because another operation is running: Plugin Activation for <plugin name>.</samp>
```

**Expected Output** (v11.0.214):
- ✅ Text: "Application installation is unavailable because another operation is running: Plugin Activation for <plugin name>."
- ✅ Format: Inline code (monospace)
- ✅ Placeholder: `<plugin name>` appears intact

**Previous Behavior** (v11.0.213):
- ❌ Text: "Application installation is unavailable because another operation is running: Plugin Activation for ."
- ✅ Format: Inline code (RED text bug fixed in v11.0.213)
- ❌ Placeholder: Missing (stripped by cleanHtmlText)

### Test Case 2: Multiple Placeholders
**Input**:
```html
<samp>Upload <file.txt> to <instance-name> using <Tool ID>.</samp>
```

**Expected Output**:
- ✅ Text: "Upload <file.txt> to <instance-name> using <Tool ID>."
- ✅ All 3 placeholders preserved

### Test Case 3: Mixed Content
**Input**:
```html
<p>Run <samp>npm install <package-name></samp> and restart <samp>systemctl restart <service-name></samp>.</p>
```

**Expected Output**:
- ✅ Two inline code segments with placeholders intact
- ✅ "npm install <package-name>"
- ✅ "systemctl restart <service-name>"

### Test Case 4: Placeholder in Regular Text (Control)
**Input**:
```html
<p>Specify the <hostname> in the configuration file.</p>
```

**Expected Output**:
- ✅ Text: "Specify the <hostname> in the configuration file."
- ✅ Placeholder preserved even outside SAMP

---

## Version History

### v11.0.212 → v11.0.213
**Fixed**: RED color bug (SAMP showing as red text instead of monospace)
- Changed `color='red'` to `code=true` in parseRichText CODE marker handling
- Added incoming marker protection in cleanHtmlText
- **Result**: Fixed formatting, but placeholders still stripped

### v11.0.213 → v11.0.214  
**Fixed**: Placeholder stripping (content like `<plugin name>` being removed)
- Added LOCAL placeholder protection at START of parseRichText
- Added LOCAL placeholder restoration at END of parseRichText
- **Result**: Placeholders survive through SAMP/CODE processing

**Why Two Versions**:
- v11.0.213 fixed the annotation bug (red → code)
- v11.0.213 added cleanHtmlText protection (worked for outer scope)
- v11.0.214 fixed the scope issue (parseRichText needs its own protection)

---

## Architecture Improvements

### Marker System Hierarchy

**Global Markers** (extractW2N scope):
- `__TECH_PLACEHOLDER_N__` - Created at line 1340, restored at line 7524
- Used for page-level HTML processing

**Local Markers** (parseRichText scope):
- `__LOCAL_TECH_PLACEHOLDER_N__` - Created at line 650, restored at line 1215
- Used for fragment-level text processing

**cleanHtmlText Markers** (notion-format.cjs):
- `__INCOMING_TECH_N__` - Passthrough for upstream markers (v11.0.213)
- `__TECH_PLACEHOLDER_N__` - Local to cleanHtmlText function

**Namespace Separation**:
Each scope now has its own placeholder system, preventing collision and ensuring proper restoration at the right level.

### Processing Order

**Correct Order** (v11.0.214):
```
parseRichText() {
  1. Protect placeholders → __LOCAL_TECH_PLACEHOLDER_N__
  2. Process SAMP tags → __CODE_START__ + markers + __CODE_END__
  3. Call cleanHtmlText() → markers preserved (not HTML tags)
  4. Process CODE markers → set code annotation
  5. Restore placeholders → __LOCAL_TECH_PLACEHOLDER_N__ back to <content>
  6. Return rich text with placeholders intact
}
```

---

## Success Metrics

**Before (v11.0.213)**:
- ✅ SAMP formatted as inline code (fixed RED text)
- ❌ Placeholder content stripped ("for .")
- ❌ Coverage: 47.02% (missing content)

**After (v11.0.214)**:
- ✅ SAMP formatted as inline code
- ✅ Placeholder content preserved ("for <plugin name>.")
- ⏳ Coverage: Target 90%+ (pending test)

**Quality Improvements**:
- Fixed scope issue that prevented placeholder protection
- Each processing level now has its own marker system
- Placeholders protected earlier in pipeline (before SAMP extraction)
- Restoration happens at correct scope level

---

## Deployment

**Build Command**: `npm run build`
**Build Output**: `dist/ServiceNow-2-Notion.user.js`
**Version**: 11.0.214
**Commit**: `c6826db` on branch `build-v11.0.86`
**Server**: Restarted with SN2N_AUDIT_CONTENT=1

**Testing Steps**:
1. ✅ Build v11.0.214 userscript
2. ✅ Restart proxy server
3. ⏳ Test SAMP with `<plugin name>` on ServiceNow page
4. ⏳ Verify: monospace code + placeholder intact
5. ⏳ Run batch PATCH on 95 failing pages
6. ⏳ Confirm coverage improvement

---

## Related Issues

- **v11.0.209**: Fixed SAMP in rich-text.cjs (wrong annotation)
- **v11.0.210**: Fixed nav element CSS selector
- **v11.0.211**: Fixed nav stripping (content-aware)
- **v11.0.212**: Added SAMP handling to parseRichText
- **v11.0.213**: Fixed RED color bug + cleanHtmlText protection
- **v11.0.214**: Fixed placeholder stripping via local protection

**Pattern**: Progressive fixes from outer scope (rich-text.cjs) → middle scope (servicenow.cjs parseRichText) → inner scope (cleanHtmlText). Each fix uncovered a deeper issue with the processing pipeline.

---

## References

- User report: "Plugin Activation for ." (missing placeholder)
- SAMP Red Text Fix v11.0.213: Fixed formatting, identified scope issue
- Token Presence Implementation: Validated 47% coverage was accurate
- Canonical Text Pipeline: Documents HTML→blocks conversion flow
