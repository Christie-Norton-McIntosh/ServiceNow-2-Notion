# Archived Unused Files

This directory contains files that were identified as unused or obsolete and archived from the main project.

## Archived Files Summary

**Date Archived**: October 16, 2025  
**Total Files**: 15,851 files (including subdirectories)  
**Archive Size**: 181MB  
**Archive Location**: `archived/unused-files/`

## Files Archived

### Root-Level Test Files
- `test-related-content.html` - Test HTML for selector logic testing
- `test-selector-logic.cjs` - Script for testing CSS selectors

### Server Test Files
- `server/test-callouts.cjs` - Test script for callout functionality
- `server/test-rich-text-splitting.cjs` - Test script for rich text splitting

### Backup Files
- `marker-management.cjs.backup` - Backup of marker management orchestration file

### Modularization Cleanup Directory
- `modularization-cleanup-20251013/` - Entire directory containing:
  - Test HTML files (sample*.html, test-*.html, test-complex-list.html, etc.)
  - Debug scripts (debug-*.cjs, dump-blocks.cjs, run-orchestrator.cjs, etc.)
  - JSON debug files (debug-blocks.json, parsed-blocks.json, combined-test.json, etc.)
  - Backup files (sn2n-proxy.cjs.*.backup, martian-helper.cjs.backup, etc.)
  - Template projects and exports (project-export/, template-project/)
  - Version-specific backups (8.1.0-*, 8.2.0-*, 9.0.0-* directories)
  - Log files and test data

## Reason for Archiving

These files were identified as:
- **Test/debug files** not needed for production builds
- **Backup files** superseded by proper git version control
- **Development artifacts** from past refactoring and modularization work
- **Duplicate files** that served no current purpose
- **Legacy test data** accumulated during development

## Restoration

If any of these files are needed in the future, they can be found in:
```
/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/archived/unused-files/
```

To restore a file:
```bash
cp archived/unused-files/filename /path/to/restore/
```

## Archive Maintenance

- Review archived files periodically (quarterly)
- Delete permanently after 1 year if still unused
- Keep this README for reference

---

**Archived By**: AI Assistant  
**Date**: October 16, 2025  
**Project Version**: 9.2.0