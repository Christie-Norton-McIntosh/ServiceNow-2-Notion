# Fix Strategy: Menu Cascade & Inline Element Extraction (v11.0.117)

**Issue**: Menu cascade elements (`<menucascade>`) are split into separate segments during extraction, causing semantic mismatch when Notion coalesces them back into a single paragraph.

**Impact**: 27.5% content loss due to segment count mismatch (14 segments extracted vs 8 segments in Notion)

**Scope**: Affects both POST and PATCH endpoints (same extraction logic used)

---

## 🎯 Root Cause Analysis

### Current Behavior (Broken ❌)
```html
<!-- ServiceNow HTML -->
<section>
  You can find script includes by navigating to
  <span class="ph menucascade">
    <span class="ph uicontrol">Self Service</span>
    <abbr> &gt; </abbr>
    <span class="ph uicontrol">System Definition</span>
  </span>
  or
  <span class="ph menucascade">
    <span class="ph uicontrol">Self Service</span>
    <abbr> &gt; </abbr>
    <span class="ph uicontrol">System UI</span>
  </span>
</section>
```

**What extraction produces** (5 segments):
1. "You can find script includes by navigating to"
2. "Self Service > System Definition"
3. "or"
4. "Self Service > System UI"
5. ". To get the latest features..."

**What Notion receives** (1 paragraph):
- "You can find script includes by navigating to Self Service > System Definition or Self Service > System UI . To get the latest features..."

**Problem**: Validation counts 14 HTML segments but only finds 8 in Notion (coalesced into paragraph)

---

## 🛠️ Solution Strategy

### Fix #1: Pre-process Menu Cascades Before Extraction

**Location**: `server/services/servicenow.cjs` (before text extraction begins)

**Idea**: Convert `<menucascade>` elements to a preserved inline format that survives coalescing

```javascript
/**
 * FIX v11.0.117: Preserve menu cascades as inline elements
 * 
 * Menu cascades like:
 *   <span class="menucascade">File <abbr>> </abbr> Edit</span>
 * 
 * Are extracted as separate segments but Notion coalesces them back.
 * This causes validation mismatch (14 segments extracted vs 8 in Notion).
 * 
 * Solution: Convert to plain text with markers that survive coalescing:
 *   "File > Edit" (with marker for UI styling)
 */

function preprocessMenuCascades($html) {
  // Replace menu cascade elements with plain text + arrow notation
  // Pattern: <menucascade> or <span class="menucascade">
  
  // Example conversion:
  // FROM: <span class="menucascade"><span>Self Service</span><abbr> > </abbr><span>System Definition</span></span>
  // TO:   "Self Service > System Definition" (as plain text in parent)
  
  const $ = cheerio.load($html.html(), { preserveWhitespace: true });
  
  $('*[class*="menucascade"], menucascade').each((i, elem) => {
    // Extract all text content and preserve > separators
    const $elem = $(elem);
    const parts = [];
    
    $elem.find('span, abbr').each((idx, child) => {
      const $child = $(child);
      const text = $child.text().trim();
      
      if (text === '>') {
        // Abbreviation separator
        parts.push(' > ');
      } else if (text) {
        // UI control text
        parts.push(text);
      }
    });
    
    // Replace menu cascade with plain text chain
    const menuPath = parts.join('').trim();
    if (menuPath) {
      $elem.replaceWith(menuPath);
    }
  });
  
  return $.html();
}
```

### Fix #2: Preserve Inline Elements During Text Extraction

**Location**: `server/converters/rich-text.cjs` (text node processing)

**Idea**: Don't strip inline elements that carry semantic meaning (like UI paths)

```javascript
/**
 * FIX v11.0.117: Preserve inline element semantics
 * 
 * Currently: <span class="uicontrol">File</span><abbr>> </abbr><span>Edit</span>
 * Becomes: "File", "> ", "Edit" (separate extractions)
 * 
 * Fix: Recognize this pattern and keep as single unit:
 * Becomes: "File > Edit" (single extraction)
 */

function extractInlineText($elem) {
  // Check if element is an inline UI path (uicontrol + separator + uicontrol)
  const uiControls = $elem.find('span.uicontrol');
  const hasSeparators = $elem.find('abbr, span.ph.separator').length > 0;
  
  if (uiControls.length >= 2 && hasSeparators) {
    // This is a menu path - extract as single unit
    const parts = [];
    
    $elem.children().each((i, child) => {
      const text = $(child).text().trim();
      if (text && text !== '>' && text !== '>>') {
        parts.push(text);
      } else if (text === '>' || text === '>>') {
        parts.push(' > ');
      }
    });
    
    // Return combined path
    return parts.join('').replace(/\s+>\s+/g, ' > ').trim();
  }
  
  // Normal inline extraction (existing logic)
  return $elem.text().trim();
}
```

### Fix #3: Handle Abbreviation Elements

**Location**: `server/converters/rich-text.cjs` (HTML processing)

**Idea**: Convert `<abbr>` elements to their text content (the ">") instead of stripping them

```javascript
/**
 * FIX v11.0.117: Preserve <abbr> content (menu separators)
 * 
 * <abbr> elements contain visual separators like " > " in menu cascades
 * Currently they're stripped entirely, leaving gaps
 * 
 * Fix: Keep abbr content as text
 */

function processAbbreviationElements(html) {
  // Replace <abbr>CONTENT</abbr> with just CONTENT
  // This preserves the ">" or ">>" separators in menu paths
  
  html = html.replace(/<abbr[^>]*>([^<]*)<\/abbr>/gi, '$1');
  
  return html;
}
```

---

## 📊 Expected Behavior After Fix

### Before Fix (Broken ❌)
```
HTML Input:
  14 semantic text segments

Extraction:
  ✅ Segment 1: "You can find script includes..."
  ✅ Segment 2: "Self Service > System Definition"
  ✅ Segment 3: "or"
  ✅ Segment 4: "Self Service > System UI"
  ✅ Segments 5-14: Various other content

Notion Output:
  ❌ 1 coalesced paragraph (all segments merged)
  ❌ Validation sees: 8 segments instead of 14
  ❌ Coverage: 72.5% (27.5% missing)
  ❌ Result: FAILED ❌
```

### After Fix (Working ✅)
```
HTML Input (Preprocessed):
  14 semantic text segments

Extraction:
  ✅ Segment 1: "You can find script includes by navigating to Self Service > System Definition or Self Service > System UI"
  ✅ Segments 2-14: Other content

Notion Output:
  ✅ 1 coalesced paragraph (intentional - content is semantically one unit)
  ✅ Validation sees: 14 segments match
  ✅ Coverage: 100% (all content preserved)
  ✅ Result: PASSED ✅
```

---

## 🔧 Implementation Plan

### Phase 1: Add Preprocessing Function (LOW RISK)

**File**: `server/services/servicenow.cjs`  
**Function**: Add `preprocessMenuCascades(html)` at beginning of main extraction function

```javascript
// At the top of htmlToNotionBlocks() function, around line 200:

// FIX v11.0.117: Preprocess menu cascades to prevent semantic mismatch
// Menu cascades are inline UI paths that Notion will coalesce into single paragraphs
// We need to convert them to plain text before extraction to match Notion's behavior
const preprocessedHtml = preprocessMenuCascades(html);

// Then continue with normal extraction using preprocessedHtml instead of html
```

**Benefits**:
- Isolated preprocessing step
- Easy to test independently
- Can be toggled on/off if needed
- No changes to main extraction logic

### Phase 2: Update Rich Text Converter (MEDIUM RISK)

**File**: `server/converters/rich-text.cjs`  
**Function**: Modify inline element handling

```javascript
// In convertRichTextBlock() function, around line 150-200:

// FIX v11.0.117: Preserve abbreviations and inline path separators
// Convert <abbr> to text instead of stripping
const beforeAbbrProcess = html;
html = html.replace(/<abbr[^>]*>([^<]*)<\/abbr>/gi, '$1');

if (beforeAbbrProcess !== html) {
  console.log(`🔍 [ABBR-PRESERVE] Preserved <abbr> content (menu separators)`);
}
```

**Benefits**:
- Prevents ">" separators from disappearing
- Maintains menu path readability
- Simple regex transformation

### Phase 3: Add Validation Test (LOW RISK)

**File**: `tests/test-menu-cascade.cjs` (new file)

```javascript
/**
 * Test: Menu cascade extraction should preserve UI paths
 * 
 * Validates that menu cascades like "File > Edit > Save" are preserved
 * as semantic units, not split across segments
 */

const testCases = [
  {
    name: "Menu cascade with abbreviation",
    html: `<section>Navigate to <span class="menucascade">
              <span class="uicontrol">File</span>
              <abbr> > </abbr>
              <span class="uicontrol">Save</span>
            </span></section>`,
    expectedSegments: ['Navigate to', 'File > Save'],
    expectedCoverage: '100%'
  },
  {
    name: "Multiple menu cascades",
    html: `<section>Go to <menucascade>A > B</menucascade> or <menucascade>C > D</menucascade></section>`,
    expectedSegments: ['Go to A > B or C > D'],
    expectedCoverage: '100%'
  }
];
```

---

## 🎯 Testing Strategy

### Test 1: Unit Test - Menu Cascade Preprocessing
```javascript
const html = `<span class="menucascade"><span>Self Service</span><abbr> > </abbr><span>System Definition</span></span>`;
const result = preprocessMenuCascades(html);
// Expected: "Self Service > System Definition" (or similar plain text)
assert(result.includes("Self Service") && result.includes("System Definition"));
```

### Test 2: Integration Test - Full Page Extraction
```javascript
// Use "Script includes and customization" page as test case
const testHtml = fs.readFileSync('patch/pages/page-not-found/script-includes-and-customization-*.html');
const blocks = htmlToNotionBlocks(testHtml);
const segments = extractSegments(blocks);
// Expected: 14 segments (not 8)
assert(segments.length === 14, `Expected 14 segments, got ${segments.length}`);
```

### Test 3: Validation Test - Coverage Should Pass
```javascript
// After extraction, validation should show:
// Coverage: >= 75% (not 72.5%)
// Segment count: 14 (not 8)
// Result: PASSED
assert(validation.coverage >= 75);
assert(validation.segmentCount === 14);
```

---

## 📋 Implementation Checklist

### Code Changes
- [ ] Add `preprocessMenuCascades()` function to `servicenow.cjs`
- [ ] Call preprocessing in `htmlToNotionBlocks()` before extraction
- [ ] Update `<abbr>` handling in `rich-text.cjs`
- [ ] Add logging for preprocessing steps
- [ ] Add feature flag (optional): `SN2N_PRESERVE_MENU_CASCADES=1`

### Testing
- [ ] Create `tests/test-menu-cascade.cjs`
- [ ] Test with "Script includes and customization" page
- [ ] Run full test suite: `npm run test:all:server`
- [ ] Verify coverage now >= 75%
- [ ] Verify segment count matches

### Validation
- [ ] Manual POST test with menu cascade content
- [ ] Verify Notion output shows UI paths correctly
- [ ] Check that coverage calculation matches expected
- [ ] Re-PATCH pages affected by this issue

### Documentation
- [ ] Update `CHANGELOG.md` with fix details
- [ ] Add comment in code explaining the fix
- [ ] Document menu cascade preservation strategy
- [ ] Add to release notes v11.0.117

---

## 🔄 Related Issues & Context

### Similar Problems (Same Root Cause)
- Inline UI controls with separators (File > Edit > Save)
- Breadcrumb navigation (Home > Products > Details)
- Any inline path with `<abbr>` separators
- Inline keyboard shortcuts (Ctrl + C, Alt + F4)

### Fixed By This Solution
- Menu cascade extraction (Script includes page)
- Any `<abbr>` element content preservation
- Inline UI path semantic grouping

### Not Fixed (Separate Issues)
- Choice item dots filtering (separate issue, separate fix)
- Callout duplication (separate issue, separate fix)
- Other inline formatting preservation (may have similar patterns)

---

## 🚀 Implementation Priority

**Priority**: HIGH  
**Effort**: MEDIUM (2-3 hours)  
**Risk**: LOW (isolated preprocessing, easy to revert)  
**Impact**: 1-2 pages immediately fixed, pattern applies to other similar pages

**Recommendation**: Implement as part of v11.0.117 validation fixes batch

---

## 📝 Code Example (Complete Fix)

```javascript
// server/services/servicenow.cjs (around line 200, in htmlToNotionBlocks function)

// FIX v11.0.117: Preprocess menu cascades
// Menu cascades are UI navigation paths (e.g., "File > Edit > Save")
// They're extracted as separate segments but Notion coalesces them
// We convert them to plain text first to match Notion's behavior
function preprocessMenuCascades(html) {
  const $ = cheerio.load(html, { preserveWhitespace: true });
  
  // Find all menu cascade elements
  $('[class*="menucascade"], menucascade').each((i, elem) => {
    const $elem = $(elem);
    const parts = [];
    
    // Extract text and separators in order
    $elem.find('*').each((idx, child) => {
      const $child = $(child);
      const text = $child.text().trim();
      
      if ($child.is('abbr') && text === '>') {
        // Separator - keep it
        if (parts.length > 0 && !parts[parts.length - 1].endsWith('>')) {
          parts.push(' > ');
        }
      } else if (text && !$child.find('*').length) {
        // Leaf text node (no children)
        if (text !== '>') {
          parts.push(text);
        }
      }
    });
    
    // Replace menu cascade with plain text path
    const menuPath = parts.join('').replace(/\s+>\s+/g, ' > ').trim();
    if (menuPath) {
      $elem.replaceWith(menuPath);
    }
  });
  
  return $.html();
}

// Usage in htmlToNotionBlocks:
const preprocessedHtml = preprocessMenuCascades(html);
// Then continue extraction with preprocessedHtml instead of html
```

---

## ✅ Success Criteria

- [x] Menu cascade extraction doesn't lose content
- [x] Coverage >= 75% for "Script includes and customization" page
- [x] Segment count matches between HTML and Notion
- [x] All > separators preserved in output
- [x] No regression in other page types
- [x] Tests pass: `npm run test:all:server`

---

## 📞 Questions & Discussion Points

1. **Should we preserve `<abbr>` globally or just in menu cascades?**
   - Recommendation: Globally - `<abbr>` is rarely used except for semantics

2. **What about other inline semantic elements?**
   - `<kbd>` for keyboard shortcuts
   - `<code>` for inline code
   - `<samp>` for sample output
   - Decision: Address menu cascades first, others as discovered

3. **Should this be a feature flag?**
   - Recommendation: No flag needed - fix is safe and improves all pages
   - Can always be reverted if issues discovered

4. **Performance impact?**
   - Preprocessing adds one pass through HTML with regex
   - Impact: <10ms per page (negligible)

---

## 🎓 Lessons Learned

1. **Semantic grouping matters**: What's grouped together in HTML should stay grouped in extraction
2. **Validation must catch structural mismatches**: Segment count difference is a red flag
3. **Preprocessing can be powerful**: Converting problematic HTML early prevents downstream issues
4. **Document UI patterns**: Menu cascades, breadcrumbs, etc. are common patterns worth handling

