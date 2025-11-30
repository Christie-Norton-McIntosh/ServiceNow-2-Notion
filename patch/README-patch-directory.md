# Patch Directory

This directory contains pages that need to be updated in Notion via the PATCH endpoint.

## Structure

### `config/`
Configuration, scripts, and utilities for the patch workflow:
- **`batch-patch-with-cooldown.sh`** ⭐ PRIMARY - Main PATCH script with adaptive timeout (180s/300s/480s) and complexity estimation
- **`revalidate-updated-pages.sh`** - Validates all pages in updated-pages/, moves failures back
- **`simple-property-refresh.sh`** - Quick property updates without validation
- **`clear-validation-errors.sh`** - Bulk clear validation errors for updated pages
- **`test-all-pages.sh`** - Quick dry-run test of all pages
- **`analyze-validation-failures.sh`** - Detailed validation error analysis
- **`batch-marker-sweep.sh`** - Marker cleanup across multiple pages
- **`batch-repatch-and-validate.sh`** - Re-PATCH and validate pages
- **`create-new-pages.sh`** - Create new pages from HTML files
- **`validate-*.cjs`** - Page validation utilities
- **`archived/`** - Deprecated scripts (superseded by primary script)

### `pages/`
Status-organized archive of HTML files by update status:
- **`pages/pages-to-update/`** - HTML files extracted from ServiceNow pages that need PATCH updates (INPUT)
- **`pages/updated-pages/`** - Successfully updated pages (OUTPUT: moved from pages-to-update/ after successful PATCH + validation)

## Scripts

### Primary Script: `config/batch-patch-with-cooldown.sh` ⭐

Main batch PATCH script with adaptive timeout based on page complexity:

**Features:**
1. Dry-run validation with complexity estimation (block count, table count)
2. Adaptive timeout selection:
   - **480s** for very complex pages (>500 blocks OR >50 tables)
   - **300s** for complex pages (>300 blocks OR >30 tables)  
   - **180s** for standard pages
3. Extracts Page ID from HTML metadata
4. PATCHes each page to Notion with selected timeout
5. Validates updated page
6. Moves file to `updated-pages/` only if successful AND clean validation
7. Quarantines timeout/error pages to `problematic-files/`

**Usage:**
```bash
cd patch/config
bash batch-patch-with-cooldown.sh
```

**Environment:**
- Requires server running on `http://localhost:3004`
- Needs `SN2N_VALIDATE_OUTPUT=1` for validation
- Database ID: `282a89fedba5815e91f0db972912ef9f`

**Monitoring:**
- Server logs show `[PATCH-PROGRESS]` markers at each phase (delete, upload, orchestration)
- Client logs show timeout selection and complexity metrics

### Utility Scripts

**`config/revalidate-updated-pages.sh`**
- Validates all pages in updated-pages/ with dry-run POST
- Moves failures back to pages-to-update/ for review
- Refreshes Notion properties for validated pages

**`config/simple-property-refresh.sh`**
- Quick property updates without validation
- Rate limit retry logic with exponential backoff
- Small chunks (3 pages) with 5s delays

**`config/clear-validation-errors.sh`**
- Bulk clear validation errors for successfully patched pages
- Processes in chunks of 25 pages
- Updates Validation/Stats properties in Notion

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

### Standard PATCH Workflow

1. **AutoExtract** saves pages with validation errors to `pages-to-update/`
2. **Fix issues** in code (e.g., depth 3 nesting, marker cleanup, timeout handling)
3. **Run primary PATCH script** from config directory:
   ```bash
   cd patch/config
   bash batch-patch-with-cooldown.sh
   ```
4. **Review results**:
   - ✅ Clean updates → moved to `pages/updated-pages/`
   - ⏱️ Timeouts → moved to `pages/problematic-files/` (complex pages needing extended timeout)
   - ⚠️ With errors → remain in `pages-to-update/` for investigation
   - ❌ API failures → remain in `pages-to-update/` for retry

5. **Optional: Revalidate** updated pages periodically:
   ```bash
   bash revalidate-updated-pages.sh
   ```

### Adaptive Timeout Logic

The script automatically selects timeout based on page complexity:

| Complexity | Blocks | Tables | Timeout | Use Case |
|------------|--------|--------|---------|----------|
| Very High  | >500   | >50    | 480s    | AWS CMDB, GCP Config (80-94 tables) |
| High       | >300   | >30    | 300s    | Complex multi-table pages |
| Standard   | <300   | <30    | 180s    | Most documentation pages |

**Why Adaptive?** Complex pages with 80+ tables can take 5-8 minutes to process (delete existing blocks + upload new blocks + deep nesting orchestration). A fixed 120s timeout would cause legitimate operations to fail.

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

## Database ID

All scripts use the primary ServiceNow Documentation database:
```
Database ID: 282a89fedba5815e91f0db972912ef9f
```

## Archived Scripts

The `config/archived/` directory contains deprecated scripts that have been superseded by `batch-patch-with-cooldown.sh`:
- `batch-patch-validated.sh` - Old version with fixed 130s timeout
- `patch-and-move.sh` - Basic version without pre-validation or adaptive timeout
- `validate-and-move.sh` - Dry-run only script (not part of normal workflow)
- `move-back-from-updated-pages.sh` - One-time migration script with hardcoded titles

These are kept for reference but should not be used. See `SCRIPT_AUDIT.md` for details.
