# Content Validation Tools

Tools for validating that HTML content is accurately converted to Notion pages with correct text content and ordering, regardless of formatting differences.

## Overview

These tools compare plain text content extracted from ServiceNow HTML with the text in Notion pages to ensure:
1. **Completeness**: All HTML content appears in Notion
2. **Ordering**: Content appears in the same sequence
3. **Accuracy**: Text matches (ignoring formatting/styling)

## Tools

### 1. `validate-content-order.cjs`

Validates a single HTML file against its Notion page.

**Usage:**
```bash
node validate-content-order.cjs <html-file> <notion-page-id>
```

**Example:**
```bash
node validate-content-order.cjs \
  ../pages/updated-pages/onboard-github.html \
  2a8a89fedba5816d9940c30180a3bb16
```

**Output:**
- Similarity score (percentage)
- Character count comparison
- Missing segments (in Notion)
- Extra segments (in Notion)
- Order issues (inversions)
- Pass/fail summary

**Exit Codes:**
- `0`: Validation passed
- `1`: Validation failed or error

---

### 2. `batch-validate-content.cjs`

Validates multiple HTML files in a directory.

**Usage:**
```bash
node batch-validate-content.cjs [directory]
```

**Example:**
```bash
# Validate all pages in updated-pages
node batch-validate-content.cjs ../pages/updated-pages

# Validate specific directory
node batch-validate-content.cjs /path/to/html/files
```

**Page ID Resolution:**

The script automatically finds page IDs from:
1. Companion `.meta.json` files (e.g., `page.html` → `page.meta.json`)
2. HTML comments: `<!-- Notion Page ID: xxx -->`
3. Meta tags: `<meta name="notion-page-id" content="xxx">`

**Output:**
- Per-file validation results
- Summary statistics
- List of failed validations with reasons
- Average similarity score

---

### 3. `embed-page-id.cjs`

Embeds Notion page ID into HTML file for easier validation.

**Usage:**
```bash
node embed-page-id.cjs <html-file> <page-id>
```

**Example:**
```bash
node embed-page-id.cjs page.html 2a8a89fedba5816d9940c30180a3bb16
```

Adds a comment to the HTML:
```html
<!-- Notion Page ID: 2a8a89fedba5816d9940c30180a3bb16 -->
<!DOCTYPE html>
...
```

---

## How It Works

### Text Extraction

**From HTML:**
1. Parse HTML with cheerio
2. Remove non-content elements (scripts, styles, nav, TOC)
3. Extract text nodes in document order
4. Normalize text (lowercase, remove punctuation, collapse whitespace)

**From Notion:**
1. Fetch all blocks recursively via Notion API
2. Extract `rich_text`, `title`, `caption` from blocks
3. Include table cell content
4. Normalize text (same as HTML)

### Comparison Metrics

1. **Similarity Score**: Longest Common Subsequence (LCS) algorithm
   - Measures % of text segments that appear in both sources
   - Threshold: 95% for passing

2. **Character Count**: Total normalized text length
   - Compares HTML vs. Notion character counts
   - Shows difference as absolute and percentage

3. **Missing Segments**: Text in HTML but not in Notion
   - Indicates content loss during conversion

4. **Extra Segments**: Text in Notion but not in HTML
   - Indicates added content (e.g., repeated TOC)

5. **Order Issues**: Inversions where A comes before B in HTML but after B in Notion
   - Detects sequence problems

### Normalization

Text is normalized to ignore formatting differences:

```javascript
"Navigate to Workspaces > DevOps Change Workspace"
→ "navigate to workspaces devops change workspace"
```

- Lowercase
- Remove diacritics (é → e)
- Remove punctuation
- Collapse whitespace
- Trim

This allows comparison of semantic content regardless of styling.

---

## Validation Criteria

### PASS Conditions ✅

A page passes validation when:
- Similarity score ≥ 95%
- No missing segments
- No extra segments (or only expected additions)
- No order inversions
- Character count difference within ±10%

### FAIL Conditions ❌

A page fails validation when:
- Missing HTML content in Notion
- Significant order inversions
- Similarity score < 95%
- Large character count discrepancy

---

## Common Issues

### Missing Content

**Symptoms:**
- Similarity < 95%
- "Missing in Notion" segments listed

**Causes:**
- Table cells not extracted
- Nested list items skipped
- Code blocks empty
- Images without alt text

**Solutions:**
1. Check server logs for extraction warnings
2. Verify marker-based orchestration completed
3. Re-PATCH page after fixes

---

### Extra Content

**Symptoms:**
- "Extra in Notion" segments listed
- Character count higher in Notion

**Causes:**
- TOC/sidebar repeated in each section
- Duplicate blocks from orchestration
- Marker tokens not cleaned

**Solutions:**
1. Strip TOC before conversion (`stripMiniTocAndRelated()`)
2. Run deduplication after orchestration
3. Verify marker sweep completed

---

### Order Issues

**Symptoms:**
- "Order Issues" detected
- Inversions where A/B sequence flipped

**Causes:**
- Tables moved outside list items
- Callouts promoted to siblings
- Deferred blocks appended out of order

**Solutions:**
1. Verify marker tokens preserved until orchestration
2. Check `markerMap` respects DOM order
3. Ensure `_sn2n_dom_order` tracking works

---

## Workflow Examples

### Single Page Validation

```bash
# 1. Embed page ID (if not already present)
node embed-page-id.cjs page.html 2a8a89fe-dba5-8113-b958-f8a58c5e8b81

# 2. Validate content
node validate-content-order.cjs page.html 2a8a89fe-dba5-8113-b958-f8a58c5e8b81

# 3. If failed, check specific issues and fix source/conversion
```

---

### Batch Validation

```bash
# 1. Validate all pages in directory
node batch-validate-content.cjs ../pages/updated-pages

# 2. Review summary output for failures

# 3. Re-validate specific failed pages
node validate-content-order.cjs failed-page.html <page-id>
```

---

### Pre-PATCH Validation

```bash
# 1. DryRun conversion to get block structure
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d '{"databaseId":"xxx","contentHtml":"...","dryRun":true}'

# 2. Validate content would be correct
node validate-content-order.cjs original.html existing-page-id

# 3. If passed, execute PATCH
curl -X PATCH http://localhost:3004/api/W2N/page-id \
  -H "Content-Type: application/json" \
  -d '{"title":"...","contentHtml":"...","url":"..."}'

# 4. Post-PATCH validation
node validate-content-order.cjs original.html page-id
```

---

## Integration with Auto-Validation

These tools complement the existing auto-validation system:

**Auto-Validation** (`SN2N_VALIDATE_OUTPUT=1`):
- Validates block count (70%-150% tolerance)
- Sets Error checkbox on failures
- Saves failed pages to `pages-to-update/`

**Content Validation**:
- Validates text content and ordering
- Ignores formatting/styling differences
- Focuses on semantic correctness

Use both together:
1. Auto-validation catches block count issues
2. Content validation catches ordering/completeness issues

---

## Performance

**Single Page:**
- HTML parsing: ~100ms
- Notion API fetch: ~2-5s (depending on page size)
- Comparison: ~50ms
- **Total: ~3-6 seconds per page**

**Batch Validation:**
- 500ms delay between pages to avoid rate limiting
- ~4-7 seconds per page
- **10 pages: ~50-70 seconds**

---

## Environment Variables

Required:
- `NOTION_TOKEN`: Notion API token (from `.env`)

Optional:
- `SN2N_EXTRA_DEBUG=1`: Show detailed error stack traces
- `NODE_PATH`: Set to `server/node_modules` for dependencies

---

## Troubleshooting

### "HTML file not found"

Ensure file path is correct:
```bash
# Use absolute path
node validate-content-order.cjs /full/path/to/file.html page-id

# Or relative path from script location
node validate-content-order.cjs ../pages/file.html page-id
```

---

### "No page ID found"

Embed page ID first:
```bash
node embed-page-id.cjs file.html page-id
# Then retry validation
```

---

### "Rate limited"

Reduce batch size or increase delay:
- Edit `batch-validate-content.cjs`
- Change delay: `setTimeout(resolve, 1000)` → increase to 2000ms

---

## Future Enhancements

Potential improvements:
1. **Fuzzy Matching**: Allow small text variations (typos, OCR errors)
2. **Visual Diff**: Side-by-side HTML vs. Notion text comparison
3. **Section Analysis**: Per-heading validation for granular feedback
4. **Image Validation**: Check image URLs/captions match
5. **Link Validation**: Verify hyperlinks preserved
6. **Format Detection**: Flag formatting loss (bold, code, etc.)

---

## Examples

### Example 1: Perfect Match ✅

```
🔍 Content Validation Tool

HTML File: page.html
Notion Page: 2a8a89fedba5816d9940c30180a3bb16

📊 Analysis:

✓ Similarity Score: 98.5%
✓ HTML text length: 12,450 characters
✓ Notion text length: 12,478 characters
✓ Difference: +28 (+0.2%)

✓ All HTML content found in Notion
✓ No extra content in Notion
✓ Content order matches

================================================================================
📋 Summary:

✅ PASS - Content is complete and in correct order
```

---

### Example 2: Missing Content ❌

```
📊 Analysis:

✓ Similarity Score: 87.3%
✓ HTML text length: 15,200 characters
✓ Notion text length: 13,450 characters
✓ Difference: -1,750 (-11.5%)

⚠️  Missing in Notion (8 segments):
   1. "To configure the connection, complete the following steps in the wizard..."
   2. "Select the authentication method from the dropdown menu..."
   ...

✓ No extra content in Notion
✓ Content order matches

================================================================================
📋 Summary:

❌ ISSUES DETECTED:
   - 8 segments missing from Notion
   - Similarity score below 95% (87.3%)
```

---

### Example 3: Order Issues ❌

```
📊 Analysis:

✓ Similarity Score: 96.2%
✓ All HTML content found in Notion

⚠️  Order Issues (3 detected):
   1. Inversion detected:
      A: "Navigate to Workspaces > DevOps Change Workspace..."
      B: "In the Tool name field, enter a name for the tool..."
      HTML order: A at 5, B at 8
      Notion order: A at 8, B at 5

================================================================================
📋 Summary:

❌ ISSUES DETECTED:
   - 3 order issues detected
```

---

## See Also

- `docs/AUTO-VALIDATION.md` - Automatic validation system
- `docs/FIX_TABLE_IN_LIST_NESTING.md` - Table nesting fix
- `patch/README.md` - PATCH workflow documentation
