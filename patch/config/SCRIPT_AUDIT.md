# Patch Config Scripts Audit
**Date:** November 15, 2025

## Summary
10 shell scripts currently in `patch/config/`. Analysis shows redundancy and inconsistent DB IDs.

## Recommendations

### ✅ KEEP (Active Use) - 4 scripts
1. **batch-patch-with-cooldown.sh** ⭐ PRIMARY
   - Main batch PATCH script with adaptive timeout (180s/300s/480s)
   - Uses dry-run complexity estimation
   - Recently enhanced with user fixes (v11.0.0)
   - Status: ✅ Current, actively maintained

2. **revalidate-updated-pages.sh**
   - Validates all pages in updated-pages/
   - Moves failures back to pages-to-update/
   - Property refresh for validated pages
   - Status: ✅ Useful for auditing

3. **simple-property-refresh.sh**
   - Quick property updates without validation
   - Rate limit retry logic
   - Status: ✅ Maintenance utility

4. **clear-validation-errors.sh**
   - Bulk clear validation errors for updated pages
   - Chunks of 25 pages
   - Status: ✅ Maintenance utility

### ✅ FIXED - 2 scripts
5. **test-all-pages.sh**
   - ✅ FIXED: DB ID updated to "282a89fedba5815e91f0db972912ef9f"
   - Status: Now functional

6. **analyze-validation-failures.sh**
   - ✅ FIXED: DB ID updated to "282a89fedba5815e91f0db972912ef9f"
   - Overlaps with test-all-pages.sh functionality
   - Status: Now functional (consider archiving due to overlap)

### 📦 ARCHIVE (Superseded/One-time) - 4 scripts
7. **batch-patch-validated.sh**
   - Superseded by batch-patch-with-cooldown.sh
   - Has 130s timeout (not adaptive)
   - Missing complexity estimation
   - Status: Archive - functionality in primary script

8. **patch-and-move.sh**
   - Basic PATCH without pre-validation
   - Fixed 120s timeout (not adaptive)
   - Missing complexity estimation
   - Status: Archive - superseded by batch-patch-with-cooldown.sh

9. **validate-and-move.sh**
   - Dry-run validation only (no PATCH)
   - Moves passed files to updated-pages/
   - Status: Archive - not part of normal workflow

10. **move-back-from-updated-pages.sh**
    - Hardcoded list of 65+ specific page titles
    - One-time migration script
    - Status: Archive - not reusable

## Database ID Confusion

Two different DB IDs found in scripts:
- ✅ **Correct:** `282a89fedba5815e91f0db972912ef9f` (used in primary scripts)
- ❌ **Wrong:** `178f8dc43e2780d09be1c568a04d7bf3` (legacy/test DB?)

## Action Items

1. ✅ **Archive 4 scripts:** COMPLETED
   - Moved to `archived/` directory
   - batch-patch-validated.sh
   - patch-and-move.sh
   - validate-and-move.sh
   - move-back-from-updated-pages.sh

2. ✅ **Fix DB IDs in 2 scripts:** COMPLETED
   - Updated test-all-pages.sh: line 23
   - Updated analyze-validation-failures.sh: line 16
   - Both now use correct DB ID: 282a89fedba5815e91f0db972912ef9f

3. ✅ **Update README.md:** COMPLETED
   - Documented batch-patch-with-cooldown.sh as primary script
   - Removed references to archived scripts
   - Added DB ID clarification
   - Added adaptive timeout table and workflow details

## Workflow Simplification

**Before:** 3 overlapping PATCH scripts
- batch-patch-with-cooldown.sh (adaptive timeout)
- batch-patch-validated.sh (fixed timeout)
- patch-and-move.sh (basic)

**After:** 1 primary PATCH script
- batch-patch-with-cooldown.sh (adaptive timeout, complexity estimation)

**Result:** Clearer workflow, reduced confusion, easier maintenance
