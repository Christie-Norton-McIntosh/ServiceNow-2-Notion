# Release Notes - Version 9.2.4

**Release Date:** October 21, 2025  
**Release Type:** Bug Fix (Patch)  
**Previous Version:** 9.2.3

---

## 🎯 Overview

Version 9.2.4 fixes a critical formatting issue where bullet points in ServiceNow table cells were appearing on the same line instead of separate lines in Notion pages.

## ✅ What's Fixed

### Bullet Points on Separate Lines in Table Cells

**Problem:**
```
Before: • Item 1• Item 2• Item 3
After:  • Item 1
        • Item 2
        • Item 3
```

**Root Cause:**  
The text splitting logic in `rich-text.cjs` was skipping empty lines, which inadvertently removed leading newlines from text segments. This caused bullet points to run together.

**Solution:**  
Modified the text processing to preserve all newlines, including those that appear as empty lines after splitting. The fix ensures that every newline in the source content creates a corresponding newline element in the Notion rich_text format.

**Impact:**
- ✅ Bullet lists in table cells now render correctly
- ✅ Multi-line content in tables preserves proper line breaks
- ✅ No regression in other content types

---

## 📁 Files Changed

### Modified Files

1. **server/converters/rich-text.cjs** (Lines 300-344)
   - Changed condition to process text containing newlines
   - Removed logic that skipped empty lines
   - Added comprehensive documentation

2. **server/converters/table.cjs** (Lines 314-330)
   - Enhanced debug logging for bullet point conversion
   - Added diagnostic output for newline counts

3. **package.json**
   - Version bumped to 9.2.4

4. **dist/ServiceNow-2-Notion.user.js**
   - Rebuilt with version 9.2.4

### New Documentation

- **docs/fix-bullet-points-newlines.md**
  - Detailed technical explanation of the fix
  - Before/after code comparisons
  - Testing verification steps

---

## 🧪 Testing & Verification

### Test Page
- **URL:** https://www.notion.so/Benchmarks-293a89fedba5812b8fcaebc036592e65
- **Result:** ✅ All bullet points on separate lines

### Server Logs Confirmation
```
🔍 [table.cjs LIST PATH] After conversion:
   Rich text elements: 7
   Contains newline elements: true  ✅
```

### Payload Verification
```bash
grep -c '<span' notion-payload.json
Result: 0  # ✅ No HTML tags leaked
```

---

## 📦 Installation

### For New Users

1. Install the updated userscript:
   - Open Tampermonkey
   - Install `dist/ServiceNow-2-Notion.user.js`

2. Restart the proxy server:
   ```bash
   killall -9 node
   npm start
   ```

### For Existing Users

1. Update the userscript:
   ```bash
   npm run build
   ```
   - Reload in Tampermonkey

2. Restart the server:
   ```bash
   killall -9 node
   npm start
   ```

---

## 🔄 Upgrade Path

### From v9.2.3
- Direct upgrade, no breaking changes
- Server restart required to clear module cache
- Userscript reload required

### From v9.2.2 or Earlier
- All improvements from v9.2.3 included
- Review span tag fixes in v9.2.3 notes

---

## 🐛 Known Issues

None at this time.

---

## 🎓 Technical Details

### Why the Old Code Failed

The original implementation:
```javascript
if (!line.trim() && i < lines.length - 1) {
  continue;  // Skip empty lines
}
```

This was intended to clean up extra whitespace from HTML formatting. However, when text like `"\n• Item1"` was split, it created `["", "• Item1"]`. Skipping the empty first element meant the leading newline was lost.

### Why the New Code Works

The fix:
```javascript
// Don't skip any lines - they all matter for newline positioning
if (line.trim()) {
  richText.push({ type: "text", text: { content: line }, ... });
}

// Always add newlines between lines (preserves structure)
if (i < lines.length - 1) {
  richText.push({ type: "text", text: { content: '\n' }, ... });
}
```

By processing all lines (including empty ones) and always inserting newline elements, we preserve the exact structure from the source HTML.

---

## 📊 Performance Impact

- **API Calls:** No change
- **Memory:** Negligible (few extra rich_text elements)
- **Processing Time:** No measurable difference
- **Server Load:** No impact

---

## 🔙 Rollback Plan

If issues occur:

```bash
# Option 1: Git revert
git checkout v9.2.3
npm install
npm run build

# Option 2: Use backup
cp backups/v9.2.3-*/server/converters/*.cjs server/converters/
npm run build
```

---

## 📝 Breaking Changes

None. This is a backward-compatible bug fix.

---

## 🔮 What's Next

Future improvements being considered:
- Additional table cell formatting options
- Enhanced list nesting support
- Improved code block handling

---

## 🙏 Acknowledgments

Thanks to the user for thorough testing and providing multiple test cases that helped identify the root cause.

---

## 📚 Additional Resources

- **Fix Documentation:** `docs/fix-bullet-points-newlines.md`
- **Full Backup:** `backups/v9.2.4-bullet-points-fix-20251021-075314/`
- **Previous Release:** v9.2.3 (HTML span tag fixes)

---

## ✨ Summary

Version 9.2.4 completes the table cell formatting fixes started in v9.2.3, ensuring that both HTML tags are properly stripped AND bullet points render on separate lines. ServiceNow table content now converts cleanly to Notion with proper formatting preserved.

**Recommended Action:** Update to v9.2.4 for proper table cell formatting.
