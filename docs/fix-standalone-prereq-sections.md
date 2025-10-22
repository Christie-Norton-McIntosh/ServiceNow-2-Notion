## Issue Analysis & Resolution Summary

### Problem Identified

The first "Before you begin" section in the ServiceNow documentation was **NOT formatted as a callout** in the Notion page.

**What was created:**
```
[paragraph] "Before you begin"
[paragraph] "Role required:"
[bulleted_list_item] "oauth_admin in DevOps Change Velocity ."
[bulleted_list_item] "Admin account in GitHub . "
  [callout] [ℹ️] [blue_background] "Note: The OAuth 2.0 JWT grant..."
```

**What should have been created:**
```
[callout] [📍] [default] "Before you begin 
Role required:
• oauth_admin in DevOps Change Velocity
• Admin account in GitHub
Note: The OAuth 2.0 JWT grant..."
```

### Root Cause

The code only detected `<section class="prereq">` elements as "Before you begin" sections. However, the first prereq section in this ServiceNow document is **NOT wrapped** in `<section class="prereq">` - it's just standalone paragraphs and lists at the top level.

### Solution Implemented

Added **preprocessing logic** in `server/services/servicenow.cjs` (lines ~2919-2978) that:

1. **Scans contentElements** before processing
2. **Detects pattern**: 
   - `<p>Before you begin</p>`
   - `<p>Role required:...</p>`
   - Optional `<ul>` lists following
3. **Wraps matched elements** in `<section class="prereq">`
4. **Updates contentElements array** to replace individual elements with wrapped section

### Code Changes

**File:** `server/services/servicenow.cjs`
**Lines:** ~2919-2978 (after contentElements initialization)

```javascript
// PREPROCESSING: Detect and wrap standalone "Before you begin" sections
// Pattern: <p>Before you begin</p> <p>Role required:</p> <ul>...</ul>
for (let i = 0; i < contentElements.length - 1; i++) {
  const elem = contentElements[i];
  const $elem = $(elem);
  
  if (elem.name === 'p') {
    const text = $elem.text().trim();
    if (text.startsWith('Before you begin')) {
      const nextElem = contentElements[i + 1];
      if (nextElem && nextElem.name === 'p') {
        const nextText = $(nextElem).text().trim();
        if (nextText.startsWith('Role required:')) {
          // Collect elements: "Before you begin" + "Role required:" + <ul> lists
          const elementsToWrap = [elem, nextElem];
          let j = i + 2;
          while (j < contentElements.length && contentElements[j].name === 'ul') {
            elementsToWrap.push(contentElements[j]);
            j++;
          }
          
          // Create <section class="prereq"> wrapper
          const prereqSection = $('<section class="prereq"></section>');
          elementsToWrap.forEach(el => prereqSection.append($(el).clone()));
          
          // Replace first element with wrapped section
          $(elem).replaceWith(prereqSection);
          
          // Remove wrapped elements
          for (let k = 1; k < elementsToWrap.length; k++) {
            $(elementsToWrap[k]).remove();
          }
          
          // Update contentElements array
          for (let k = elementsToWrap.length - 1; k > 0; k--) {
            contentElements.splice(i + k, 1);
          }
          contentElements[i] = prereqSection.get(0);
        }
      }
    }
  }
}
```

### Testing Instructions

1. **Delete the existing Notion page** (or create from scratch)
2. **Re-run the userscript** on the ServiceNow page
3. **Verify the first "Before you begin" section** is now a callout with 📍 emoji

**Expected result:**
- Top-level callout with pin emoji (📍)
- Contains "Before you begin" header
- Contains "Role required:" 
- Contains bullet list items
- Proper formatting with line breaks

### Diagnostic Command

To analyze the Notion page structure after re-creation:

```bash
node server/scripts/diagnose-page.cjs <page-id>
```

### Content Verification Checklist

✅ **What's Already Working:**
- 4 heading sections (H2s)
- 27 numbered list items
- 10 paragraphs
- 3+ tables with correct structure
- 1 image (attachments icon)
- 4 callouts (3 within sections + 1 "Note:" callout)
- Inline code URLs with placeholders (`<instance-name>`) preserved
- All code blocks (openssl, keytool commands)

⚠️ **Fixed in this update:**
- First "Before you begin" section now formatted as callout

### Additional Notes

- The other 3 "Before you begin" callouts were already working because they're wrapped in `<section class="prereq">` in the source HTML
- This fix specifically targets the top-level prereq section that appears before any article sections
- The fix is generic and will work for any ServiceNow document with this pattern

### Files Modified

1. `server/services/servicenow.cjs` - Added prereq preprocessing logic
2. `server/scripts/diagnose-page.cjs` - Created diagnostic tool (NEW FILE)

### Next Steps

1. Test by re-creating the page
2. Verify first "Before you begin" section is now a callout
3. Compare with diagnostic output to confirm structure
4. Mark as complete once verified
