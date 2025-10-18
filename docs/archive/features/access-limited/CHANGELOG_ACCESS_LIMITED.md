# AutoExtract Access Limited Handling

## Overview
Added intelligent handling for pages showing "Access to this content is limited to authorized users." message during AutoExtract operations. The script will:

1. **Attempt to reload** the page up to 3 times to regain access
2. **Skip the page** if access remains limited after reload attempts
3. **Continue to the next page** automatically

## Changes Made

### 1. New Detection Function: `isPageAccessLimited()`
**File**: `src/ui/main-panel.js`

Added a new function to detect when a page shows the access limited message:

```javascript
function isPageAccessLimited() {
  const pageTitle = document.title;
  const limitedMessage = "Access to this content is limited to authorized users.";

  if (pageTitle === limitedMessage || pageTitle.includes(limitedMessage)) {
    debug(`🔒 Detected access limited page: "${pageTitle}"`);
    return true;
  }

  // Also check for h1 with this message
  const h1Elements = document.querySelectorAll("h1");
  for (const h1 of h1Elements) {
    if (h1.textContent && h1.textContent.includes(limitedMessage)) {
      debug(`🔒 Detected access limited message in h1: "${h1.textContent}"`);
      return true;
    }
  }

  return false;
}
```

### 2. Enhanced `runAutoExtractLoop()`
**File**: `src/ui/main-panel.js`

Added reload and skip logic when access limited message is detected:

- **Detection**: Checks for the access limited message at the start of each page extraction
- **Auto-Reload**: Automatically reloads the page up to 3 times to try to regain access
- **Wait & Stabilize**: Waits 15 seconds for the page to load after each reload
- **Smart Skip**: If access limited persists after reloads, skips the page (does NOT save to Notion)
- **Continue Flow**: Automatically navigates to the next page
- **Graceful Error**: Shows alert only if next button cannot be found

## Behavior Flow

```
Start Processing Page
  ↓
Check for "Access to this content is limited..." message
  ├─ YES → Attempt reload (up to 3 times)
  │         ├─ Wait 15 seconds for load
  │         ├─ Check again
  │         └─ Still limited? → Skip page
  │            ├─ Navigate to next page
  │            └─ Continue AutoExtract
  │
  └─ NO → Check for 503 error (existing logic)
          ├─ Reload if needed
          └─ Extract and save to Notion
```

## Example Scenarios

### Scenario 1: Access Regained After Reload
```
🔒 Access limited detected, attempting reload 1/3...
⚠️ Page access limited, reloading (attempt 1/3)...
✅ Page reloaded successfully
✅ Access regained, proceeding with extraction...
✅ Page saved to Notion
```

### Scenario 2: Access Limited Persists
```
🔒 Access limited detected, attempting reload 1/3...
⚠️ Page access limited, reloading (attempt 1/3)...
🔒 Access limited detected, attempting reload 2/3...
⚠️ Page access limited, reloading (attempt 2/3)...
🔒 Access limited detected, attempting reload 3/3...
⚠️ Page access limited, reloading (attempt 3/3)...
🔒 Access limited persists, skipping page 5...
⊘ Skipped page 5: Access limited (after 3 reloads)
🔍 Finding next page button after skip...
✅ Navigating to page 6...
```

### Scenario 3: During Multi-Page Extraction
```
Processing page 1 ✅ Saved to Notion
Processing page 2 [reload attempt] ⊘ Skipped (Access Limited)
Processing page 3 ✅ Saved to Notion
Processing page 4 [reload attempt] ⊘ Skipped (Access Limited)
Processing page 5 ✅ Saved to Notion
```

## Toast Notifications

### During Reload Attempts
- `⚠️ Page access limited, reloading (attempt 1/3)...`
- `⚠️ Page access limited, reloading (attempt 2/3)...`
- `⚠️ Page access limited, reloading (attempt 3/3)...`

### When Skipping After Failed Reloads
- `⊘ Skipped page 5: Access limited (after 3 reloads)`

## Debug Messages

Console output (F12 → Console) when access limited is detected:

```
🔒 Access limited detected, attempting reload 1/3...
⏳ Access limited reload 1 failed, waiting 5s before retry...
🔒 Access limited persists after 3 reload attempts, skipping page 5...
========================================
⊘ Skipped page 5 due to persistent access limited
🎯 Now navigating to page 6...
========================================

🔍 Finding next page button after skip...
✅ Found next page button after skip, preparing to click...
```

## Technical Details

- **Detection**: Checks both page title and h1 elements
- **Reload timeout**: 15 seconds per attempt
- **Total reload attempts**: 3
- **Wait between reloads**: 5 seconds
- **Feedback**: UI button text updates during reload attempts
- **Logging**: All actions logged to console with debug output
- **Skip behavior**: Page is NOT extracted or saved; immediately moves to next page
- **Navigation**: Uses existing next-page-button finding logic

## Key Differences from Other Error Handling

Unlike 503 errors that **stop** the process if they persist:
- Access limited pages are **skipped** (not saved to Notion)
- AutoExtract **continues** to the next page automatically
- Only stops if the **next page button cannot be found**

## Version
- Updated in: v9.2.0
- Build: `npm run build` regenerates `dist/ServiceNow-2-Notion.user.js`

## Installation
After changes are tested and committed:
1. Run `npm run build` to generate the updated userscript
2. Update the userscript in Tampermonkey with the new dist file
3. Test on ServiceNow pages that may trigger access limited messages

## Testing Checklist

- [x] Build completes without errors
- [x] Function detects access limited message
- [x] Page reloads automatically (up to 3 times)
- [x] After reloads, page is skipped if still limited
- [x] Toast notifications show reload attempts
- [x] Toast notification shows skip after reloads
- [x] Next page button is found and clicked after skip
- [x] AutoExtract continues to next page without stopping
- [x] Error handling if next button not found
