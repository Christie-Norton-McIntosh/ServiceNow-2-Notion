# Notion Property Updates for Content Validation

This document describes how content validation results are automatically written to Notion page properties.

## Overview

When you run content validation with the `--update-notion` flag, the validation results are automatically written to the Notion page's properties:

1. **Validation** property: Detailed text summary of validation results
2. **Error** checkbox: Set to `true` if validation failed, `false` if passed

## Validation Property Format

The Validation property is updated with a timestamped summary:

```
[2025-11-26] Content Validation: ✅ PASS
Similarity: 98.5% | HTML: 12450 chars | Notion: 12478 chars (+0.2%)
All content present and in correct order.
```

### Failed Validation Example

```
[2025-11-26] Content Validation: ❌ FAIL
Similarity: 87.3% | HTML: 15200 chars | Notion: 13450 chars (-11.5%)
⚠️ Missing: 8 segments
⚠️ Order issues: 3 detected
```

## Usage Examples

### Single Page with Notion Update

```bash
node validate-content-order.cjs \
  page.html \
  2a8a89fedba5816d9940c30180a3bb16 \
  --update-notion
```

**Console Output:**
```
🔍 Content Validation Tool

HTML File: page.html
Notion Page: 2a8a89fedba5816d9940c30180a3bb16

📄 Reading HTML file...
📝 Extracting text from HTML...
   Found 145 text segments (138 after normalization)

🌐 Fetching Notion page content...
📝 Extracting text from Notion blocks...
   Found 142 text segments (138 after normalization)

📊 Analysis:

✓ Similarity Score: 98.5%
✓ HTML text length: 12450 characters
✓ Notion text length: 12478 characters
✓ Difference: +28 (+0.2%)

✓ All HTML content found in Notion
✓ No extra content in Notion
✓ Content order matches

================================================================================
📋 Summary:

✅ PASS - Content is complete and in correct order

📝 Updating Notion page properties...
✓ Updated Notion page Validation property
```

**Notion Page Properties After Update:**
- **Validation**: `[2025-11-26] Content Validation: ✅ PASS...`
- **Error**: `☐` (unchecked)

---

### Batch Validation with Notion Updates

```bash
node batch-validate-content.cjs \
  ../pages/updated-pages \
  --update-notion
```

**Console Output:**
```
🔍 Batch Content Validation

Directory: ../pages/updated-pages
📝 Update Notion: ENABLED (will update Validation properties)

Found 10 HTML files

================================================================================
📄 page1.html
================================================================================

Page ID: 2a8a89fe-dba5-8113-b958-f8a58c5e8b81

...validation results...

✅ PASS - Content is complete and in correct order

📝 Updating Notion page properties...
✓ Updated Notion page Validation property

================================================================================
📄 page2.html
================================================================================

...

📊 BATCH VALIDATION SUMMARY
================================================================================

Total files: 10
Validated: 10
Skipped: 0
Updated in Notion: 10

✅ Passed: 8
❌ Failed: 2
```

---

## Property Schema

### Validation Property

- **Type**: Rich Text
- **Content**: Multi-line summary with emoji indicators
- **Format**:
  ```
  [DATE] Content Validation: STATUS
  Similarity: X.X% | HTML: N chars | Notion: M chars (±X.X%)
  [Optional warnings for missing/extra/order issues]
  [Summary line]
  ```

### Error Checkbox

- **Type**: Checkbox
- **Value**: 
  - `false` (unchecked) = Validation passed
  - `true` (checked) = Validation failed

---

## Integration with Auto-Validation

The content validation updates work alongside the existing auto-validation system:

### Auto-Validation (Block Count)
- Runs during PATCH operations with `SN2N_VALIDATE_OUTPUT=1`
- Validates block count within ±30% tolerance
- Updates Validation property with block count results
- Sets Error checkbox on failures

### Content Validation (Text Order/Completeness)
- Runs separately via CLI tools
- Validates text content and ordering
- Updates Validation property with content results (when using `--update-notion`)
- Sets Error checkbox on failures

### Combined Workflow

```bash
# 1. PATCH with auto-validation (block count)
curl -X PATCH http://localhost:3004/api/W2N/page-id \
  -H "Content-Type: application/json" \
  -d '{"title":"...","contentHtml":"...","url":"..."}'

# Server auto-validates and updates:
# Validation: "[2025-11-26] Block count validation: ✅ PASS (85 expected, 87 actual)"
# Error: false

# 2. Run content validation and update
node validate-content-order.cjs page.html page-id --update-notion

# Appends to Validation property:
# Validation: "[2025-11-26] Block count validation: ✅ PASS...
#              [2025-11-26] Content Validation: ✅ PASS..."
# Error: false (both passed)
```

**Note**: If either validation fails, the Error checkbox is set to `true`.

---

## Validation Property Updates Over Time

The Validation property accumulates validation results over time, creating a history:

```
[2025-11-26] Content Validation: ✅ PASS
Similarity: 98.5% | HTML: 12450 chars | Notion: 12478 chars (+0.2%)
All content present and in correct order.
```

After re-PATCH and re-validation:

```
[2025-11-26] Content Validation: ✅ PASS
Similarity: 98.5% | HTML: 12450 chars | Notion: 12478 chars (+0.2%)
All content present and in correct order.
[2025-11-27] Content Validation: ✅ PASS
Similarity: 99.1% | HTML: 12680 chars | Notion: 12682 chars (+0.02%)
All content present and in correct order.
```

This provides an audit trail of validation attempts.

---

## Filtering Pages by Validation Status

In Notion, you can filter pages using the Error checkbox:

**Show only failed validations:**
- Filter: `Error` is `checked`

**Show only passed validations:**
- Filter: `Error` is `not checked`

**Show recent validations:**
- Sort by: `Last edited time` descending
- Filter: `Validation` contains `[2025-11-26]`

---

## Troubleshooting

### "Failed to update Notion validation property"

**Possible Causes:**
1. Invalid page ID format
2. Notion API token missing/expired
3. Page doesn't have Validation/Error properties
4. Rate limit exceeded

**Solutions:**
```bash
# Check Notion token is set
echo $NOTION_TOKEN

# Verify page ID format (32 hex chars)
# Valid: 2a8a89fedba5816d9940c30180a3bb16
# Valid: 2a8a89fe-dba5-8113-b958-f8a58c5e8b81

# Ensure database has required properties:
# - Validation (Rich Text)
# - Error (Checkbox)

# Add delay between batch updates
node batch-validate-content.cjs dir --update-notion
# (Script already includes 1s delay when updating)
```

---

### Property Not Showing in Notion

If the Validation text doesn't appear:

1. **Check property exists**: Database must have "Validation" (Rich Text) property
2. **Refresh page**: Force refresh in browser (Cmd+R or Ctrl+R)
3. **Check character limits**: Notion rich text has ~2000 char limit
4. **View full property**: Click "Show more" if text is truncated

---

### Multiple Validation Entries

If you see many validation entries accumulating:

**By Design**: Each validation appends to the property, creating a history.

**To Reset**: Manually clear the Validation property in Notion before running validation.

**To Overwrite**: Modify `updateNotionValidationProperty()` function to replace instead of append:
```javascript
// Change from appending to replacing
const validationText = `[${timestamp}] Content Validation: ${status}...`;
// (Current implementation already replaces, not appends)
```

---

## Example Scripts

### Validate All Updated Pages and Update Notion

```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/config

# Validate all pages and update Notion properties
node batch-validate-content.cjs ../pages/updated-pages --update-notion
```

---

### Validate Specific Page and Update

```bash
# First embed page ID if needed
node embed-page-id.cjs page.html 2a8a89fedba5816d9940c30180a3bb16

# Then validate and update
node validate-content-order.cjs page.html 2a8a89fedba5816d9940c30180a3bb16 --update-notion
```

---

### Workflow: PATCH → Validate → Update Notion

```bash
# 1. PATCH page (with auto-validation for block count)
bash patch-single-page.sh page.html page-id

# 2. Content validation (with Notion update)
node validate-content-order.cjs page.html page-id --update-notion

# Result: Page has both block count and content validations in Validation property
```

---

## Benefits

1. **Permanent Record**: Validation results stored in Notion, not just console
2. **Filterable**: Use Error checkbox to find problematic pages
3. **Audit Trail**: See validation history over time
4. **Team Visibility**: Everyone can see validation status
5. **Automated**: No manual property updates needed
6. **Integrated**: Works with existing auto-validation system

---

## See Also

- `docs/CONTENT-VALIDATION-TOOLS.md` - Complete validation guide
- `docs/AUTO-VALIDATION.md` - Auto-validation system
- `patch/config/README.md` - Script usage reference
