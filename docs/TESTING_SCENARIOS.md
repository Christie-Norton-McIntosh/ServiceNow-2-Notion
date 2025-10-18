# Testing Scenarios & Custom Handling

This document tracks all special scenarios that require custom handling in ServiceNow-2-Notion conversion, along with test pages and verification status.

## Overview

The ServiceNow-2-Notion converter has custom handling for various edge cases and complex content scenarios. This document serves as a comprehensive testing checklist to ensure all features work correctly after code changes.

---

## 1. Table Image Extraction

**Status**: ✅ Tested & Working  
**Priority**: HIGH  
**Last Tested**: October 16, 2025

### Description
Tables with embedded images (diagrams, flowcharts, state models) require special handling because Notion table cells cannot contain images. Images are extracted from table cells and placed as separate image blocks after the table, with placeholder text in the cells.

### Test URL
```
https://docs.servicenow.com/bundle/yokohama-it-service-management/page/product/change-management/concept/normal-standard-emergency-states.html
```

### Expected Behavior
- [ ] Images in table cells are preserved (not replaced with bullets)
- [ ] Table cells show placeholder text: "See 'Figure N. Caption text'"
- [ ] Images appear as separate blocks immediately after the table
- [ ] Image blocks have captions matching the placeholder text
- [ ] Images are at the same nesting level as the table (not indented)
- [ ] Multiple tables with images are handled correctly

### What to Look For
**In Notion:**
- Table cells contain readable "See 'Figure X...'" text
- Images appear below tables with proper captions
- Images are not missing or duplicated

**In Server Logs:**
- `🔧 Replacing figures with placeholders in table HTML...`
- `📸 Extracting images from table HTML...`
- `✅ Added image block with caption: "Figure N..."`

### Test Variations
- [ ] Single table with single image
- [ ] Single table with multiple images
- [ ] Multiple tables each with images
- [ ] Table with rowspan/colspan containing images
- [ ] Nested tables with images (edge case)

### Related Files
- `src/content/content-extractor.js` (lines 192-225, 313-341, 677-692)
- `server/services/servicenow.cjs` (lines 621-680)
- `docs/table-image-extraction.md` (full documentation)
- `docs/testing-table-images.md` (detailed testing guide)

---

## 2. Rich Text 100-Element Limit

**Status**: ✅ Tested & Working  
**Priority**: HIGH  
**Last Tested**: October 13, 2025

### Description
Notion's API limits rich_text arrays to 100 elements per block. ServiceNow pages with heavy inline formatting (code blocks, links, bold/italic) can easily exceed this limit. Content is automatically split into multiple consecutive blocks.

### Test URL
```
https://docs.servicenow.com/bundle/yokohama-platform-administration/page/administer/navigation-and-ui/concept/c_CustomizingUIPages.html
```
*(Any page with heavy inline code formatting and many links)*

### Expected Behavior
- [ ] Pages with >100 rich text elements don't cause API errors
- [ ] Content is split into multiple consecutive blocks
- [ ] Formatting is preserved across block boundaries
- [ ] Split is invisible to end user (reads naturally)
- [ ] No content is lost or duplicated

### What to Look For
**In Notion:**
- Long paragraphs with heavy formatting appear complete
- Content flows naturally (no awkward breaks)
- Formatting (bold, italic, code, links) preserved throughout

**In Server Logs:**
- `🔍 Rich text has X elements, splitting into Y chunks`
- `✅ Added paragraph block (chunk N/Y)`

### Test Variations
- [ ] Paragraph with 100+ inline code blocks
- [ ] Paragraph with 100+ links
- [ ] Heading with 100+ formatted elements
- [ ] List item with 100+ elements
- [ ] Callout with 100+ elements

### Related Files
- `server/services/servicenow.cjs` (splitRichTextArray function, lines ~450-470)
- `docs/fix-rich-text-100-element-limit.md` (full documentation)

---

## 3. Code Block Extraction

**Status**: ✅ Tested & Working  
**Priority**: HIGH  
**Last Tested**: October 16, 2025

### Description
Code blocks (`<pre><code>`) require special handling to preserve whitespace, indentation, and line breaks. Language detection from class attributes enables syntax highlighting in Notion.

### Test URLs
```
https://docs.servicenow.com/bundle/yokohama-application-development/page/build/applications/concept/api-javascript-gliderecord.html
```
*(Pages with JavaScript, XML, JSON code examples)*

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html
```
✅ **Tested October 16, 2025** - JavaScript code blocks with language detection, code blocks nested in list items

### Expected Behavior
- [ ] Code blocks preserve exact whitespace and indentation
- [ ] Line breaks are maintained (not collapsed)
- [ ] HTML entities are decoded (`&lt;` → `<`, `&amp;` → `&`)
- [ ] Language is detected from class (e.g., `language-javascript`)
- [ ] Language is normalized for Notion (e.g., `js` → `javascript`)
- [ ] Unknown languages default to "plain text"

### What to Look For
**In Notion:**
- Code blocks appear with proper formatting
- Syntax highlighting is applied when language detected
- Indentation matches original ServiceNow page

**In Server Logs:**
- `🔍 Found pre/code element`
- `🔍 Detected language from class: javascript`
- `🔍 Normalized language: javascript`
- `✅ Creating code block with language: javascript`

### Test Variations
- [ ] JavaScript code blocks
- [ ] XML/HTML code blocks
- [ ] JSON code blocks
- [ ] Shell/bash script blocks
- [ ] Code blocks with no language specified
- [ ] Nested `<pre><code>` structures

### Related Files
- `server/services/servicenow.cjs` (lines 680-760, code block handling)

---

## 4. Nested Lists (2-Level Support)

**Status**: ✅ Tested & Working  
**Priority**: MEDIUM  
**Last Tested**: October 16, 2025

### Description
ServiceNow pages contain nested bulleted and numbered lists. Notion API supports nested lists as children of list items, but with limitations on depth and nesting combinations.

### Test URLs
```
https://docs.servicenow.com/bundle/yokohama-platform-administration/page/administer/security/concept/c_AccessControl.html
```
*(Pages with complex hierarchical lists)*

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html
```
✅ **Tested October 16, 2025** - Code blocks nested in list items with marker system (sn2n:mgu9s2gs-4v45t0), orchestrator successfully appended deferred blocks

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html
```
✅ **Tested October 16, 2025** - Multiple lists including 40-item list under "Applications and features" heading, 7-item list under "Learn" section, 4-item list under "Get started" section

### Expected Behavior
- [ ] Nested bulleted lists preserved (2 levels)
- [ ] Nested numbered lists preserved (2 levels)
- [ ] Mixed list types handled correctly
- [ ] List items with paragraphs and nested lists work
- [ ] Empty list items (structural) are handled
- [ ] Marker system used for unsupported nested content

### What to Look For
**In Notion:**
- Nested lists appear indented correctly
- List numbering is sequential
- Mixed content (text + nested lists) works

**In Server Logs:**
- `🔍 Processing bulleted_list_item`
- `🔍 Processing nested list (ul/ol)`
- `🔍 Creating bulleted_list_item with X valid children`
- `🔍 Added marker (sn2n:XXX) for N deferred blocks`

### Test Variations
- [ ] Bulleted list with nested bulleted list
- [ ] Numbered list with nested numbered list
- [ ] Bulleted list with nested numbered list
- [ ] Numbered list with nested bulleted list
- [ ] List items with multiple paragraphs + nested lists
- [ ] 3+ level deep nesting (should gracefully degrade)

### Related Files
- `server/services/servicenow.cjs` (lines 1050-1200, list handling)

---

## 5. "Before You Begin" Prerequisite Sections

**Status**: ✅ Implemented  
**Priority**: MEDIUM  
**Last Tested**: October 2025

### Description
ServiceNow documentation often has `<section class="prereq">` elements for prerequisites. These are converted to Notion callouts with a pushpin emoji (📌) to visually distinguish them.

### Test URL
```
https://docs.servicenow.com/bundle/yokohama-platform-administration/page/administer/navigation-and-ui/task/t_CreateAModule.html
```
*(Task pages typically have "Before you begin" sections)*

### Expected Behavior
- [ ] Prereq sections converted to callout blocks
- [ ] Callout has pushpin emoji (📌) icon
- [ ] Content formatting preserved in callout
- [ ] Images in prereq sections handled correctly
- [ ] Multiple prereq sections on same page work

### What to Look For
**In Notion:**
- Blue callout box with 📌 icon
- Clear heading "Before you begin" or similar
- Content readable and properly formatted

**In Server Logs:**
- `🔍 Processing prereq section as callout`
- `🔍 Prereq parsed into X rich text elements`
- `✅ Added callout block for prereq section`

### Test Variations
- [ ] Single prereq section
- [ ] Multiple prereq sections
- [ ] Prereq with formatted text (bold, code, links)
- [ ] Prereq with lists
- [ ] Prereq with images

### Related Files
- `server/services/servicenow.cjs` (lines 1570-1620, prereq handling)

---

## 6. ServiceNow URL Conversion

**Status**: ✅ Implemented  
**Priority**: HIGH  
**Last Tested**: October 2025

### Description
ServiceNow documentation links use various URL formats that need normalization for proper Notion link handling. Relative paths must be converted to absolute URLs.

### Test URL
Any ServiceNow documentation page with internal links.

### Expected Behavior
- [ ] Relative links converted to absolute URLs
- [ ] `/$webhelp.do?` format converted to standard format
- [ ] ServiceNow instance URLs preserved
- [ ] Invalid/malformed URLs handled gracefully
- [ ] Fragment identifiers (#anchors) preserved

### What to Look For
**In Notion:**
- Links are clickable and point to correct pages
- No broken links or missing hrefs
- Links open in new tab to ServiceNow docs

**In Server Logs:**
- `🔗 Converting ServiceNow URL: ...`
- `✅ Converted to: https://docs.servicenow.com/...`

### Test Variations
- [ ] Relative links (`../concept/c_SomeTopic.html`)
- [ ] Absolute ServiceNow links
- [ ] Links with query parameters
- [ ] Links with fragment identifiers
- [ ] External links (non-ServiceNow)

### Related Files
- `server/utils/url.cjs` (convertServiceNowUrl function)

---

## 7. Image URL Handling & Upload

**Status**: ⚠️ Partial (External URLs only)  
**Priority**: MEDIUM  
**Last Tested**: October 16, 2025

### Description
Images from ServiceNow pages are inserted as Notion image blocks. Currently uses external URLs; actual upload to Notion storage is TODO.

### Test URLs
Any ServiceNow page with diagrams or screenshots.

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html
```
✅ **Tested October 16, 2025** - Multiple standalone images successfully extracted:
- Figure 1: "ITSM is the foundation of digital transformation"
- Figure 2: "Comparing a typical IT department with scattered tools to the ServiceNow AI Platform linking IT functions"
- Figure 3: "Consolidated IT services diagram"
- Figure 4: "Gain visibility into processes and services"
- All images NOT in tables, standalone `<figure>` elements
- Captions extracted correctly from `<figcaption>` elements with technical spans

### Expected Behavior
- [ ] Images with valid URLs appear in Notion
- [ ] Image captions preserved from `<figcaption>`
- [ ] Broken/invalid image URLs handled gracefully
- [ ] Large images don't cause API errors
- [ ] Multiple images on same page all appear

### What to Look For
**In Notion:**
- Images visible and properly sized
- Captions appear below images
- No broken image icons

**In Server Logs:**
- `🖼️ Adding image block: https://...`
- `📝 Image caption: "Figure 1. ..."`

### Test Variations
- [ ] Single image
- [ ] Multiple images in sequence
- [ ] Images with captions
- [ ] Images without captions
- [ ] Very large images
- [ ] SVG images

### Known Limitations
- ⚠️ Images use external URLs (not uploaded to Notion storage)
- ⚠️ If ServiceNow URLs become inaccessible, images break
- 📝 TODO: Implement actual image download and upload

### Related Files
- `server/services/notion.cjs` (lines 150-160, image upload TODO)
- `server/services/servicenow.cjs` (image block creation)

---

## 8. Div/Section Container Handling

**Status**: ✅ Tested & Working  
**Priority**: MEDIUM  
**Last Tested**: October 16, 2025

### Description
ServiceNow pages use many `<div>` and `<section>` containers for layout. These must be processed recursively while avoiding unnecessary nesting in Notion.

### Test URLs
Any complex ServiceNow documentation page.

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html
```
✅ **Tested October 16, 2025** - Mixed content (text + nested blocks), `<div class="p">` with nested `<ul>` and `<pre>` elements

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html
```
✅ **Tested October 16, 2025** - Extremely complex nested structure:
- 86 blocks from deeply nested HTML (31,563 characters)
- 12 top-level sections with multiple children each (1-7 children per section)
- Deep container hierarchy: div.zDocsTopicPageBodyContent > div.none > article.hascomments > main.none > article.overview.dita > div.body.refbody
- Special containers: `table-wrap`, `contentPlaceholder`, `contentContainer zDocsSideBoxes withExpandCollapse`, `contentWrapper`
- Mixed content throughout (text + nested figures, lists, divs)

### Expected Behavior
- [ ] Container divs processed recursively
- [ ] Layout containers don't create empty blocks
- [ ] Content extraction flattens unnecessary nesting
- [ ] Special classes trigger custom handling (e.g., `note`, `prereq`)
- [ ] Deeply nested content doesn't hit recursion limits

### What to Look For
**In Notion:**
- Clean content structure (not overly nested)
- No empty blocks or gaps
- Logical content flow

**In Server Logs:**
- `🔍 Processing div/section container`
- `🔍 Processing N children`
- `🔍 Container processed as [handling type]`

### Test Variations
- [ ] Simple divs with paragraphs
- [ ] Nested divs (3+ levels)
- [ ] Divs with mixed content (text, lists, images)
- [ ] Sections with special classes
- [ ] Empty containers (should be skipped)

### Related Files
- `server/services/servicenow.cjs` (container handling throughout)

---

## 9. Note/Warning/Caution Callouts

**Status**: ✅ Tested & Working  
**Priority**: MEDIUM  
**Last Tested**: October 16, 2025

### Description
ServiceNow documentation uses `<div class="note">`, `<div class="warning">`, etc. for callout content. These are converted to Notion callout blocks with appropriate icons.

### Test URLs
```
https://docs.servicenow.com/bundle/yokohama-platform-administration/page/administer/security/concept/c_AccessControl.html
```
*(Pages with notes, warnings, and cautions)*

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html
```
✅ **Tested October 16, 2025** - Note callout in complex context:
- Callout class: `<div class="note note note_note">`
- Successfully matched and converted with 3 rich text elements
- Located in "Edge Encryption for ITSM Virtual Agent within ITSM" section
- Nested within `<div class="p">` mixed content container
- Content: "Note: There are limitations when using edge encryption..."

### Expected Behavior
- [ ] Note divs converted to callouts with 💡 icon
- [ ] Warning divs converted to callouts with ⚠️ icon
- [ ] Caution divs converted to callouts with ⚡ icon
- [ ] Content formatting preserved in callouts
- [ ] Multiple callouts on same page work

### What to Look For
**In Notion:**
- Callout boxes with appropriate colors
- Icons match callout type
- Content is readable and formatted

**In Server Logs:**
- `🔍 Processing note/warning/caution as callout`
- `✅ Added callout block with icon: 💡`

### Test Variations
- [ ] Note callouts
- [ ] Warning callouts
- [ ] Caution callouts
- [ ] Callouts with lists
- [ ] Callouts with code blocks
- [ ] Callouts with images

### Related Files
- `server/services/servicenow.cjs` (callout handling, lines 500-550)

---

## 10. Property Mapping & Metadata

**Status**: ✅ Tested & Working  
**Priority**: HIGH  
**Last Tested**: October 16, 2025

### Description
ServiceNow page metadata (title, URL, category, breadcrumb) is mapped to Notion page properties. Users can configure property mappings via modal UI.

### Test URLs
Any ServiceNow documentation page.

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/customize-script-includes-itsm.html
```
✅ **Tested October 16, 2025** - All metadata properties extracted correctly:
- Name: "Script includes and customization"
- URL: Full bundle URL
- Source: "ServiceNow Technical Documentation"
- Category: "IT Service Management"
- Section: "Script includes and customization"
- Version: "Yokohama"
- Updated: "Jan 29, 2025"
- CurrentReleaseURL: CSH URL format
- Breadcrumb: "Yokohama IT Service Management > IT Service Management"
- Video: false
- Image: false

```
https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html
```
✅ **Tested October 16, 2025** - Overview page with complete metadata:
- Name: "IT Service Management"
- URL: `https://www.servicenow.com/docs/bundle/yokohama-it-service-management/page/product/it-service-management/reference/r_ITServiceManagement.html`
- Source: "ServiceNow Technical Documentation"
- Category: "IT Service Management"
- Section: "IT Service Management"
- Version: "Yokohama"
- Updated: "Jan 29, 2025"
- CurrentReleaseURL: `https://www.servicenow.com/docs/csh?topicname=r_ITServiceManagement.html&version=latest`
- Breadcrumb: "Yokohama IT Service Management"
- Video: false
- Image: **true** (correctly detected 4 images on page)

### Expected Behavior
- [ ] Page title extracted correctly
- [ ] URL property populated
- [ ] Category/breadcrumb extracted
- [ ] Custom property mappings respected
- [ ] Property values properly formatted for Notion types

### What to Look For
**In Notion:**
- Page title matches ServiceNow page
- Properties panel shows correct metadata
- Custom properties mapped as configured

**In Browser Console:**
- `🔧 Property mapping: title → Title`
- `📊 Mapped properties: {...}`

### Test Variations
- [ ] Default property mapping
- [ ] Custom property mapping
- [ ] Missing metadata (graceful handling)
- [ ] Special characters in titles/URLs
- [ ] Long titles (truncation?)

### Related Files
- `src/ui/property-mapping-modal.js` (UI for configuration)
- `src/api/notion-api.js` (property mapping logic)

---

## Testing Workflow

### Before Each Release

1. **Quick Smoke Test** (15 minutes)
   - Test scenarios 1, 2, 3, 5 with known URLs
   - Verify no console errors or server errors
   - Check Notion pages render correctly

2. **Full Regression Test** (45 minutes)
   - Test all 10 scenarios with all variations
   - Document any failures or unexpected behavior
   - Update this document with new test URLs

3. **Edge Case Testing** (30 minutes)
   - Test unusual page structures
   - Test with very large pages (100+ blocks)
   - Test with heavy formatting (1000+ rich text elements)
   - Test with many images (10+ per page)

### After Code Changes

If you modified:
- **`content-extractor.js`** → Test scenarios 1, 3, 8
- **`servicenow.cjs`** → Test ALL scenarios
- **`table.cjs`** → Test scenario 1
- **`rich-text.cjs`** → Test scenarios 2, 3, 4
- **`notion-api.js`** → Test scenario 10

### Reporting Issues

When a test fails, document:
1. Scenario number and name
2. Test URL used
3. Expected behavior
4. Actual behavior (with screenshots if possible)
5. Server logs (relevant errors)
6. Browser console logs (if applicable)
7. Steps to reproduce

---

## Test URLs Quick Reference

| Scenario | Test URL |
|----------|----------|
| 1. Table Images | `https://docs.servicenow.com/.../normal-standard-emergency-states.html` ✅ |
| 2. Rich Text Limit | `https://docs.servicenow.com/.../c_CustomizingUIPages.html` |
| 3. Code Blocks | `https://docs.servicenow.com/.../customize-script-includes-itsm.html` ✅ |
| 4. Nested Lists | `https://docs.servicenow.com/.../r_ITServiceManagement.html` ✅ |
| 5. Prerequisites | `https://docs.servicenow.com/.../t_CreateAModule.html` |
| 6. URL Conversion | Any internal ServiceNow doc page |
| 7. Images | `https://docs.servicenow.com/.../r_ITServiceManagement.html` ✅ |
| 8. Containers | `https://docs.servicenow.com/.../r_ITServiceManagement.html` ✅ |
| 9. Callouts | `https://docs.servicenow.com/.../r_ITServiceManagement.html` ✅ |
| 10. Properties | `https://docs.servicenow.com/.../r_ITServiceManagement.html` ✅ |

---

## Version History

| Date | Version | Changes | Tester |
|------|---------|---------|--------|
| 2025-10-16 | 1.0.0 | Initial document creation | AI Assistant |
| | | Documented 10 core scenarios | |
| | | Added test URLs where available | |
| 2025-10-16 | 1.1.0 | Added test results from live usage | User |
| | | Updated scenarios 3, 4, 7, 8, 9, 10 with verified test URLs | |
| | | Marked 6 scenarios as tested & working | |

---

## Notes

- **Test URLs**: Some URLs are abbreviated with `...` for readability. Expand based on actual ServiceNow documentation structure.
- **Status Legend**: 
  - ✅ Tested & Working
  - ⚠️ Partial implementation or known limitations
  - ❌ Not working / needs fixes
  - 📝 TODO / Not yet implemented
- **Priority**: HIGH = critical functionality, MEDIUM = important but not blocking, LOW = nice to have

---

## Future Test Scenarios to Add

- [ ] Table with merged cells (complex rowspan/colspan)
- [ ] Video embeds from ServiceNow pages
- [ ] Interactive elements (dropdowns, tabs)
- [ ] Very long code blocks (>2000 characters)
- [ ] Pages with 100+ blocks (pagination?)
- [ ] Right-to-left text content
- [ ] Special Unicode characters
- [ ] SVG diagrams (inline vs external)
- [ ] Animated GIFs
- [ ] PDF links/embeds

---

*Last Updated: October 16, 2025*
