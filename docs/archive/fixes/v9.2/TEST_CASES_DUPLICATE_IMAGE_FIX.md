# Test Cases: Duplicate Image Fix

## Test Case 1: Paragraph with Embedded Figure
**HTML Input:**
```html
<div class="p">
  <p>
    Figure 1. Methods of sourcing requested items
    <figure class="fig fignone">
      <img src="https://example.com/image.png" alt="Sourcing methods" />
      <figcaption><span class="fig--title-label">Figure 1. </span>Methods of sourcing requested items</figcaption>
    </figure>
  </p>
</div>
```

**Expected Notion Output:**
- 1 paragraph block with text: "Figure 1. Methods of sourcing requested items"
- 1 image block with caption: "Figure 1. Methods of sourcing requested items"
- ✅ Total: 2 blocks (NOT 3, which would indicate duplication)

**Actual Behavior (Before Fix):**
- 1 paragraph block
- 2 image blocks (DUPLICATE) ❌

**Actual Behavior (After Fix):**
- 1 paragraph block
- 1 image block ✅

---

## Test Case 2: Paragraph with Multiple Figures
**HTML Input:**
```html
<div class="p">
  <p>
    Here's the first figure:
    <figure class="fig fignone">
      <img src="https://example.com/image1.png" alt="Image 1" />
      <figcaption>Figure 1</figcaption>
    </figure>
    And here's the second:
    <figure class="fig fignone">
      <img src="https://example.com/image2.png" alt="Image 2" />
      <figcaption>Figure 2</figcaption>
    </figure>
  </p>
</div>
```

**Expected Notion Output:**
- 1 paragraph block with text
- 2 image blocks (one for each figure)
- ✅ Total: 3 blocks

**Actual Behavior (Before Fix):**
- 1 paragraph block
- 4 image blocks (2 duplicates) ❌

**Actual Behavior (After Fix):**
- 1 paragraph block
- 2 image blocks ✅

---

## Test Case 3: Paragraph with Figure and List
**HTML Input:**
```html
<div class="p">
  <p>
    See below:
    <figure class="fig fignone">
      <img src="https://example.com/diagram.png" alt="Diagram" />
      <figcaption>Process Diagram</figcaption>
    </figure>
    Steps to follow:
    <ul>
      <li>Step 1</li>
      <li>Step 2</li>
    </ul>
  </p>
</div>
```

**Expected Notion Output:**
- 1 paragraph block with initial text
- 1 image block with caption
- 1 paragraph block with "Steps to follow:"
- 2 bulleted list item blocks
- ✅ Total: 5 blocks

**Actual Behavior (Before Fix):**
- 1 paragraph block
- 2 image blocks (DUPLICATE) ❌
- 1 paragraph block
- 2 list items

**Actual Behavior (After Fix):**
- 1 paragraph block
- 1 image block ✅
- 1 paragraph block
- 2 list items

---

## Test Case 4: Standalone Figure (Not in Paragraph)
**HTML Input:**
```html
<figure class="fig fignone">
  <img src="https://example.com/standalone.png" alt="Standalone" />
  <figcaption>Figure A</figcaption>
</figure>
```

**Expected Notion Output:**
- 1 image block with caption: "Figure A"
- ✅ Total: 1 block (no change from previous behavior)

**Note:** This case should work the same before and after the fix since figures not in mixed content are processed directly.

---

## Validation Checklist
Use these steps to validate the fix:

1. **Extract a ServiceNow documentation page with figures**
   - Note the number of figures on the original page
   
2. **Convert to Notion using the fixed version**
   - Check the Notion page for the converted content
   
3. **Count images**
   - Each figure should appear as **exactly one image** on the Notion page
   - ✅ If count matches: Fix is working
   - ❌ If count is doubled: Issue persists

4. **Check captions**
   - Each image should have the correct caption from the original figcaption
   - Captions should not be duplicated

5. **Verify mixed content**
   - Text before/after figures should be preserved
   - No extra paragraph blocks should be created

---

## Debug Logging
When testing, look for these debug messages in the server console:

**Before the fix (problematic):**
```
🔍 Text after removing nested blocks
🖼️ Using external image URL: ...  ← First image from parseRichText
... (nested block processing)
🖼️ Using external image URL: ...  ← Second image from processElement
✅ Created image block with caption  ← Same image, created twice
```

**After the fix (correct):**
```
🔍 Text after removing nested blocks
(No image creation during parseRichText - figure was completely removed)
... (nested block processing)
🖼️ Using external image URL: ...  ← Only image from processElement
✅ Created image block with caption  ← Created exactly once
```

---

## Edge Cases to Monitor

### Edge Case 1: Figure with Complex HTML
Ensure figures with additional markup still work:
```html
<figure class="fig fignone">
  <img src="..." />
  <figcaption>
    <span class="fig--title-label">Figure 1.</span>
    <strong>Bold</strong> caption text
  </figcaption>
</figure>
```
✅ Expected: One image with rich-text caption

### Edge Case 2: Nested Figures in Lists
```html
<ul>
  <li>
    Item with figure:
    <figure><img src="..." /><figcaption>Fig</figcaption></figure>
  </li>
</ul>
```
✅ Expected: One list item with one image child block

### Edge Case 3: Empty Figures
```html
<figure class="fig fignone">
  <img src="invalid-url" />
</figure>
```
✅ Expected: No image block created (invalid URL)

---

## Performance Impact
- **Build Time:** No impact (same parsing logic, just different HTML extraction method)
- **Conversion Speed:** Negligible (one string method call vs another)
- **Output Size:** Reduced (fewer duplicate blocks)

---

## Rollback Plan
If issues arise:
1. Revert line 1463 of `server/services/servicenow.cjs`
2. Change `block.outerHTML` back to `$.html(block)`
3. Run `npm run build`
4. Restart server: `npm start`
