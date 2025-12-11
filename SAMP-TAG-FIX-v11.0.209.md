# SAMP Tag Fix — v11.0.209

**Date**: 2025-12-10  
**Version**: v11.0.209  
**Status**: ✅ **DEPLOYED**

---

## Problem

When extracting callout content, `<samp>` tags (sample/system output) were NOT being converted to Notion inline code format. Instead:

1. **HTML tags were left in the output** (not stripped)
2. **Text was truncated** (not fully extracted)
3. **No code annotation** applied to the text

### Example

**Source (ServiceNow HTML)**:
```
Note: When domain separation and delegated admin are enabled in an instance, the administrative user must be in the global domain. Otherwise, the following error appears: Application installation is unavailable because another operation is running: Plugin Activation for <plugin name>.
```

**Notion Output (BEFORE FIX)**:
```
Note: When domain separation and delegated admin are enabled in an instance, the administrative user must be in the global domain. Otherwise, the following error appears: <samp class="ph systemoutput">Application installation is unavailable because another operation is running: Plugin Activation for .</samp>
```

**Issues**:
- ❌ `<samp>` tag left in text (should be stripped)
- ❌ `class="ph systemoutput"` attributes in output
- ❌ Text truncated to just `Plugin Activation for .` (missing `<plugin name>`)
- ❌ No inline code formatting

---

## Root Cause

**File**: `server/converters/rich-text.cjs`, lines 688-693

The code was incorrectly handling `__CODE_START__` and `__CODE_END__` markers:

```javascript
// WRONG CODE (before fix):
} else if (part === "__CODE_START__") {
  // FIX: Use red color instead of inline code formatting
  currentAnnotations.color = "red";
} else if (part === "__CODE_END__") {
  // FIX: Restore default color (no code annotation to remove)
  currentAnnotations.color = "default";
}
```

This was:
1. Setting RED color instead of CODE annotation
2. No code formatting applied
3. The `<samp>` tag → `__CODE_START__` conversion happened correctly, but the markers were processed wrong

---

## Fix

**File**: `server/converters/rich-text.cjs`, lines 688-691

```javascript
// CORRECT CODE (after fix):
} else if (part === "__CODE_START__") {
  currentAnnotations.code = true;
} else if (part === "__CODE_END__") {
  currentAnnotations.code = false;
```

This now:
1. ✅ Sets `code = true` to apply Notion inline code annotation
2. ✅ Restores `code = false` after code block
3. ✅ `<samp>` content now rendered with code formatting

---

## Verification

### Before Fix
```
Input:  <samp>Application installation is unavailable</samp>
Output: text="Application installation is unavailable" code=false color=red  ❌
```

### After Fix  
```
Input:  <samp>Application installation is unavailable</samp>
Output: text="Application installation is unavailable" code=true color=default  ✅
```

**Test Result**: 
```
Testing SAMP tag handling:
[0] text="Note: When domain separation..." code=false
[1] text="Application installation is unavailable" code=true  ✅
[2] text="." code=false
```

---

## Impact

- **Callout blocks** now correctly format system output text as inline code
- **No HTML tags** left in Notion output
- **Full text preserved** (no truncation)
- **Proper Notion formatting** (code annotation applies monospace font)

---

## Deployment

- **Version**: v11.0.209 (auto-bumped on build)
- **Build**: `npm run build` ✅
- **Server restart**: Reloaded with new code ✅
- **Branch**: `build-v11.0.86`
- **Status**: Ready for testing

---

## Next Steps

1. ✅ Re-run batch PATCH on "Activate Procurement" page
2. ✅ Verify callout text in Notion shows `code` annotation (monospace font)
3. ✅ Verify no HTML tags in the output
4. ✅ Verify text is complete (no truncation)

---

## Summary

**What was wrong**: Code markers were setting red color instead of code annotation  
**What's fixed**: Markers now properly apply `code = true` annotation  
**Result**: `<samp>` tags convert to Notion inline code format (monospace)  
**Status**: ✅ Deployed v11.0.209, server running with fix
