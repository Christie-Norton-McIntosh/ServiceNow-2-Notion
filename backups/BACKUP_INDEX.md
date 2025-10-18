# ServiceNow-2-Notion Backup Index

This directory contains versioned backups of the ServiceNow-2-Notion project.

---

## Latest Backup

**Version**: 9.2.0  
**Date**: October 16, 2025 22:31:13  
**Directory**: `backup-v9.2.0-20251016-223113/`  
**Files**: 73 files  
**Size**: 1.2 MB  

### Key Changes in v9.2.0
- Comprehensive testing documentation (TESTING_SCENARIOS.md)
- Implementation summary documentation
- Code cleanup (removed excessive debug logging)
- README updates with Key Features section
- Version bumped from 9.1.0 to 9.2.0

---

## Backup History

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
| 9.2.0 | 2025-10-16 | 73 | 1.2 MB | ✅ Current |
| 9.1.0 | 2025-10-15 | ~70 | ~1.1 MB | ✅ Previous |
| 9.0.0 | 2025-10-13 | ~65 | ~1.0 MB | 📦 Archived |
| 8.2.5 | 2025-10-07 | ~60 | ~0.9 MB | 📦 Archived |

---

**Last Updated**: October 16, 2025  
**Maintained By**: Christie Norton-McIntosh
