# Backup: v11.0.17 - Callout Detection Fix
**Created:** 2025-11-17 22:19:46
**Branch:** build-v11.0.5
**Version:** 11.0.17

## Changes Since Last Build

### Server-Side Changes (Active via Hot-Reload)
- ✅ Added Cheerio-based expectedCallouts detection in `server/routes/w2n.cjs`
- ✅ Replaced regex with DOM-aware callout counting (POST and PATCH flows)
- ✅ Updated final callout dedupe to respect expectedCallouts
- ✅ Modified dedupe utility to accept expectedCallouts option
- ✅ Implemented conditional deduplication (only dedupe when actual > expected)

### Client-Side Changes (Pending Build)
- ⚠️ Navigation retry logic in `src/ui/main-panel.js`
- ⚠️ UI panel positioning persistence improvements
- ⚠️ Better handling of stuck navigation during AutoExtract

### Test Results
- ✅ 7 out of 9 pages successfully patched with clean validation
- ✅ Insights page validation fixed (was: "expected 5, got 3" → now: clean pass)
- ❌ 2 pages failed due to outdated page IDs (since deleted)

## Files Modified
- server/routes/w2n.cjs (Cheerio import + expectedCallouts detection)
- server/utils/dedupe.cjs (conditional dedupe logic)
- server/services/servicenow.cjs (marker orchestration)
- src/ui/main-panel.js (navigation retry + UI fixes)

## Next Step
Rebuild userscript to version 11.0.18 with all improvements.
