# Patch Directory Reorganization (v11.0.5)

**Date:** November 16, 2025  
**Scope:** Restructured `patch/` directory for clarity and scalability  
**Status:** ✅ Complete

## Overview

The `patch/` directory structure was reorganized to improve clarity and separate concerns:

### Before
```
patch/
├── pages/                      (mixed status folders, some with subdirs)
│   ├── complete/              (HTML only)
│   ├── problematic-files/     (HTML + INVESTIGATION_NEEDED.md + complexity-summary.json)
│   ├── missing-page-id/       (HTML + README.md)
│   ├── split-policies/        (HTML + _split-index.json)
│   └── pages-to-update/       (nested duplicate)
├── pages-to-update/           (root level, contained subdirs)
│   ├── failed-validation/     (HTML + metadata)
│   ├── problematic-files/     (HTML + metadata)
│   └── updated-pages/         (HTML + metadata)
├── docs/                       (old documentation)
├── config/                     (scripts with hardcoded paths)
└── logs/                       (runtime logs)
```

### After
```
patch/
├── pages/                      (archived status collections, HTML-only)
│   ├── complete/              (HTML)
│   ├── created/               (HTML)
│   ├── created-pages/         (HTML)
│   ├── failed/                (HTML)
│   ├── failed-pages/          (HTML)
│   ├── failed-validation/     (HTML)
│   ├── missing-page-id/       (HTML)
│   ├── problematic/           (HTML)
│   ├── problematic-files/     (HTML)
│   ├── split-policies/        (HTML)
│   ├── temp-skip/             (HTML)
│   ├── to-update/             (HTML)
│   ├── updated/               (HTML)
│   └── updated-pages/         (HTML)
├── pages-to-update/           (active working directory, HTML-only)
├── docs/                       (all documentation + metadata)
│   ├── CALLOUT_DETECTION_FIX_v11.0.0.md
│   ├── COMPLETION_REPORT_v11.0.0.md
│   ├── ERROR_ANALYSIS_AND_FIXES.md
│   ├── MISSING_PAGE_ID_README.md
│   ├── PROBLEMATIC_FILES_INVESTIGATION.md
│   ├── problematic-files-complexity-summary.json
│   ├── split-policies-index.json
│   └── ... (other documentation)
├── logs/                       (runtime logs)
├── config/                     (scripts with updated paths)
└── scripts/                    (batch processing scripts)
```

## Changes Made

### 1. Metadata Files Moved to `patch/docs/`

| Old Location | New Location |
|---|---|
| `pages/problematic-files/INVESTIGATION_NEEDED.md` | `docs/PROBLEMATIC_FILES_INVESTIGATION.md` |
| `pages/problematic-files/complexity-summary.json` | `docs/problematic-files-complexity-summary.json` |
| `pages/missing-page-id/README.md` | `docs/MISSING_PAGE_ID_README.md` |
| `pages/split-policies/_split-index.json` | `docs/split-policies-index.json` |

### 2. HTML Files Consolidated

No HTML was moved in pages-to-update (it was already at root level). The subdirectories inside `pages-to-update/` were empty or removed.

### 3. Script Updates

All scripts were updated to reference new paths:

#### Node.js Scripts (patch/config/*.cjs)
- **append-parent-links.cjs**: LOG_DIR now points to `patch/logs`
- **inline-sections-into-parent.cjs**: SRC_DIR → `patch/pages/updated-pages`, LOG_DIR → `patch/logs`
- **reinline-parent-with-intro.cjs**: ORIG_FILE → `patch/pages/problematic-files/...`, SRC_DIR → `patch/pages/updated-pages`, LOG_DIR → `patch/logs`
- **collect-created-pages.cjs**: DEST_DIR → `patch/pages/created-pages`, LOG_DIR → `patch/logs`
- **test-github-page-conversion.cjs**: FILE_PATH → `patch/pages/updated-pages/...`

#### Shell Scripts (patch/config/*.sh)
- **batch-create-from-files.sh**: DEST_DIR → `patch/pages/created-pages`, LOG_DIR → `patch/logs`
- **clear-validation-errors.sh**: UPDATED_DIR → `patch/pages/updated-pages`
- **simple-property-refresh.sh**: UPDATED_DIR → `patch/pages/updated-pages`

#### Batch Scripts (patch/scripts/*.sh)
- **batch-marker-sweep.sh**: UPDATED_DIR → `patch/pages/updated-pages`
- **batch-repatch-and-validate.sh**: UPDATED_DIR → `patch/pages/updated-pages`
- **create-new-pages.sh**: UPDATED_DIR → `patch/pages/created-pages`

### 4. Documentation Updates

- **patch/README.md**: Updated section descriptions and workflow paths
- **patch/docs/**: Created comprehensive metadata and investigation documents

## Directory Purpose Guide

### patch/pages/
**Purpose:** Archive of HTML files organized by processing status  
**Contents:** HTML files only (no mixed content)  
**Use:** Historical reference, moving files between status folders during batch operations

**Subfolders:**
- `complete/` - Fully processed pages (legacy reference)
- `created/` - Pages created without Page ID
- `created-pages/` - Pages with successful POST creation
- `failed/` - Pages that failed processing
- `failed-pages/` - Failed POST creation attempts
- `failed-validation/` - Pages that failed validation checks
- `missing-page-id/` - Pages without Page ID mapping
- `problematic/` - Pages flagged for investigation
- `problematic-files/` - Complex pages requiring special handling
- `split-policies/` - Pages split for size management
- `temp-skip/` - Pages temporarily skipped
- `to-update/` - Pages awaiting PATCH
- `updated/` - Historical updates
- `updated-pages/` - Successfully updated pages (post-validation)

### patch/pages-to-update/
**Purpose:** Active working directory for fresh extractions  
**Contents:** HTML files only (no subdirectories)  
**Workflow:** AutoExtract saves here → Batch scripts read here → Move results to `pages/` status folders

### patch/docs/
**Purpose:** All documentation, investigation notes, and metadata  
**Contents:**
- Markdown documentation files
- Investigation notes for problematic pages
- Metadata indices (JSON)
- Analysis reports
- Fix summaries

### patch/logs/
**Purpose:** Runtime execution logs  
**Contents:** Timestamped log files from batch operations

### patch/config/
**Purpose:** Configuration and utility scripts  
**Contents:** Bash and Node.js scripts for batch operations

### patch/scripts/
**Purpose:** Batch processing scripts  
**Contents:** Orchestration and validation scripts

## Migration Notes

### For Scripts Reading HTML Files

If your script references files in `pages-to-update/` subfolders, update to:
```javascript
// Before
const file = path.join('patch/pages-to-update/updated-pages/file.html');

// After  
const file = path.join('patch/pages/updated-pages/file.html');
```

### For Log Output

If your script writes logs to `pages-to-update/log/`, update to:
```javascript
// Before
const logDir = path.join('patch/pages-to-update/log');

// After
const logDir = path.join('patch/logs');
```

### For Automation

The primary batch script paths have been updated:
```bash
# All scripts now read from correct locations automatically
bash patch/config/batch-patch-with-cooldown.sh
bash patch/config/clear-validation-errors.sh
bash patch/config/simple-property-refresh.sh
```

## Verification Checklist

- ✅ All HTML files remain in their expected locations
- ✅ `patch/pages/` contains only HTML files (no mixed content)
- ✅ `patch/pages-to-update/` is flat (no subdirectories)
- ✅ All metadata moved to `patch/docs/`
- ✅ All scripts updated to reference new paths
- ✅ `patch/logs/` directory exists and ready for use
- ✅ `SN2N_FIXTURES_DIR` still points to `patch/pages-to-update` (correct for input files)

## Backup

A complete backup of the old structure was created:
```
backups/patch-structure-backup-<timestamp>.tar.gz
```

To restore if needed:
```bash
tar -xzf backups/patch-structure-backup-<timestamp>.tar.gz
```

## Future Improvements

1. **Cleanup empty directories**: `pages/created/`, `pages/failed/`, etc. can be cleaned if unused
2. **Consolidate related status folders**: Consider merging similar status categories (e.g., `failed/` + `failed-pages/` → `pages/failed/`)
3. **Add status indicators**: Consider naming convention like `pages/status-COMPLETE/` for clarity
4. **Archive old data**: Move `pages/complete/` to dated archive folder after quarterly review

## References

- Main README: `patch/README.md`
- Workflow Documentation: `docs/AUTO-VALIDATION.md`
- Batch Script: `patch/config/batch-patch-with-cooldown.sh`
- Previous Fixes: `docs/CALLOUT_DETECTION_FIX_v11.0.0.md`

