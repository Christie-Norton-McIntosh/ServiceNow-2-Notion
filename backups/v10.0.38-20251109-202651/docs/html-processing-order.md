# HTML Processing Order of Operations

**ServiceNow-2-Notion: HTML-to-Notion Block Conversion**

Last Updated: October 29, 2025 (v9.2.59)

---

## Overview

This document explains the critical order of operations for processing ServiceNow HTML content and converting it to Notion blocks. The order matters because each step can affect what subsequent steps see and process.

## Two Processing Paths

ServiceNow HTML is processed through two different code paths depending on content type:

### Path 1: `parseRichText()` (Complex Content)
**Location:** `server/services/servicenow.cjs` lines ~230-750  
**Used for:** Callouts, list items, inline mixed content, tables

### Path 2: `convertRichTextBlock()` (Simple Content)  
**Location:** `server/converters/rich-text.cjs` lines ~60-430  
**Used for:** Simple paragraphs, headings, standalone text blocks

---

## Path 1: `parseRichText()` Order of Operations

This is the most complex path and handles the majority of ServiceNow documentation content.

### Phase 1: Tag Extraction & Protection (Before HTML Cleanup)

Order is critical here - each step must see the output of previous steps.

#### 1. **Extract `<kbd>` Tags** (Line ~269)
```javascript
const kbdPlaceholders = [];
text = text.replace(/<kbd[^>]*>([\s\S]*?)<\/kbd>/gi, ...);
// → Converts to __KBD_PLACEHOLDER_n__
```
**Why first:** Preserves keyboard shortcuts and UI labels before entity decoding

#### 2. **Decode HTML Entities** (Line ~287)
```javascript
text = text
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&')
  ...
```
**Why here:** After kbd extraction but before other processing, so navigation arrows like "All > System" work correctly

#### 3. **Extract Links** (Line ~300) ⚠️ CRITICAL
```javascript
const links = [];
text = text.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, ...);
// → Converts to __LINK_n__
```
**Why before placeholder protection:** Prevents `<a href=...>` from being misidentified as placeholder due to `href=` attribute

#### 4. **Protect Technical Placeholders** (Line ~308)
```javascript
const technicalPlaceholders = [];
text = text.replace(/<([^>]+)>/g, (match, content) => {
  // Only protect non-HTML-tag content like <plugin name>, <instance-name>
  const isHtmlTag = /^\/?\s*[a-z][a-z0-9]*\s*($|>|\/|[a-z]+=)/i.test(content.trim());
  if (!isHtmlTag) {
    return `__TECH_PLACEHOLDER_${index}__`;
  }
  ...
});
```
**Why after links:** Prevents interference with link extraction  
**Protected:** `<plugin name>`, `<instance-name>`, `<Tool ID>`, `<file.txt>`, etc.  
**Not protected:** `<div>`, `<span class="x">`, `<p>`, `<a href="...">`, etc.

#### 5. **Restore `<kbd>` Placeholders** (Line ~321)
```javascript
kbdPlaceholders.forEach((content, index) => {
  const formatted = processKbdContent(content); // → __CODE_START__ or __BOLD_START__
  text = text.replace(`__KBD_PLACEHOLDER_${index}__`, formatted);
});
```
**Why here:** After entity decoding, ready to convert to formatting markers

### Phase 2: Formatting Tag Processing

#### 6. **Strip Generic `<span class="ph">` Tags** (Line ~331)
```javascript
// Loop to handle nested spans
do {
  lastText = text;
  text = text.replace(/<span[^>]*class=["'][^"']*\bph\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, '$1');
} while (text !== lastText);
```
**Why here:** Exposes technical identifiers like `(com.snc.incident.ml)` for next step

#### 7. **Handle Technical Span Classes** (Line ~350)
```javascript
text = text.replace(/<span[^>]*class=["'][^"']*(?:\bkeyword\b|\bparmname\b|\bcodeph\b)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, ...);
// → Converts to __CODE_START__...
```
**Classes handled:** `keyword`, `parmname`, `codeph`

#### 8. **Handle `<code>` Tags** (Line ~479)
```javascript
text = text.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, ...);
// → Converts to __CODE_START__content__CODE_END__
```
**Why here:** After span processing, ready to mark as inline code

#### 9. **Handle `<samp>` Tags** (Line ~487) [Added v9.2.56]
```javascript
text = text.replace(/<samp([^>]*)>([\s\S]*?)<\/samp>/gi, ...);
// → Converts to __CODE_START__content__CODE_END__
```
**Purpose:** Sample output/system output formatted as inline code

#### 10. **Handle UI Control Spans** (Line ~310)
```javascript
text = text.replace(/<span[^>]*class=["'][^"']*uicontrol[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, ...);
// → Converts to __BOLD_BLUE_START__...
```
**Purpose:** ServiceNow UI element names (bold + blue)

### Phase 3: HTML Cleanup & URL Processing

#### 11. **Clean HTML Tags** (Line ~545)
```javascript
text = cleanHtmlText(text);
```
**Strips:** All remaining HTML tags (preserving markers and technical placeholders)  
**Location:** `server/utils/notion-format.cjs`

#### 12. **Restore URLs** (Line ~550)
```javascript
text = text.replace(/__URL_PLACEHOLDER_(\d+)__/g, ...);
```
**Purpose:** Restore URLs that were protected during cleaning

### Phase 4: Image & Video Extraction

#### 13. **Extract Images** (Line ~555)
```javascript
while ((imgMatch = imgRegex.exec(text)) !== null) {
  const imageBlock = await createImageBlock(src, alt);
  imageBlocks.push(imageBlock);
}
```

#### 14. **Extract Videos/Iframes** (Earlier, Line ~380)
```javascript
while ((iframeMatch = iframeRegex.exec(text)) !== null) {
  if (isVideoIframeUrl(src)) {
    videoBlocks.push({ type: "video", ... });
  }
}
```

### Phase 5: Rich Text Assembly

#### 15. **Split into Marker Parts** (Line ~618)
```javascript
const parts = text.split(/(__BOLD_START__|__BOLD_END__|__CODE_START__|__CODE_END__|__LINK_\d+__|...)/);
```

#### 16. **Process Each Part** (Line ~620-680)
- Plain text → `{ type: "text", text: { content: "..." } }`
- `__CODE_START__` → Set `code: true, color: "red"`
- `__BOLD_START__` → Set `bold: true`
- `__LINK_n__` → Look up link info, create link element
- etc.

#### 17. **Restore Technical Placeholders** (Line ~735) [Added v9.2.58]
```javascript
richText.forEach(element => {
  element.text.content = element.text.content.replace(/__TECH_PLACEHOLDER_(\d+)__/g, (match, index) => {
    return `<${technicalPlaceholders[index]}>`;
  });
});
```
**Why last:** Converts markers back to angle bracket format in final output

#### 18. **Return Result**
```javascript
return { richText, imageBlocks, videoBlocks };
```

---

## Path 2: `convertRichTextBlock()` Order of Operations

**Location:** `server/converters/rich-text.cjs`

### Processing Steps

#### 1. **Protect Technical Placeholders** (Line ~141)
```javascript
const technicalPlaceholders = [];
html = html.replace(/&lt;([^&]+)&gt;/g, ...); // Entity-encoded
html = html.replace(/<([^>]+)>/g, ...);        // Already-decoded
// → Converts to __TECH_PLACEHOLDER_n__
```
**Same logic as parseRichText()** - protects `<plugin name>`, etc.

#### 2. **Extract and Protect URLs** (Line ~167)
```javascript
const urlPlaceholders = [];
text = html.replace(/\b(https?:\/\/[^\s]+?)(?=\s|$)/gi, ...);
// → Converts to __URL_PLACEHOLDER_n__
```

#### 3. **Decode HTML Entities** (Line ~190)
```javascript
text = text
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  ...
```

#### 4. **Strip HTML Tags** (Line ~211)
```javascript
text = text.replace(/<\/?(?:div|span|p|a|img|...[long list]...)(?:\s+[^>]*)?>/gi, ' ');
```
**Strips known HTML tags** while preserving technical placeholders

#### 5. **Handle Special Formatting Tags** (Line ~238)
```javascript
// <code> tags
html = html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, ...);

// <samp> tags [Added v9.2.54]
html = html.replace(/<samp([^>]*)>([\s\S]*?)<\/samp>/gi, ...);
```

#### 6. **Process Technical Identifiers** (Line ~330)
```javascript
// Pattern: (com.package.name)
text = text.replace(/\(([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+)\)/gi, ...);
```

#### 7. **Restore Placeholders** (Line ~230-250)
```javascript
// Restore URLs
text = text.replace(/__URL_PLACEHOLDER_(\d+)__/g, ...);

// Restore technical placeholders
text = text.replace(/__TECH_PLACEHOLDER_(\d+)__/g, ...);
```

---

## Critical Order Dependencies

### ✅ Correct Order Ensures:

1. **Links extracted before placeholder protection** (v9.2.59 fix)
   - Prevents `<a href="...">` from being protected as placeholder
   
2. **Placeholders protected before HTML cleanup**
   - Prevents `<plugin name>` from being stripped as HTML tag
   
3. **Placeholders restored AFTER all processing**
   - Ensures they survive HTML cleanup and marker processing
   
4. **Entity decoding after kbd extraction**
   - Preserves special characters in keyboard shortcuts
   
5. **Generic span stripping before technical span handling**
   - Exposes technical identifiers for proper formatting

### ❌ Wrong Order Causes:

- **Placeholder protection before link extraction** → Links appear as raw HTML (bug in v9.2.58, fixed in v9.2.59)
- **HTML cleanup before placeholder protection** → Placeholders stripped (e.g., `<plugin name>` removed)
- **Entity decoding before kbd extraction** → Special characters in kbd tags get decoded too early
- **Technical span handling before generic span stripping** → Technical identifiers remain hidden in spans

---

## Marker System

All processing uses temporary markers to preserve content through multiple transformation steps:

| Marker Pattern | Purpose | When Created | When Resolved |
|----------------|---------|--------------|---------------|
| `__KBD_PLACEHOLDER_n__` | Keyboard shortcuts | Step 1 | Step 5 |
| `__LINK_n__` | Hyperlinks | Step 3 | Step 16 |
| `__TECH_PLACEHOLDER_n__` | Technical placeholders | Step 4 | Step 17 |
| `__CODE_START__` / `__CODE_END__` | Inline code | Steps 8-9 | Step 16 |
| `__BOLD_START__` / `__BOLD_END__` | Bold text | Step 5 | Step 16 |
| `__BOLD_BLUE_START__` / `__BOLD_BLUE_END__` | UI controls | Step 10 | Step 16 |
| `__URL_PLACEHOLDER_n__` | URLs | During cleanup | Step 12 |

---

## Version History of Order Changes

### v9.2.59 (Oct 29, 2025) - Link Extraction Fix
- **Change:** Moved link extraction (step 3) before placeholder protection (step 4)
- **Reason:** `<a href=...>` was being protected as placeholder, causing raw HTML in output
- **Impact:** Links now properly converted to Notion link objects

### v9.2.58 (Oct 29, 2025) - Placeholder Protection Added
- **Change:** Added technical placeholder protection to `parseRichText()`
- **Reason:** Callouts were losing `<plugin name>` and similar placeholders
- **Impact:** Technical placeholders now preserved in all content types

### v9.2.56 (Oct 29, 2025) - Samp Tag Handling
- **Change:** Added `<samp>` tag handler to `parseRichText()`
- **Reason:** `<samp>` tags appeared as literal text in callouts
- **Impact:** Sample output formatted as inline code

### v9.2.57 (Oct 29, 2025) - Improved Placeholder Regex
- **Change:** Stricter regex for identifying HTML tags vs placeholders
- **Reason:** `<plugin name>` was misidentified as HTML tag due to space
- **Impact:** Space-containing placeholders now properly protected

---

## Debugging Tips

### Check Processing Order
Look for console logs showing each step:
```
🔍 [parseRichText] After kbd extraction (0 kbd tags): ...
🔍 [parseRichText] After link extraction (3 links): ...
🔍 [parseRichText] After placeholder protection (1 placeholders): ...
🔒 [parseRichText] Protected placeholder: "<plugin name>"
🔓 [parseRichText] Restored placeholder: "__TECH_PLACEHOLDER_0__" -> "<plugin name>"
```

### Common Issues by Symptom

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| Raw HTML `<a data-bundleid="...">` in output | Link extraction after placeholder protection | Verify step 3 before step 4 |
| Missing `<plugin name>` text | Placeholder protection missing or after cleanup | Verify step 4 exists and before cleanup |
| `<samp>` appearing as literal text | Samp handler missing | Verify step 9 exists |
| Broken URLs | URL extraction/restoration order | Check step 2 and step 12 |
| Missing code formatting | Code tag handler missing | Verify steps 8-9 |

---

## Related Files

- **Main Processing:** `server/services/servicenow.cjs`
  - `parseRichText()` - Lines ~230-750
  - `extractContentFromHtml()` - Entry point
  
- **Simple Content:** `server/converters/rich-text.cjs`
  - `convertRichTextBlock()` - Lines ~60-430
  
- **HTML Utilities:** `server/utils/notion-format.cjs`
  - `cleanHtmlText()` - HTML tag stripping
  
- **Shared Utilities:** `server/utils/shared-html-utils.cjs`
  - `processKbdContent()` - Kbd tag classification
  - `processTechnicalSpan()` - Technical span handling

---

## Testing Checklist

When modifying processing order, test these scenarios:

- [ ] Links appear as proper Notion links (not raw HTML)
- [ ] Technical placeholders preserved: `<plugin name>`, `<instance-name>`, `<Tool ID>`
- [ ] Code formatting works: `<code>`, `<samp>`, technical identifiers
- [ ] Keyboard shortcuts formatted correctly: `<kbd>Ctrl+C</kbd>`
- [ ] UI controls appear bold + blue: `<span class="uicontrol">Save</span>`
- [ ] Navigation arrows work: "All > System > Settings"
- [ ] Images and videos extracted properly
- [ ] Callout content processed correctly
- [ ] List items (bullets/numbered) processed correctly
- [ ] Table cells processed correctly

---

## Future Considerations

If adding new HTML tag handlers or processing steps:

1. **Determine correct position** in the order based on dependencies
2. **Add logging** to show when the step runs
3. **Update this document** with the new step
4. **Test all scenarios** in the testing checklist
5. **Consider both paths** (parseRichText and convertRichTextBlock)

**Key principle:** Earlier steps should prepare content for later steps. Later steps should not need to handle cases that earlier steps already handled.
