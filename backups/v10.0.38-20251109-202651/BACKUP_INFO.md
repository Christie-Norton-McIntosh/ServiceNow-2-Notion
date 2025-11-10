# Backup Information - v10.0.38

**Backup Date**: November 9, 2025 20:26:51  
**Version**: 10.0.38  
**Branch**: build-v10.0.29  
**Reason**: Pre-major version bump to v11.0.0

## Contents

This backup contains a complete snapshot of the codebase before upgrading to v11.0.0:

### Source Code
- `src/` - Full userscript source code
- `server/` - Node.js proxy server code
- `dist/` - Built userscript (v10.0.38)

### Configuration
- `package.json` - NPM dependencies and version
- `rollup.config.js` - Build configuration
- `.github/` - GitHub workflows and templates

### Documentation
- `docs/` - Technical documentation
- `README.md` - Main documentation
- `CHANGELOG.md` - Version history

## Recent Changes (v10.0.38)

### Navigation Retry Fix
- **Issue**: AutoExtract stopped prematurely when navigation failed
- **Fix**: Added immediate navigation retry logic (up to 2 attempts)
- **Features**:
  - Navigation failure detection and retry
  - Smart duplicate URL detection (expected vs unexpected)
  - End-of-book confirmation dialog
  - Detailed debug logging

### Rate Limit Protection (v10.0.29)
- Server-side exponential backoff retry (5 attempts)
- Client-side 60-second pause with automatic retry
- Failed pages tracking and storage
- Completion summary with success/failed breakdown

### Validation Fixes (Issues #1-5)
- **Issue #1**: Standalone images extraction fixed
- **Issue #2**: Table duplication diagnostics added
- **Issue #3**: Tables in deeply nested lists fixed
- **Issue #4**: Multi-pass DataTables wrapper unwrapping
- **Issue #5**: Callouts in nested lists extraction fixed

## Key Commits

- `e3105a6` - Navigation retry logic
- `0b50c7a` - Build v10.0.38 userscript
- `e8fcf5d` - Rate limit protection and validation fixes

## Restoration Instructions

To restore this version:

```bash
# From repository root
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion

# Create restoration branch
git checkout -b restore-v10.0.38

# Copy files from backup
cp -r backups/v10.0.38-20251109-202651/src .
cp -r backups/v10.0.38-20251109-202651/server .
cp backups/v10.0.38-20251109-202651/package.json .
cp backups/v10.0.38-20251109-202651/rollup.config.js .

# Install dependencies
npm install
cd server && npm install && cd ..

# Build userscript
npm run build

# Test
npm start  # Start proxy server
# Then test userscript in Tampermonkey
```

## Notes

- This is the last v10.x version before major version bump
- All features are stable and tested
- Server requires Node.js 18+ and Notion API token
- Userscript requires Tampermonkey browser extension

## Contact

For issues or questions about this backup, refer to the project repository:
https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion
