# Testing Guide for Table Image Extraction

## Quick Test Checklist

Use this checklist when testing the table image extraction feature on ServiceNow documentation pages.

### Before Sending to Notion

1. **Open Browser Console** (F12 → Console tab)
2. **Navigate to a ServiceNow page with tables containing images**
3. **Click "Save Current Page" button**

### What to Look For

#### Browser Console Output

✅ **Good signs**:
```
📊 Total images/svgs replaced in tables: 0
⚠️ No images or svgs found in tables to replace
```

❌ **Bad signs**:
```
📊 Total images/svgs replaced in tables: 3  ← Images are being removed!
✅ Replaced 3 img tags with bullets  ← This shouldn't happen
```

#### Server Terminal Output

✅ **Expected logs for each table with images**:
```
🔍 Converting table, HTML length: 5860
[table conversion output]
📸 Found 1 figure elements in table
✅ Added image block with caption: "Figure 1. Normal change state model"
```

✅ **Block count increases**:
```
🔍 Total blocks after processing: 10  ← Was 7 before adding 3 images
✅ servicenowService returned 10 blocks
```

#### Notion Page Results

✅ **In the table cells**:
- Should show: `See "Figure 1. Normal change state model"`
- Should NOT show: `•` (bullets) or blank cells

✅ **After each table**:
- Image blocks should appear
- Images should load correctly
- Captions should match the placeholder text in the table

✅ **Indentation**:
- Images should be at the same level as the table
- NOT indented underneath

## Test Pages

### Known Good Pages

1. **State progression for normal, standard, and emergency changes**
   - URL: `.../change-management/concept/normal-standard-emergency-states.html`
   - Contains: 3 tables, 3 images (one per table)
   - Expected blocks: 10 (1 paragraph + 3 table headings + 3 tables + 3 images)

### Pages to Test

Add any pages you test here with results:

- [ ] Page URL: _______________
  - Tables: ___
  - Images: ___
  - Result: ✅ Pass / ❌ Fail
  - Notes: _______________

## Troubleshooting

### Images Still Showing as Bullets

**Symptom**: Table cells show `•` instead of `See "Figure N"`

**Solution**:
1. Rebuild userscript: `npm run build`
2. Reload Tampermonkey script
3. Hard refresh ServiceNow page (Cmd+Shift+R / Ctrl+Shift+F5)

### Images Not Extracting

**Symptom**: Placeholder text appears but no image blocks created

**Check**:
1. Server logs - look for "📸 Found N figure elements"
2. If found but not extracted, check URL validation logs
3. Verify images are in `<figure><img><figcaption>` structure

### Wrong Image Captions

**Symptom**: Caption doesn't match what's in ServiceNow

**Cause**: Likely HTML structure difference

**Debug**:
1. Check server logs for caption extraction
2. Look at HTML source of ServiceNow page
3. May need to adjust caption extraction regex

### Server Not Restarting

**Symptom**: Changes to servicenow.cjs not reflected

**Solution**:
```bash
# Kill existing server
pkill -f "node.*sn2n-proxy"

# Start fresh
npm start
```

## Success Criteria

A successful test should have:

- ✅ All images preserved from ServiceNow
- ✅ Placeholder text in table cells matching image captions
- ✅ Image blocks created after each table
- ✅ Images load correctly in Notion
- ✅ Proper nesting level (same as table)
- ✅ No duplicate or missing images

## Reporting Issues

When reporting issues, include:

1. **ServiceNow page URL**
2. **Browser console output** (copy relevant logs)
3. **Server terminal output** (copy relevant logs)
4. **Screenshot of Notion result**
5. **Expected vs actual behavior**
6. **HTML structure** (view source around the problematic table/image)

## Version Compatibility

This feature requires:
- Userscript v9.1.0 or later
- Server code from 2025-10-17 or later
- Both userscript and server must be up to date
