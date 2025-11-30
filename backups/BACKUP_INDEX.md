# ServiceNow-2-Notion Backup Index

This directory contains versioned backups of the ServiceNow-2-Notion project.

---

## Latest Backup

**Version**: 10.0.38 (Pre-v11.0.0)  
**Date**: November 9, 2025 20:26:51  
**Directory**: `v10.0.38-20251109-202651/`  
**Files**: Complete source backup  
**Size**: ~1.5 MB  

### Key Changes in v10.0.38
- **Navigation retry logic**: Auto-retry failed navigation up to 2 times
- **Smart duplicate detection**: Distinguishes navigation failures from true duplicates
- **End-of-book confirmation**: Prevents premature AutoExtract stops
- **navigationFailures counter**: Tracks consecutive navigation failures
- Complete pre-v11.0.0 snapshot with all v10.x features

### Purpose
Full backup before major version bump to v11.0.0. Contains all v10.x improvements including rate limit protection, validation fixes, and navigation retry system.

---

## Backup History

### v10.0.38 (November 9, 2025) - Pre-v11.0.0
- **Directory**: `v10.0.38-20251109-202651/`
- **Changes**: Navigation retry system, pre-major version bump
- **Release Notes**: `BACKUP_INFO.md` in directory
- **Status**: ✅ Current

### v9.2.44 (October 28, 2025)
- **Directory**: `v9.2.44-20251028-231618/`
- **Changes**: Role name formatting as inline code
- **Release Notes**: `release_notes_9.2.44.md`
- **Status**: ✅ Previous

### v9.2.25 (October 25, 2025)
- **Directory**: `v9.2.25-20251025-130627/`
- **Changes**: Additional formatting improvements
- **Status**: ✅ Complete

### v9.2.4 (October 21, 2025)
- **Directory**: `v9.2.4-bullet-points-fix-20251021-075314/`
- **Changes**: Bullet point formatting fixes
- **Release Notes**: `release_notes_9.2.4.md`
- **Status**: ✅ Complete

### v9.2.1 (October 18, 2025)
- **Directory**: `backup-9.2.1-20251018-000000/`
- **Status**: ✅ Complete

### v9.2.0 (October 16, 2025)
- **Directory**: `backup-v9.2.0-20251016-223113/`
- **Changes**: Testing documentation, code cleanup
- **Files**: 73 files, 1.2 MB
- **Status**: ✅ Complete

### v9.1.0 (October 2025)
- **Directory**: Previous version
- **Changes**: Table image extraction feature
- **Status**: Superseded by v9.2.0

### v9.0.0 (October 13, 2025)
- **Directory**: `backup-9.0.0-20251013-171551/` (in modularization-cleanup folder)
- **Changes**: Major modularization and cleanup
- **Status**: Archived

### v8.2.5 and earlier
- **Location**: `modularization-cleanup-20251013/`
- **Status**: Historical backups archived

---

## Backup Contents

Each backup includes:
- ✅ Source code (`src/`)
- ✅ Server code (`server/`)
- ✅ Documentation (`docs/`)
- ✅ Configuration files
- ✅ Scripts and workflows
- ✅ VERSION_NOTES.md (in backup directory)

**Excluded** from backups:
- ❌ `node_modules/` (reinstall with `npm install`)
- ❌ `.git/` (use git repository for version control)
- ❌ `backups/` (prevent recursive backups)
- ❌ Large log files (`server/logs/*.json`)
- ❌ Build output (`dist/`)

---

## How to Use Backups

### Restore a Backup
```bash
# Navigate to backup
cd backups/backup-v9.2.0-20251016-223113

# Install dependencies
npm install
cd server && npm install && cd ..

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your settings

# Build and run
npm run build
npm start
```

### Compare Versions
```bash
# Compare two backups
diff -r backup-v9.1.0-YYYYMMDD backup-v9.2.0-20251016-223113
```

### Extract Specific Files
```bash
# Copy specific file from backup
cp backup-v9.2.0-20251016-223113/docs/TESTING_SCENARIOS.md ../current-project/docs/
```

---

## Backup Best Practices

1. **Regular Backups**: Create backup before major changes
2. **Version Bumps**: Always update version before backup
3. **Documentation**: Include VERSION_NOTES.md in each backup
4. **Testing**: Verify backup can be restored successfully
5. **Cleanup**: Remove old backups after confirming new ones work

---

## Backup Naming Convention

Format: `backup-v{VERSION}-{TIMESTAMP}/`

- **VERSION**: Semantic version (e.g., 9.2.0)
- **TIMESTAMP**: YYYYMMDD-HHMMSS format

Example: `backup-v9.2.0-20251016-223113/`

---

## Storage Recommendations

- Keep latest 3-5 major version backups
- Archive older backups to external storage
- Total backup size: ~5-10 MB per backup (without node_modules)
- Git repository provides additional version control

---

## Quick Reference

| Version | Date | Files | Size | Status |
|---------|------|-------|------|--------|
| 10.0.38 | 2025-11-09 | Complete | ~1.5 MB | ✅ Current (Pre-v11) |
| 9.2.44 | 2025-10-28 | Complete | ~1.2 MB | ✅ Previous |
| 9.2.25 | 2025-10-25 | Complete | ~1.2 MB | ✅ Previous |
| 9.2.4 | 2025-10-21 | Complete | ~1.1 MB | ✅ Previous |
| 9.2.1 | 2025-10-18 | Complete | ~1.1 MB | ✅ Previous |
| 9.2.0 | 2025-10-16 | 73 | 1.2 MB | ✅ Stable |
| 9.1.0 | 2025-10-15 | ~70 | ~1.1 MB | 📦 Archived |
| 9.0.0 | 2025-10-13 | ~65 | ~1.0 MB | 📦 Archived |
| 8.2.5 | 2025-10-07 | ~60 | ~0.9 MB | 📦 Archived |

---

**Last Updated**: November 9, 2025  
**Maintained By**: Christie Norton-McIntosh

## v11.0.2-duplicate-callout-fix-20251110-111958

**Date**: November 10, 2025
**Version**: 11.0.2
**Size**: ~10MB

### Key Changes
- ✅ Fixed duplicate callouts in list items (post-orchestration deduplication)
- ✅ Extended deduplication to all container block types (callouts, toggles, quotes, columns)
- ✅ Made deduplication recursive for deeply nested structures
- ✅ Added automated validation testing script
- ✅ 100% validation success rate (229/229 failures resolved)

### Files Modified
- `server/routes/w2n.cjs` - Post-orchestration deduplication
- `server/utils/dedupe.cjs` - Cleaned up debug logging
- `scripts/retest-validation-failures.cjs` - NEW validation testing automation

### Impact
All 229 validation failures were caused by duplicate callouts being added after initial deduplication. This fix ensures duplicates are caught and removed after the orchestration phase completes.

**Status**: Production-ready, fully tested
**Validation**: 100% passing

