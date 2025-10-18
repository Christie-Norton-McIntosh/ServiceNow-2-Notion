# Table Image Extraction Feature

## Overview

ServiceNow documentation pages often contain tables with images (diagrams, flowcharts, state models) embedded within table cells. Since Notion's table cells cannot contain images, this feature extracts images from table cells and places them as separate image blocks immediately after each table, with placeholder text in the cells referencing the extracted images.

## Implementation

### How It Works

1. **Image Preservation** (Userscript)
   - Images in tables are no longer replaced with bullet symbols
   - Full `<figure>` elements with `<img>` and `<figcaption>` are preserved in the HTML sent to the server

2. **Placeholder Replacement** (Server)
   - Before table conversion, all `<figure>` elements in table HTML are replaced with placeholder text
   - Placeholder format: `See "Figure N. Caption text"` (matches the figcaption content)
   - This ensures table cells contain readable references to the images

3. **Image Extraction** (Server)
   - Original table HTML (with intact figures) is scanned for all `<figure>` elements
   - For each figure:
     * Extract `<img src="">` URL
     * Extract `<figcaption>` text for caption
     * Convert ServiceNow URLs to proper format
     * Create Notion image block with external URL and caption

4. **Block Ordering**
   - Table blocks are added to the page first
   - Image blocks are added immediately after their corresponding table
   - Images maintain the same nesting level as the table (not indented)

### Code Locations

#### Userscript Changes
**File**: `src/content/content-extractor.js`

- **Lines 192-225**: Commented out image replacement in iframe content
- **Lines 313-341**: Commented out image replacement in regular content
- **Lines 677-692**: Added `isInFigure` check in `cleanHtmlContent()` to skip images inside figures

```javascript
// DON'T replace img tags - let the server handle images in tables
// if (imgMatches) {
//   result = result.replace(/<img[^>]*>/gi, " • ");
//   replacedCount += imgCount;
//   debug(`✅ Replaced ${imgCount} img tags with bullets`);
// }
```

#### Server Changes
**File**: `server/services/servicenow.cjs`

- **Lines 31-34**: Module cache clearing for table converter (workaround for require cache issues)
- **Lines ~621-680**: Table handler with image extraction logic

**Key sections**:
1. Placeholder replacement (lines ~627-638)
2. Table conversion (line ~640)
3. Image extraction loop (lines ~647-672)

```javascript
// Replace figures in table HTML with placeholder text BEFORE conversion
const $table = $('<div>').html(tableHtml);
$table.find('figure').each((idx, fig) => {
  const $figure = $(fig);
  const $caption = $figure.find('figcaption').first();
  if ($caption.length > 0) {
    const caption = cleanHtmlText($caption.html());
    $figure.replaceWith(`<span class="image-placeholder">See "${caption}"</span>`);
  } else {
    $figure.replaceWith(`<span class="image-placeholder">See image below</span>`);
  }
});
```

## Example

### Input (ServiceNow HTML)
```html
<table>
  <tr>
    <td>State</td>
    <td rowspan="7">
      <figure>
        <figcaption>Figure 1. Normal change state model</figcaption>
        <img src="https://servicenow.../NormalChangeStateModel2.png" />
      </figure>
    </td>
  </tr>
  <tr><td>New</td></tr>
  <tr><td>Assess</td></tr>
</table>
```

### Output (Notion Blocks)

1. **Table heading** (from caption): "Normal change state progression"
2. **Table block**:
   ```
   | State  | Diagram                                   |
   |--------|-------------------------------------------|
   | New    | See "Figure 1. Normal change state model" |
   | Assess | See "Figure 1. Normal change state model" |
   ```
3. **Image block**: 
   - URL: `https://servicenow.../NormalChangeStateModel2.png`
   - Caption: "Figure 1. Normal change state model"

## Testing

### Test Pages

The feature has been tested with:
- ✅ State progression for normal, standard, and emergency changes
  - Contains 3 tables, each with 1 embedded image
  - All 3 images extracted successfully with proper captions
  - Placeholder text correctly shows in table cells

### Testing Checklist

When testing this feature on new ServiceNow pages:

- [ ] **Images preserved**: Browser console should show "Total images/svgs replaced in tables: 0"
- [ ] **Placeholder text**: Table cells should show `See "Figure N. Caption"` instead of bullets or blank cells
- [ ] **Images extracted**: Server logs should show `✅ Added image block with caption: "..."`
- [ ] **Block count**: Total blocks should increase (e.g., 7 blocks → 10 blocks for 3 images)
- [ ] **Correct nesting**: Images should be at same indentation level as tables
- [ ] **URL validity**: Images should load correctly in Notion
- [ ] **Caption accuracy**: Image captions should match the figcaption text from ServiceNow

### Debugging

If images are not appearing:

1. **Check browser console**:
   - Look for "📊 Total images/svgs replaced in tables: 0" (should be 0)
   - Verify HTML contains `<figure>` and `<img>` tags

2. **Check server logs**:
   - Look for "📸 Found N figure elements in table"
   - Look for "✅ Added image block with caption: ..."
   - If not found, images may not be in expected `<figure>` structure

3. **Check Notion page**:
   - Tables should have placeholder text like `See "Figure 1. ..."`
   - Images should appear immediately after each table
   - Images should not be nested/indented unless table was in a list

## Limitations

1. **Notion API Constraints**:
   - Table cells cannot contain images (Notion API limitation)
   - Images must be external URLs (cannot be uploaded files from table context)

2. **ServiceNow HTML Structure**:
   - Images must be wrapped in `<figure>` tags with `<figcaption>` for proper extraction
   - Standalone `<img>` tags in tables may not extract (would need separate handling)

3. **Placeholder Text**:
   - Currently uses simple text replacement
   - No hyperlinks from placeholder to image (Notion limitation - no cross-references)

## Future Improvements

Potential enhancements:

1. **Smart positioning**: Detect if image should go before or after table based on figure position
2. **Multiple images per cell**: Handle cells with multiple figures
3. **Inline image support**: Handle `<img>` tags not wrapped in `<figure>`
4. **Image numbering**: Auto-number images if no caption exists
5. **Image deduplication**: Skip duplicate images across multiple tables

## Version History

- **v9.1.0** (2025-10-17): Initial implementation of table image extraction
  - Images preserved in userscript
  - Placeholder text in table cells
  - Separate image blocks after tables
  - Caption extraction and URL conversion
