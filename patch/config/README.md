# Patch Config

Configuration and scripts for batch updating Notion pages via PATCH endpoint.

## Scripts

### `patch-and-move.sh`
Main batch PATCH script with validation-aware file movement.

**Features:**
- Extracts Page IDs from HTML metadata
- PATCHes pages to Notion with fresh content
- Validates updated pages
- Only moves files on PATCH success + clean validation

**Usage:**
```bash
cd patch/config
bash patch-and-move.sh
```

**Output:**
- `✅ SUCCESS` + moved to `updated-pages/` - PATCH succeeded, validation passed
- `⚠️ PATCHED WITH ERRORS` + stays in `pages-to-update/` - PATCH succeeded but validation found errors
- `❌ FAILED` + stays in `pages-to-update/` - PATCH API call failed

**Configuration:**
- API URL: `http://localhost:3004/api/W2N`
- Database ID: `282a89fedba5815e91f0db972912ef9f` (IT Service Management | Yokohama)
- Delay: 500ms between requests (rate limit protection)

**Requirements:**
- Server running with `SN2N_VALIDATE_OUTPUT=1`
- Pages must have embedded Page ID metadata

---

### `validate-and-move.sh`
Dry-run validation script (extraction only, no PATCH).

**Usage:**
```bash
cd patch/config
bash validate-and-move.sh
```

**Purpose:**
- Test HTML→Notion block conversion
- Verify extraction works before PATCHing
- Quick validation without modifying Notion pages

---

## Environment Variables

Both scripts respect:
- `SN2N_VALIDATE_OUTPUT=1` - Enable validation after PATCH
- `SN2N_VERBOSE=1` - Verbose server logging
- `SN2N_EXTRA_DEBUG=1` - Additional debug output

## File Locations

Scripts operate on files in:
- **Source**: `../pages-to-update/*.html`
- **Target**: `../pages-to-update/updated-pages/*.html`

All paths are relative to the config directory.

---

## Content Validation Tools (New)

### `validate-content-order.cjs`
Validates that HTML text content matches Notion page text, ignoring formatting.

**Usage:**
```bash
node validate-content-order.cjs <html-file> <notion-page-id> [--update-notion]
```

**Example:**
```bash
# Validate only (console output)
node validate-content-order.cjs ../pages/updated-pages/page.html 2a8a89fedba5816d9940c30180a3bb16

# Validate and update Notion Validation property
node validate-content-order.cjs ../pages/updated-pages/page.html 2a8a89fedba5816d9940c30180a3bb16 --update-notion
```

**Output:**
- Similarity score (%)
- Character count comparison
- Missing/extra segments
- Order issues
- Pass/fail status

**With `--update-notion`:**
- Updates page's Validation property with results
- Sets Error checkbox based on pass/fail

---

### `batch-validate-content.cjs`
Validates multiple pages in a directory.

**Usage:**
```bash
node batch-validate-content.cjs [directory] [--update-notion]
```

**Example:**
```bash
# Validate only
node batch-validate-content.cjs ../pages/updated-pages

# Validate and update all Notion pages
node batch-validate-content.cjs ../pages/updated-pages --update-notion
```

Automatically finds page IDs from HTML comments or `.meta.json` files.

---

### `embed-page-id.cjs`
Embeds Notion page ID into HTML for easier validation.

**Usage:**
```bash
node embed-page-id.cjs <html-file> <page-id>
```

---

## Documentation

See detailed guides:
- **`docs/CONTENT-VALIDATION-TOOLS.md`** - Complete validation guide
- **`docs/AUTO-VALIDATION.md`** - Auto-validation system
- **`patch/README.md`** - PATCH workflow overview
