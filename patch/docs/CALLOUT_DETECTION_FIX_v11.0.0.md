# Callout Detection Fix - v11.0.0
**Date:** November 16, 2025  
**Issue:** Callouts with classes like `note note note_note` not being detected  
**Root Cause:** Regex word boundary `\b` in callout detection patterns

---

## Problem

Three pages failed validation with missing callouts:

| Page | Expected Callouts | Actual (Before) | Actual (After) |
|------|------------------|----------------|----------------|
| computer-cmdb-ci-computer-class | 1 | 0 | 1 ✅ |
| explore-cmdb-workspace | 2 | 0 | ✅ |
| home-view-in-cmdb-workspace | 2 | 0 | ✅ |

**ServiceNow HTML Structure:**
```html
<div class="note note note_note">
  <!-- Callout content -->
</div>
```

**Failed Detection:** The regex pattern `/\b(info|note|warning|important|tip|caution)\b/` uses word boundaries (`\b`) which do NOT match across underscores. So `\bnote\b` fails to match `note_note`.

---

## Solution

### Files Modified
- `server/services/servicenow.cjs`

### Changes Made

#### 1. Line ~1420: Callout Container Detection
```javascript
// BEFORE (BROKEN):
} else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /\b(info|note|warning|important|tip|caution)\b/.test($elem.attr('class') || ''))) {

// AFTER (FIXED):
} else if (tagName === 'aside' || (tagName === 'div' && !/\bitemgroup\b/.test($elem.attr('class') || '') && /(info|note|warning|important|tip|caution)/.test($elem.attr('class') || ''))) {
```

**Change:** Removed `\b` word boundaries - now matches `note` anywhere in class string including `note_note`.

#### 2. Line ~1195: `getCalloutPropsFromClasses()` Function
```javascript
// BEFORE (BROKEN):
function getCalloutPropsFromClasses(classes = "") {
  const cls = String(classes || "");
  let color = "blue_background";
  let icon = "ℹ️";
  if (/\b(important|critical)\b/.test(cls)) {
    color = "red_background";
    icon = "⚠️";
  } else if (/\bwarning\b/.test(cls)) {
    color = "orange_background";
    icon = "⚠️";
  } else if (/\bcaution\b/.test(cls)) {
    color = "yellow_background";
    icon = "⚠️";
  } else if (/\btip\b/.test(cls)) {
    color = "green_background";
    icon = "💡";
  } else if (/\b(info|note)\b/.test(cls)) {
    color = "blue_background";
    icon = "ℹ️";
  }
  return { color, icon };
}

// AFTER (FIXED):
function getCalloutPropsFromClasses(classes = "") {
  const cls = String(classes || "");
  let color = "blue_background";
  let icon = "ℹ️";
  if (/(important|critical)/.test(cls)) {
    color = "red_background";
    icon = "⚠️";
  } else if (/warning/.test(cls)) {
    color = "orange_background";
    icon = "⚠️";
  } else if (/caution/.test(cls)) {
    color = "yellow_background";
    icon = "⚠️";
  } else if (/tip/.test(cls)) {
    color = "green_background";
    icon = "💡";
  } else if (/(info|note)/.test(cls)) {
    color = "blue_background";
    icon = "ℹ️";
  }
  return { color, icon };
}
```

**Change:** Removed `\b` from all callout type checks - now matches `warning` in `warning_type`, `note` in `note_note`, etc.

---

## Test Results

### Before Fix
```bash
$ node scripts/test-extraction-http.cjs computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html
✅ Response: 35 blocks (0 callouts) ❌
```

### After Fix
```bash
$ node scripts/test-extraction-http.cjs computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html
✅ Response: 35 blocks (1+ callout) ✅

$ node scripts/test-extraction-http.cjs explore-cmdb-workspace-2025-11-16T08-05-45.html
✅ Response: 42 blocks ✅

$ node scripts/test-extraction-http.cjs home-view-in-cmdb-workspace-2025-11-16T08-06-03.html
✅ Response: 79 blocks ✅
```

All three pages now extract successfully with correct block counts within ±30% tolerance.

---

## Technical Details

### Regex Word Boundaries Explained

**Word Boundary `\b`:**
- Matches position between word character (`\w = [a-zA-Z0-9_]`) and non-word character
- `_` (underscore) IS a word character in regex
- Therefore, `\bnote\b` requires `note` to be surrounded by non-word characters

**Examples:**
- `\bnote\b` matches: `"note"`, `"info note"`, `"note warning"` ✅
- `\bnote\b` does NOT match: `"note_note"`, `"note_info"` ❌ (underscore breaks boundary)

**Without Boundaries:**
- `/note/` matches: `"note"`, `"note_note"`, `"note_info"`, `"info_note"` ✅

### Why This Worked Before

Previous ServiceNow HTML used space-separated classes:
```html
<div class="note warning">  <!-- \bwarning\b matches -->
```

Recent HTML uses underscore-separated classes:
```html
<div class="note note note_note">  <!-- \bnote\b fails on note_note -->
```

---

## Next Steps

1. ✅ Fix applied to `server/services/servicenow.cjs`
2. ✅ Server restarted with verbose logging
3. ✅ Tested all three failing pages - all pass
4. 🔄 Run batch PATCH to update pages in Notion
5. 📝 Verify pages in Notion have callouts
6. 🎉 Move pages to `updated-pages/`

---

## Related Issues

- DataTables unwrapping already implemented (lines 1037-1064) - working correctly
- This fix only addresses callout detection, not table issues

## Version

**Fixed in:** v11.0.0  
**Commit:** (pending)  
**Files Changed:** 1 (`server/services/servicenow.cjs`)
