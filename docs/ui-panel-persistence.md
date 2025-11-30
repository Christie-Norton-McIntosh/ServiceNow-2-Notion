# UI Panel Position Persistence (v11.0.3)

## Problem
The UI panel position didn't persist after page reload, causing it to always appear at the top-right corner (20px, 20px). This could cover ServiceNow navigation buttons on the right side of the screen, preventing AutoExtract from clicking the "Next" button during multi-page operations.

## Solution
Added localStorage persistence for the panel position:

### 1. Save Position on Drag End
When the user finishes dragging the panel, the position is saved to localStorage:
```javascript
localStorage.setItem('w2n-panel-position', JSON.stringify({
  left: rect.left,
  top: rect.top
}));
```

### 2. Restore Position on Page Load
When `injectMainPanel()` is called, it tries to restore the saved position:
- Retrieves saved position from localStorage
- Validates position is still on-screen (with 8px margin)
- If valid, applies saved position
- If invalid or doesn't exist, uses default top-right position
- If saved position is off-screen, removes it from localStorage

### 3. Reset Button
Added a "↗️" reset button to the panel header:
- Resets panel to default top-right position (20px, 20px)
- Clears saved position from localStorage
- Shows success toast notification
- Useful if panel gets stuck or positioned awkwardly

## Technical Details

### Files Modified
- `src/ui/main-panel.js`:
  - Lines ~30-100: Added position restoration logic in `injectMainPanel()`
  - Lines ~512-530: Added position save in `onPointerUp()` drag handler
  - Lines ~111-113: Added reset button to header HTML
  - Lines ~187-207: Added reset button click handler

### localStorage Key
- **Key**: `w2n-panel-position`
- **Value**: JSON object with `{ left: number, top: number }`

### Validation Logic
Position is validated on restore to ensure it's visible:
- Left edge must be >= 8px from left viewport edge
- Top edge must be >= 8px from top viewport edge
- Right edge must be <= viewport width - 8px
- Bottom edge must be <= viewport height - 8px

If any validation fails, the saved position is discarded.

## User Experience
1. **First load**: Panel appears at default top-right corner
2. **Drag panel**: User drags panel to preferred position
3. **Navigate/reload**: Panel remembers position and appears where user left it
4. **Reset**: Click ↗️ button to restore default position anytime

## Benefits for AutoExtract
- User can move panel away from navigation buttons before starting AutoExtract
- Panel stays in chosen position throughout multi-page extraction
- Prevents panel from blocking "Next" button clicks
- Improves reliability of automated navigation

## Testing Checklist
- [ ] Panel appears at default position on first load
- [ ] Dragging panel saves position to localStorage
- [ ] Position persists after page reload
- [ ] Position persists when navigating to different ServiceNow pages
- [ ] Reset button restores default position
- [ ] Off-screen positions are discarded on load
- [ ] Panel doesn't block navigation during AutoExtract
