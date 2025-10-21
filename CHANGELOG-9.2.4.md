# Version 9.2.4 - Quick Reference

**Date:** October 21, 2025  
**Type:** Bug Fix (Patch)

## The Fix

Fixed bullet points in table cells appearing on the same line instead of separate lines.

## Changed Files

- `server/converters/rich-text.cjs` - Fixed text splitting logic to preserve newlines
- `server/converters/table.cjs` - Added debug logging
- `package.json` - Bumped to v9.2.4
- `dist/ServiceNow-2-Notion.user.js` - Rebuilt with new version

## Test Result

✅ **WORKING:** https://www.notion.so/Benchmarks-293a89fedba5812b8fcaebc036592e65

## Installation

```bash
# Rebuild userscript
npm run build

# Restart server (clears module cache)
killall -9 node && npm start

# Reload userscript in Tampermonkey
```

## Technical Summary

**Problem:** Text splitting skipped empty lines, losing newlines at start of segments  
**Solution:** Removed empty line skipping, always insert newlines between segments  
**Result:** Bullet points now render on separate lines in Notion table cells

## Documentation

- **Detailed Fix:** `docs/fix-bullet-points-newlines.md`
- **Release Notes:** `backups/release_notes_9.2.4.md`
- **Full Backup:** `backups/v9.2.4-bullet-points-fix-20251021-075314/`

## What's Included

- ✅ Bullet points on separate lines
- ✅ HTML span tags stripped (from v9.2.3)
- ✅ Proper table cell formatting
- ✅ Zero HTML tag leakage
