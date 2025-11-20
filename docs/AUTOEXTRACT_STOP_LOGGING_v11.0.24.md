# AutoExtract Persistent Stop Logging - v11.0.24

## Overview

Added persistent logging for AutoExtract stop events that survives page reloads and panel removal. This helps diagnose why AutoExtract stopped, even if the panel disappears.

## Problem

When AutoExtract processes 500+ pages and stops, the floating panel may disappear, taking the stop reason with it. Users are left wondering why it stopped and have no way to retrieve the information.

## Solution

**Persistent Stop Logs** - Every time AutoExtract stops, the reason is saved to `localStorage` with context:

- Timestamp
- Stop reason (error message or condition)
- Total pages processed
- Last page number
- Duplicate count (if applicable)
- Current URL

Logs are kept in a rolling buffer (last 10 entries) and survive:
- Page reloads
- Browser restarts
- Panel removal
- Session changes

## Usage

### View Stop Logs

Open browser console on any ServiceNow page and run:

```javascript
window.ServiceNowToNotion.viewStopLogs()
```

**Example Output:**
```
================================================================================
📋 AutoExtract Stop Logs (last 3 entries)
================================================================================

[1] 2025-11-19T08:30:15.123Z
    Reason: User clicked Stop button
    Pages Processed: 523
    Last Page: 523
    Duplicate Count: 0
    URL: https://docs.servicenow.com/...

[2] 2025-11-18T14:22:45.678Z
    Reason: ❌ AutoExtract STOPPED: Same page content detected 3 times in a row
    Pages Processed: 127
    Last Page: 130
    Duplicate Count: 3
    URL: https://docs.servicenow.com/...

[3] 2025-11-17T11:05:33.901Z
    Reason: ❌ AutoExtract STOPPED: Navigation to page 56 failed
    Pages Processed: 55
    Last Page: 55
    Duplicate Count: 0
    URL: https://docs.servicenow.com/...

================================================================================
Tip: Run window.ServiceNowToNotion.clearStopLogs() to clear history
================================================================================
```

### Clear Stop Logs

```javascript
window.ServiceNowToNotion.clearStopLogs()
```

### Search Console for Stop Events

All stop events are also logged to console with a special marker:

```javascript
// Search console for:
"🔴 [AUTOEXTRACT-STOP-LOG] 🔴"
```

## Implementation Details

**Modified Files:**
- `src/ui/main-panel.js` - Added `reason` parameter to `stopAutoExtract()`
- `src/ui/main-panel.js` - Added persistent logging logic in `stopAutoExtract()`
- `src/main.js` - Exported `viewStopLogs()` and `clearStopLogs()` utilities

**Storage Key:** `w2n_autoExtractStopLogs`

**Data Structure:**
```javascript
[
  {
    timestamp: "2025-11-19T08:30:15.123Z",
    reason: "User clicked Stop button",
    totalProcessed: 523,
    lastPageNum: 523,
    duplicateCount: 0,
    url: "https://docs.servicenow.com/..."
  },
  // ... up to 10 entries
]
```

## Common Stop Reasons

1. **"User clicked Stop button"** - Manual stop
2. **"❌ AutoExtract STOPPED: Same page content detected 3 times"** - Reached end of section or navigation loop
3. **"❌ AutoExtract STOPPED: Navigation to page X failed"** - Navigation failed after retries
4. **"❌ AutoExtract STOPPED: Next page button could not be found"** - End of book or navigation element missing
5. **"❌ AutoExtract STOPPED: Server appears to be offline"** - Proxy server not responding
6. **"❌ AutoExtract STOPPED: Page X shows 503 error after N attempts"** - ServiceNow server errors

## Troubleshooting

**Q: Logs are empty**
- AutoExtract may not have stopped yet (still running in background)
- Logs were manually cleared
- First run with v11.0.24+

**Q: Can't find stop logs**
- Ensure you're using v11.0.24 or later
- Check that `window.ServiceNowToNotion` is defined (userscript loaded)
- Try running on a ServiceNow docs page (userscript may not initialize on other sites)

**Q: Want to export logs**
- Copy the console output or use `JSON.parse(GM_getValue("w2n_autoExtractStopLogs"))` in console

## Future Enhancements

Potential improvements:
- Add export to file functionality
- Include extraction stats (success rate, errors, etc.)
- Track pattern of stops across sessions
- Email/notification when AutoExtract stops
- Visual indicator in panel showing last stop reason

## Version History

- **v11.0.24** - Initial implementation of persistent stop logging
