# Icon Filtering for Image Checkbox - v11.0.111

## Issue
The "Image" checkbox property was being activated for pages containing only small UI icons (e.g., 16x16, 24x24, 32x32 pixel icons), not just significant content images.

## Solution
Added dimension-based filtering to skip small icons (< 64x64 pixels) when:
1. Creating image blocks from HTML
2. Counting images for the Image checkbox property

## Implementation

### 1. Standalone Images in servicenow.cjs
**File**: `server/services/servicenow.cjs`

#### Figure Elements (line ~2194)
```javascript
// Check image dimensions to filter out small icons
const width = parseInt($img.attr('width')) || 0;
const height = parseInt($img.attr('height')) || 0;
const isIcon = (width > 0 && width < 64) || (height > 0 && height < 64);

if (isIcon) {
  console.log(`🚫 Skipping small icon image (${width}x${height}): ${src}`);
  return processedBlocks; // Skip icons
}
```

#### Standalone `<img>` Tags (line ~2316)
```javascript
// Check image dimensions to filter out small icons
const width = parseInt($elem.attr('width')) || 0;
const height = parseInt($elem.attr('height')) || 0;
const isIcon = (width > 0 && width < 64) || (height > 0 && height < 64);

if (isIcon) {
  console.log(`🚫 Skipping small icon image (${width}x${height})`);
  return []; // Skip icons
}
```

### 2. Images in Tables (table.cjs)
**File**: `server/converters/table.cjs`

#### Figure Elements in Tables (line ~200)
```javascript
// Check image dimensions to filter out small icons
const widthMatch = /width=["']?(\d+)/i.exec(imgMatch[0]);
const heightMatch = /height=["']?(\d+)/i.exec(imgMatch[0]);
const width = widthMatch ? parseInt(widthMatch[1]) : 0;
const height = heightMatch ? parseInt(heightMatch[1]) : 0;
const isIcon = (width > 0 && width < 64) || (height > 0 && height < 64);

if (isIcon) {
  console.log(`🚫 [TABLE] Skipping small icon image (${width}x${height}): ${src}`);
  continue; // Skip icons in tables
}
```

#### Note on Icon-to-Emoji Conversion
Table cells already have sophisticated icon-to-emoji conversion for small icons (≤32px):
- ✅ YES/CHECK icons
- ❌ NO/ERROR icons
- ⚠️ WARNING icons
- ℹ️ INFO icons
- 💡 TIP icons
- And 20+ other icon types

These converted icons don't create image blocks, so they're automatically excluded from image counting.

## Icon Size Thresholds

### Skip Threshold: < 64x64 pixels
- Icons smaller than 64x64 are skipped completely
- No image block created
- Not counted for Image checkbox
- Logged as: `🚫 Skipping small icon image (WxH)`

### Emoji Conversion (Tables Only): ≤ 32x32 pixels
- Icons ≤32x32 in tables are converted to emojis
- No image block created
- Not counted for Image checkbox
- Logged as: `✨ Detected [TYPE] icon → replacing with [emoji]`

### Significant Images: ≥ 64x64 pixels
- Images 64x64 or larger are considered content images
- Image block created and uploaded to Notion
- Counted for Image checkbox
- Checkbox activated if count > 0

## How It Works

1. **HTML Parsing**: When processing img tags, dimensions are extracted from `width` and `height` attributes
2. **Icon Detection**: If width < 64 OR height < 64, it's classified as an icon
3. **Skip Block Creation**: Icons return early without creating image blocks
4. **No Counting**: Since no image blocks are created, icons don't affect the sourceCounts.images counter
5. **Checkbox Logic**: Image checkbox only activated when sourceCounts.images > 0 (i.e., actual content images exist)

## Edge Cases Handled

### Icons Without Dimensions
- If width/height attributes are missing (0), image is NOT classified as icon
- Treated as potential content image and processed normally
- Reasoning: Better to include a few icons than skip actual content images

### Icons in Different Contexts
- ✅ Standalone figure elements
- ✅ Standalone img tags
- ✅ Images in table cells
- ✅ Images in callouts (processed via table converter)
- ✅ Images in list items (handled by rich text parser)

### Already Handled by Table Converter
- Small icons ≤32px in tables → Emoji conversion (existing logic)
- These never create image blocks anyway
- New 64px threshold provides additional safety net

## Testing

### Pages That Should NOT Activate Image Checkbox
- Pages with only UI icons (16x16, 24x24, 32x32)
- Pages with status indicators (checkmarks, x marks)
- Pages with small decorative icons

### Pages That SHOULD Activate Image Checkbox
- Pages with screenshots
- Pages with diagrams
- Pages with actual content images (≥64x64)

### Verification
Check console logs for:
- `🚫 Skipping small icon image (WxH)` - Icons properly filtered
- `🖼️ Processing standalone <img>: ... size=WxH` - Dimensions detected
- `🖼️ Setting Image checkbox (N images detected)` - Only for content images

## Impact
- ✅ Reduces false positives for Image checkbox
- ✅ Keeps checkbox meaningful (only for actual content images)
- ✅ Maintains backward compatibility (no breaking changes)
- ✅ Clear logging for debugging

## Known Limitations
- Requires width/height attributes in HTML
- If dimensions missing, treats as potential content image (safe default)
- Cannot detect icon size from URL or file content (would require downloading)

## Version
- **Applied in**: v11.0.111
- **Files Modified**: 
  - `server/services/servicenow.cjs` (2 locations)
  - `server/converters/table.cjs` (1 location)
- **Status**: ✅ Deployed and server restarted
