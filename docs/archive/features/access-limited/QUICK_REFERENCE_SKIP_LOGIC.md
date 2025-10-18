# Quick Reference: Access Limited Page Handling

## What It Does

When running AutoExtract, if a page displays:
```
"Access to this content is limited to authorized users."
```

The script will:
1. ✅ **Reload** the page (up to 3 times) to try to regain access
2. ✅ **Check again** after each reload
3. ✅ **If access regained**: Extract and save the page to Notion
4. ✅ **If access still limited** after 3 reloads: Skip the page and move to next
5. ✅ **Continue** AutoExtract automatically

## User Experience

### Case 1: Access Regained After Reload ✅
```
Processing page 2...
⚠️ Page access limited, reloading (attempt 1/3)...
✅ Page loaded, checking access...
✅ Access regained! Extracting and saving to Notion...
```

### Case 2: Access Remains Limited (Skip) ✅
```
Processing page 5...
⚠️ Page access limited, reloading (attempt 1/3)...
⚠️ Page access limited, reloading (attempt 2/3)...
⚠️ Page access limited, reloading (attempt 3/3)...
⊘ Skipped page 5: Access limited (after 3 reloads)
Finding next page button...
✅ Navigating to page 6...
```

### Multi-Page Extraction Example
```
Page 1 ✅ Saved to Notion
Page 2 [reload attempt] ✅ Saved to Notion (access regained)
Page 3 ✅ Saved to Notion
Page 4 [reload attempts] ⊘ Skipped (access limited)
Page 5 ✅ Saved to Notion
Page 6 [reload attempts] ⊘ Skipped (access limited)
Page 7 ✅ Saved to Notion
```

## Toast Notifications You'll See

### During Reload Attempts
```
⚠️ Page access limited, reloading (attempt 1/3)...
⚠️ Page access limited, reloading (attempt 2/3)...
⚠️ Page access limited, reloading (attempt 3/3)...
```

### When Skipping After Failed Reloads
```
⊘ Skipped page 5: Access limited (after 3 reloads)
```

### Normal Extraction
```
Extracting page [n] of [total]...
Saving to Notion...
```

## Button Status Updates

During processing, the button text shows:
- `Reloading for access (1/3)...` - During reload attempt
- `Reloading for access (2/3)...` - During second attempt
- `Reloading for access (3/3)...` - Final reload attempt
- `Skipped page 5 (access limited)` - After skips
- `Loading page 6/500...` - After navigation
- `Processing 7/500...` - During extraction

## How to Use

### Starting AutoExtract
1. Click "Start AutoExtract" button in the main panel
2. AutoExtract will process pages sequentially
3. Access-limited pages are handled automatically (reload then skip if needed)
4. Accessible pages are saved to Notion
5. Process continues until max pages reached

### Monitoring Progress
- **Toast notifications**: Show reload and skip events
- **Button text**: Shows current page and status
- **Console logs**: F12 → Console for detailed debug info

### If Something Goes Wrong

If the next page button cannot be found:
```
❌ AutoExtract STOPPED: Next page button could not be found after skipping page 5.

Total pages processed: 4
```

Then:
1. Check the next page button selector in settings
2. Manually navigate to the next page
3. Click "Start AutoExtract" to resume (or start fresh)

## Technical Details

### Reload Strategy
- **Detection**: Checks page title and h1 elements
- **Max attempts**: 3 reloads total
- **Timeout per reload**: 15 seconds
- **Wait between reloads**: 5 seconds
- **Total wait time**: ~50 seconds maximum per page

### Skip Behavior
- **When**: After 3 reload attempts still show access limited
- **Action**: Page is NOT saved to Notion
- **Next step**: Automatically finds and clicks next button
- **Continue**: AutoExtract resumes to next page

### Error Handling
- **Only stops if**: Next page button cannot be found
- **Shows**: Alert with total pages processed
- **Recoverable**: You can resume manually

## Console Debug Output

To see detailed logs:
1. Open browser console: F12
2. Click "Console" tab
3. Watch for messages like:

```
� Access limited detected, attempting reload 1/3...
✅ Access regained! Proceeding with extraction...
```

or

```
🔒 Access limited persists after 3 reload attempts, skipping page 5...
🔍 Finding next page button after skip...
✅ Found next page button after skip
```

## Configuration

No new settings required:
- Works automatically with existing AutoExtract setup
- Uses same next-page-button selector
- Integrates with existing error recovery (503 handling)

## Performance

- **Impact**: Minimal - adds ~50 seconds per access-limited page
- **Benefit**: Graceful recovery without manual intervention
- **Result**: Cleaner Notion database with only accessible content

## Related Features

Works alongside:
- ✅ 503 error auto-recovery (unchanged)
- ✅ Page navigation detection
- ✅ Content extraction and saving
- ✅ Stop button to pause AutoExtract
- ✅ Max pages limit

## Example Log

Complete example in console:

```
📄 Processing page 5 of 500...
🔒 Access limited detected, attempting reload 1/3...
⏳ Access limited reload 1 failed, waiting 5s before retry...
🔒 Access limited detected, attempting reload 2/3...
⏳ Access limited reload 2 failed, waiting 5s before retry...
🔒 Access limited detected, attempting reload 3/3...
⏳ Access limited reload 3 failed, waiting 5s before retry...
🔒 Access limited persists after 3 reload attempts, skipping page 5...
========================================
⊘ Skipped page 5 due to persistent access limited
🎯 Now navigating to page 6...
========================================

🔍 Finding next page button after skip...
✅ Found next page button after skip, preparing to click...
👆 Clicking next page button to navigate to page 6...
✅ Click executed, waiting for page to navigate...
⏳ Waiting for navigation to page 6...
✅ Navigation detected! Page 6 URL loaded.
⏳ Waiting for page 6 content to load...
⏳ Stabilizing page 6...
✅ Page 6 fully loaded and ready for capture!

========================================
🔄 Looping back to capture page 6...
========================================
```

## Version
- Available in: v9.2.0+
- Built: October 16, 2025
- Status: ✅ Ready for production
