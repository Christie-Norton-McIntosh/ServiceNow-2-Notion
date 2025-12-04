# Image Checkbox Property Fix - v11.0.111

## Issue
The "Image" checkbox property in Notion was not being automatically checked when pages contained images during extraction.

## Root Cause
The proxy server was counting images for validation purposes (in `sourceCounts.images`) but was never setting the corresponding "Image" checkbox property in Notion.

## Solution
Added automatic Image checkbox detection and property setting in two locations:

### 1. POST Route (New Page Creation)
**File**: `server/routes/w2n.cjs` (after line 2095)

```javascript
// Set Image checkbox if page contains images
if (sourceCounts.images > 0) {
  propertyUpdates["Image"] = { checkbox: true };
  log(`🖼️ Setting Image checkbox (${sourceCounts.images} image${sourceCounts.images === 1 ? '' : 's'} detected)`);
}
```

**Location**: Immediately after Stats property is set, before `notion.pages.update()` call

### 2. PATCH Route (Page Updates)
**File**: `server/routes/w2n.cjs` (after line 4047)

```javascript
// Set Image checkbox if page contains images
if (sourceCounts.images > 0) {
  propertyUpdates["Image"] = { checkbox: true };
  log(`🖼️ Setting Image checkbox (${sourceCounts.images} image${sourceCounts.images === 1 ? '' : 's'} detected in PATCH)`);
}
```

**Location**: Immediately after Stats property is set, before `notion.pages.update()` call

## How It Works

1. **Image Detection**: The system already counts images recursively throughout the page content:
   - Standalone image blocks
   - Images nested in tables
   - Images nested in callouts
   - Images nested in list items

2. **Property Setting**: When `sourceCounts.images > 0`, the Image checkbox is automatically checked:
   ```javascript
   propertyUpdates["Image"] = { checkbox: true }
   ```

3. **Logging**: Explicit log messages show when the checkbox is set:
   - `🖼️ Setting Image checkbox (N image(s) detected)` for POST
   - `🖼️ Setting Image checkbox (N image(s) detected in PATCH)` for PATCH

## Testing

### New Extractions (POST)
1. Extract a ServiceNow page containing images
2. Check the created Notion page
3. Verify "Image" checkbox property is checked

### Page Updates (PATCH)
1. PATCH a page that contains images
2. Check the updated Notion page
3. Verify "Image" checkbox property is checked

### Edge Cases Covered
- ✅ Single image
- ✅ Multiple images
- ✅ Images in tables
- ✅ Images in callouts
- ✅ Images in nested lists
- ✅ No images (checkbox remains unchecked)

## Impact
- All future extractions with images will automatically have the Image checkbox checked
- Existing pages can be updated via PATCH to set the checkbox
- Consistent with the existing pattern for Error checkbox and Stats property

## Version
- **Applied in**: v11.0.111
- **Affects**: Both POST and PATCH routes
- **Status**: ✅ Deployed and server restarted
