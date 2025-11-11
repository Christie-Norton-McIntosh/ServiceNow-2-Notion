# Patch Directory

This directory contains pages that need to be updated in Notion via the PATCH endpoint.

## Structure

### `config/`
Configuration and scripts for the patch workflow:
- **`patch-and-move.sh`** - Main PATCH script with validation checking
- **`validate-and-move.sh`** - Dry-run validation script

### `pages-to-update/`
HTML files extracted from ServiceNow pages that have corresponding Notion pages needing updates. Each file contains:
- Embedded metadata (Page ID, expected block counts)
- Fresh HTML content from ServiceNow
- Timestamp in filename

**Files remain here if:**
- PATCH API call fails (network/server errors)
- PATCH succeeds but validation finds errors
- No Page ID mapping exists

### `pages-to-update/updated-pages/`
Successfully updated pages that passed both PATCH and validation. These files have been:
- Successfully PATCHed to Notion
- Validated with no critical errors
- Moved here as a historical record

## Scripts

### `config/patch-and-move.sh`
Main batch PATCH script that:
1. Extracts Page ID from HTML metadata
2. PATCHes each page to Notion
3. Runs validation on updated page
4. Moves file to `updated-pages/` only if PATCH succeeded AND validation passed

**Usage:**
```bash
cd patch/config
bash patch-and-move.sh
```

**Environment:**
- Requires server running on `http://localhost:3004`
- Needs `SN2N_VALIDATE_OUTPUT=1` for validation
- Database ID: `282a89fedba5815e91f0db972912ef9f`

### `config/validate-and-move.sh`
Dry-run validation script (doesn't PATCH, just validates extraction).

## Validation Property Indicator

Pages updated via PATCH will show in their Notion Validation property:
```
🔄 PATCH

✅ All validation checks passed
```

Or if there are errors:
```
🔄 PATCH

❌ Validation failed: 2 critical error(s)
• Marker leak: 1 visible sn2n:marker token(s)
• Image count mismatch: expected 4, got 3
```

## Workflow

1. **AutoExtract** saves pages with validation errors to `pages-to-update/`
2. **Fix issues** in code (e.g., depth 3 nesting, marker cleanup)
3. **Run patch script** from config directory:
   ```bash
   cd patch/config
   bash patch-and-move.sh
   ```
4. **Review results**:
   - ✅ Clean updates → moved to `pages-to-update/updated-pages/`
   - ⚠️ With errors → remain in `pages-to-update/` for investigation
   - ❌ API failures → remain in `pages-to-update/` for retry

## Page ID Format

Each HTML file has embedded metadata:
```html
<!--
  Page ID: 2a8a89fe-dba5-81e0-9cde-f486068bdd3d
  Block Count (expected): 66
  Block Count (actual): 84
-->
```

The script automatically extracts and formats this ID for the PATCH request.
