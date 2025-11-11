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
