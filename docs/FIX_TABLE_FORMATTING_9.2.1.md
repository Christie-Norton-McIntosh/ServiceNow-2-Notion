# Fix: Table Formatting Issues (v9.2.1)

**Date**: October 18, 2025  
**Version**: 9.2.1  
**Priority**: HIGH  
**Status**: ✅ Fixed

---

## Overview

Three related formatting issues were discovered during live usage of ServiceNow-2-Notion with table-heavy pages. All issues affected how table content was displayed in Notion and have been resolved in version 9.2.1.

---

## Issue 1: Image Placeholders Not Conditional

### Problem

All images extracted from table cells showed the placeholder text "See image below" in the table cells, even when the images were invalid and not being uploaded to Notion. This created misleading placeholders pointing to non-existent images.

### Root Cause

The table converter (`server/converters/table.cjs`) replaced all image references with the descriptive placeholder without tracking which images would actually be uploaded. The validation logic existed but wasn't used to determine placeholder type.

### Example

**Before Fix:**
```
Table Cell Content:
"See 'Figure 1. Diagram'" → Notion shows image below
"See 'Invalid Image'" → Notion shows NO image (misleading!)
```

**After Fix:**
```
Table Cell Content:
"See 'Figure 1. Diagram'" → Notion shows image below ✅
"• " → Notion shows NO image (clear indicator) ✅
```

### Solution

Modified `processTableCellContent()` in `server/converters/table.cjs` to:

1. **Track valid images** during extraction:
   ```javascript
   const validImageUrls = new Set();
   // ... during image processing ...
   if (isValidImageUrl(imgUrl)) {
       validImageUrls.add(originalSrc);
   }
   ```

2. **Conditionally apply placeholder** based on validity:
   ```javascript
   if (validImageUrls.has(imgMatch)) {
       // Valid image - use descriptive placeholder
       replacement = caption ? `See "${caption}"` : 'See image below';
   } else {
       // Invalid image - use bullet placeholder
       replacement = ' • ';
   }
   ```

### Files Changed

- `server/converters/table.cjs` (processTableCellContent function)

### Commit

- **SHA**: 5578623
- **Message**: `fix(table): use bullet placeholder for invalid images not uploaded to Notion`

---

## Issue 2: Bullets on Same Line in Table Cells

### Problem

When table cells contained multiple bullet items, they appeared on the same line instead of being separated by line breaks:

```
• Item1 • Item2 • Item3
```

Instead of:
```
• Item1
• Item2
• Item3
```

### Root Cause

The HTML list processing in `processTableCellContent()` converted `<ul>` and `<ol>` elements to text with bullet characters, but didn't insert newlines between items. The text was concatenated directly without line breaks.

### Example

**Input HTML:**
```html
<ul>
  <li>Item one</li>
  <li>Item two</li>
  <li>Item three</li>
</ul>
```

**Before Fix:**
```
• Item one • Item two • Item three
```

**After Fix:**
```
• Item one
• Item two
• Item three
```

### Solution

Added bullet formatting logic in `processTableCellContent()`:

1. **Detect multiple bullets**:
   ```javascript
   if (/•[^•]+•/.test(textContent)) {
       // Multiple bullets found
   }
   ```

2. **Insert newlines between bullets**:
   ```javascript
   textContent = textContent.replace(/([^\n])(\s*•\s*)/g, '$1\n$2');
   ```

3. **Clean leading whitespace**:
   ```javascript
   textContent = textContent.split('\n')
       .map(line => line.trim())
       .join('\n');
   ```

### Files Changed

- `server/converters/table.cjs` (processTableCellContent function)

### Commit

- **SHA**: ae1a5a7
- **Message**: `fix(table): add soft returns between bullet items in table cells`

---

## Issue 3: UIControl Formatting Missing & Newlines Collapsed

### Problem

Two related issues in rich text conversion:

1. **UIControl spans not formatted**: ServiceNow uses `<span class="ph uicontrol">Assignment group</span>` to indicate UI elements (buttons, fields, menu items). These appeared as plain text in Notion instead of being formatted as bold+blue to match ServiceNow's visual styling.

2. **Newlines collapsed in table cells**: The whitespace normalization regex `/\s+/g` replaced ALL whitespace (including newlines) with single spaces, causing intentional line breaks (like the bullet formatting from Issue 2) to be collapsed.

### Root Cause

The rich text converter (`server/converters/rich-text.cjs`) had marker-based formatting for many ServiceNow classes (`ph`, `keyword`, `parmname`, `codeph`) but did NOT include `uicontrol`. Additionally, the whitespace handling was too aggressive.

### Example

**Input HTML:**
```html
<span class="ph uicontrol">Assignment group</span>
```

**Before Fix:**
```
Assignment group (plain text)
```

**After Fix:**
```
Assignment group (bold + blue)
```

**Newline Example:**

**Input:**
```
Item one
Item two
```

**Before Fix:**
```
Item one Item two (collapsed to single line)
```

**After Fix:**
```
Item one
Item two (preserved)
```

### Solution

Modified `convertRichTextBlock()` in `server/converters/rich-text.cjs`:

1. **Added uicontrol span detection**:
   ```javascript
   html = html.replace(
       /<span[^>]*class=["'][^"']*\buicontrol\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi,
       (match, content) => `__BOLD_BLUE_START__${content}__BOLD_BLUE_END__`
   );
   ```

2. **Changed whitespace handling** to preserve newlines:
   ```javascript
   // Before: text = text.replace(/\s+/g, ' ');
   
   // After: collapse non-newline whitespace only
   text = text.replace(/[^\S\n]+/g, ' ');
   text = text.replace(/ *\n */g, '\n');
   ```

3. **Added marker parsing** for bold+blue:
   ```javascript
   case '__BOLD_BLUE_START__':
       currentBold = true;
       currentColor = 'blue';
       break;
   case '__BOLD_BLUE_END__':
       currentBold = false;
       currentColor = 'default';
       break;
   ```

### Files Changed

- `server/converters/rich-text.cjs` (convertRichTextBlock function)

### Commit

- **SHA**: a3e819d
- **Message**: `fix(rich-text): add uicontrol formatting (bold+blue) and preserve newlines in table cells`

---

## Technical Details

### Marker System

ServiceNow-2-Notion uses a marker-based system to preserve formatting through HTML parsing and conversion:

1. **Phase 1**: Replace HTML tags with markers
   ```javascript
   <span class="ph uicontrol">Text</span>
   → __BOLD_BLUE_START__Text__BOLD_BLUE_END__
   ```

2. **Phase 2**: Parse text and split on markers
   ```javascript
   const markerPattern = /__BOLD_START__|__BOLD_END__|__BOLD_BLUE_START__|__BOLD_BLUE_END__|.../;
   const parts = text.split(markerPattern);
   ```

3. **Phase 3**: Build Notion rich_text array with formatting
   ```javascript
   for (const part of parts) {
       if (part === '__BOLD_BLUE_START__') {
           currentBold = true;
           currentColor = 'blue';
       } else if (isTextPart(part)) {
           richTextArray.push({
               type: 'text',
               text: { content: part },
               annotations: { bold: currentBold, color: currentColor }
           });
       }
   }
   ```

### ServiceNow Class Conventions

| ServiceNow Class | Notion Format | Use Case |
|-----------------|---------------|----------|
| `ph uicontrol` | Bold + Blue | UI elements (buttons, fields, menus) |
| `ph keyword` | Bold | Keywords, important terms |
| `ph parmname` | Italic | Parameter names, variables |
| `ph codeph` | Code (inline) | Short code snippets, commands |

### Whitespace Regex Patterns

| Regex | Matches | Replacement | Effect |
|-------|---------|-------------|--------|
| `/\s+/g` | All whitespace (spaces, tabs, newlines) | `' '` | Collapses everything to single space ❌ |
| `/[^\S\n]+/g` | Non-newline whitespace only | `' '` | Collapses spaces/tabs, preserves newlines ✅ |
| `/ *\n */g` | Spaces around newlines | `'\n'` | Cleans whitespace around line breaks ✅ |

---

## Testing

### Test Case 1: Conditional Placeholders

**Test Page**: Any ServiceNow page with tables containing both valid and invalid images

**Test Steps**:
1. Extract page with table containing images
2. Check server logs for image validation
3. Verify Notion table cells show:
   - "See image below" for valid images
   - "•" for invalid images
4. Verify images below table match valid placeholders

**Expected Result**: ✅ Only valid images have descriptive placeholders

### Test Case 2: Bullet Formatting

**Test Page**: ServiceNow page with table cells containing bulleted lists

**Test Steps**:
1. Extract page with table containing `<ul>` or `<ol>` elements
2. View table in Notion
3. Verify bullets appear on separate lines

**Expected Result**: ✅ Each bullet item on its own line with soft return

### Test Case 3: UIControl Formatting

**Test Page**: ServiceNow page with UI element references (e.g., "Click the **Assignment group** field")

**Test Steps**:
1. Extract page with `<span class="ph uicontrol">` elements
2. View content in Notion
3. Verify UI element names are **bold** and **blue**

**Expected Result**: ✅ UI elements formatted as bold+blue

### Test Case 4: Newline Preservation

**Test Page**: Any page with table cells containing multi-line content

**Test Steps**:
1. Extract page with formatted table cells
2. Apply bullet formatting fix
3. View content in Notion
4. Verify line breaks preserved

**Expected Result**: ✅ Line breaks not collapsed during conversion

---

## Validation

All fixes validated using real ServiceNow documentation pages:

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html
```

**Server Logs Confirmed**:
- ✅ `🔧 Replacing figures with placeholders in table HTML...`
- ✅ `📸 Extracting images from table HTML...`
- ✅ `🔍 Conditional placeholder applied for invalid image`
- ✅ `🔍 Detected multiple bullets, adding line breaks`
- ✅ `🔍 Found uicontrol span, applying bold+blue markers`
- ✅ `🔍 Preserving newlines in rich text conversion`

**Notion Output Confirmed**:
- ✅ Table cells with bullets show properly formatted lists
- ✅ UI element names appear bold and blue
- ✅ Only valid images have "See image below" placeholders
- ✅ Line breaks preserved throughout conversion

---

## Impact

### Before Fix

- **Confusion**: Invalid image placeholders misled users
- **Readability**: Bullets on same line hard to parse
- **Visual Consistency**: UI elements didn't match ServiceNow styling
- **Data Loss**: Intentional line breaks collapsed

### After Fix

- **Clarity**: Bullet placeholder clearly indicates no image
- **Readability**: Bulleted lists easy to scan
- **Visual Consistency**: Bold+blue UI elements match ServiceNow
- **Data Preservation**: Line breaks maintained through conversion

---

## Related Documentation

- `docs/TESTING_SCENARIOS.md` — Testing checklist (updated with v9.2.1 test cases)
- `docs/table-image-extraction.md` — Full table image handling documentation
- `docs/testing-table-images.md` — Detailed testing guide for table images
- `CHANGELOG.md` — Release notes for v9.2.1

---

## Version History

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-18 | 9.2.1 | All three issues fixed and tested |

---

*Last Updated: October 18, 2025*
