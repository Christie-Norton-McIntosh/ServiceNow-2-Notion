# 📋 Notion Database Properties for Validation

## Required Properties

Add these two properties to your Notion database to enable validation result capture:

### 1. Error (Checkbox)
```
Property Name: Error
Property Type: Checkbox
Purpose: Automatically checked when validation finds critical errors
```

**Visual Example:**
```
┌─────────┬────────────────────┬───────┐
│ Name    │ URL               │ Error │
├─────────┼────────────────────┼───────┤
│ Page 1  │ https://...       │ ☐     │  ← Validation passed
│ Page 2  │ https://...       │ ☑     │  ← Validation failed
│ Page 3  │ https://...       │ ☐     │  ← Validation passed
└─────────┴────────────────────┴───────┘
```

### 2. Validation (Text or Rich Text)
```
Property Name: Validation
Property Type: Text (or Rich Text for better formatting)
Purpose: Stores detailed validation results, stats, and error messages
```

**Visual Example:**
```
┌──────────┬────────────────────────────────────────────┐
│ Name     │ Validation                                  │
├──────────┼────────────────────────────────────────────┤
│ Page 1   │ ✅ Validation passed: 45 blocks,           │
│          │ 3 headings, no issues                      │
│          │                                            │
│          │ Stats: {"totalBlocks": 45, ...}            │
├──────────┼────────────────────────────────────────────┤
│ Page 2   │ ❌ Validation failed: 1 error(s)           │
│          │                                            │
│          │ Errors:                                    │
│          │ 1. Marker leak: 3 visible tokens           │
│          │                                            │
│          │ Stats: {"totalBlocks": 38, ...}            │
├──────────┼────────────────────────────────────────────┤
│ Page 3   │ ⚠️ Validation passed with warnings         │
│          │                                            │
│          │ Warnings:                                  │
│          │ 1. Block count high: expected 50, got 65   │
└──────────┴────────────────────────────────────────────┘
```

## How to Add Properties in Notion

### Step-by-Step Instructions

#### Adding Error Checkbox:
1. Open your Notion database
2. Click the `+` button to add a new property (or click on an existing column header)
3. Name it: `Error` (case-sensitive)
4. Select type: `Checkbox`
5. Click outside to save

#### Adding Validation Text:
1. Click the `+` button to add another property
2. Name it: `Validation` (case-sensitive)
3. Select type: `Text` (or `Rich text` for formatting)
4. Click outside to save

### Screenshot Walkthrough (Text Description)

```
Step 1: Click the "+" button at the right of your database columns
        ┌────┬────┬────┬────┬───┐
        │Name│URL │...│... │ + │ ← Click here
        └────┴────┴────┴────┴───┘

Step 2: Type property name "Error"
        ┌─────────────────┐
        │ Error           │ ← Type name
        │ ┌─────────────┐ │
        │ │ Checkbox  ▾ │ │ ← Select type
        │ └─────────────┘ │
        └─────────────────┘

Step 3: Repeat for "Validation" property
        ┌─────────────────┐
        │ Validation      │ ← Type name
        │ ┌─────────────┐ │
        │ │ Text      ▾ │ │ ← Select type
        │ └─────────────┘ │
        └─────────────────┘

Step 4: Your database now has both properties
        ┌────┬────┬───────┬────────────┐
        │Name│URL │ Error │ Validation │
        ├────┼────┼───────┼────────────┤
        │... │... │   ☐   │            │
        └────┴────┴───────┴────────────┘
```

## Database View Configuration

### Creating a "Needs Review" Filter

To quickly find pages with validation errors:

1. **Create a new view** (e.g., "Validation Errors")
2. **Add filter**: `Error` is `Checked`
3. **Sort by**: Created time (descending)

This view will show only pages that failed validation, making it easy to review and fix issues.

### Example Database Schema

Here's a complete example showing all recommended properties:

```
┌──────────────┬──────────────┬───────┬─────────────┬────────────────────────┐
│ Name         │ URL          │ Error │ Has Videos  │ Validation             │
│ (Title)      │ (URL)        │ (☑)   │ (☑)         │ (Text)                 │
├──────────────┼──────────────┼───────┼─────────────┼────────────────────────┤
│ Software     │ https://...  │ ☐     │ ☐           │ ✅ Validation passed:  │
│ Quality      │              │       │             │ 45 blocks, no issues   │
├──────────────┼──────────────┼───────┼─────────────┼────────────────────────┤
│ Contract     │ https://...  │ ☑     │ ☐           │ ❌ Validation failed:  │
│ Management   │              │       │             │ Marker leak detected   │
├──────────────┼──────────────┼───────┼─────────────┼────────────────────────┤
│ User Guide   │ https://...  │ ☐     │ ☑           │ ⚠️ Passed with         │
│              │              │       │             │ warnings: Block count  │
│              │              │       │             │ higher than expected   │
└──────────────┴──────────────┴───────┴─────────────┴────────────────────────┘
```

## Property Usage Examples

### Filtering for Issues
- **All errors**: Filter `Error` = Checked
- **Specific error type**: Filter `Validation` contains "Marker leak"
- **Recent failures**: Filter `Error` = Checked AND `Created time` = Past week

### Sorting by Quality
- **Sort by Error** (checked first) → Shows problem pages at top
- **Sort by Validation** (ascending) → Groups similar validation results

### Dashboard Views
Create multiple views for different purposes:
- **📊 All Pages**: Default view, all records
- **❌ Validation Errors**: Filter by `Error` = Checked
- **⚠️ Warnings**: Filter `Validation` contains "warning"
- **✅ Clean Pages**: Filter by `Error` = Unchecked

## Validation Result Formats

### Format 1: Success
```
✅ Validation passed: 45 blocks, 3 headings, no issues

Stats: {
  "totalBlocks": 45,
  "blockTypes": {
    "paragraph": 20,
    "numbered_list_item": 10,
    "heading_2": 3,
    "callout": 5,
    "image": 7
  },
  "headingCount": 3,
  "fetchTimeMs": 1234
}
```

### Format 2: Errors
```
❌ Validation failed: 2 error(s)

Errors:
1. Marker leak: 3 visible sn2n:marker token(s) found
2. Block count too low: expected at least 30, got 15

Stats: {
  "totalBlocks": 15,
  "blockTypes": {...},
  "headingCount": 1,
  "fetchTimeMs": 890
}
```

### Format 3: Warnings
```
⚠️ Validation passed with warnings: 2 warning(s)

Warnings:
1. Block count high: expected at most 50, got 65
2. Missing expected headings: Prerequisites

Stats: {
  "totalBlocks": 65,
  "blockTypes": {...},
  "headingCount": 2,
  "fetchTimeMs": 1456
}
```

## Property Name Requirements

⚠️ **IMPORTANT**: Property names are case-sensitive!

- ✅ Correct: `Error` (capital E)
- ❌ Wrong: `error`, `ERROR`, `Errors`

- ✅ Correct: `Validation` (capital V)
- ❌ Wrong: `validation`, `VALIDATION`, `Validations`

The validation utility looks for these exact names when updating properties.

## Troubleshooting

### Property not being updated?
1. **Check spelling**: Property names must be exactly `Error` and `Validation`
2. **Check type**: Error must be Checkbox, Validation must be Text or Rich Text
3. **Check permissions**: Notion integration must have write access to the database
4. **Check logs**: Look for "Failed to update properties" in server logs

### Property appears in wrong format?
- Rich Text vs Text: Both work, Rich Text preserves line breaks better
- If using Rich Text, validation summary will look cleaner with proper formatting

### Can I rename the properties?
Yes, but you'll need to update the code in `server/routes/w2n.cjs`:

```javascript
// Change property names here (around line 720-730)
propertyUpdates["Error"] = { checkbox: true };  // Change "Error" to your name
propertyUpdates["Validation"] = { ... };        // Change "Validation" to your name
```

## Next Steps

1. ✅ Add both properties to your database
2. ✅ Enable validation: `SN2N_VALIDATE_OUTPUT=1` in `.env`
3. ✅ Restart server
4. ✅ Export a test page
5. ✅ Check properties are populated
6. ✅ Create filtered views for easy issue tracking
