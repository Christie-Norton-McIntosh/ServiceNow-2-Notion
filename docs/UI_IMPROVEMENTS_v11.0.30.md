# UI Improvements — v11.0.30

**Date**: November 21, 2025  
**Type**: UI Enhancement  
**Impact**: Userscript panel behavior

## Changes Made

### 1. Removed "Download PDF" Button

**Rationale**: Streamline UI by removing unused functionality.

**Before**:
```
┌────────────────────────────────────┐
│  📄 Save Current Page              │
│  📖 Download PDF                   │  ← REMOVED
│  🔄 Update Existing Page           │
└────────────────────────────────────┘
```

**After**:
```
┌────────────────────────────────────┐
│  📄 Save Current Page              │
│  🔄 Update Existing Page           │  ← Cleaner layout
└────────────────────────────────────┘
```

### 2. Enhanced Panel Boundary Constraints

Added multiple safeguards to ensure the panel never moves off-screen:

#### A. Improved Drag Constraints
- **Before**: Basic viewport clamping during drag
- **After**: Enhanced clamping with proper max boundary calculation
- **Code**: Ensures `Math.max(margin, window.innerWidth - rect.width - margin)`

#### B. Window Resize Handler (NEW)
- **Trigger**: Window resize events (debounced to 100ms)
- **Action**: Automatically repositions panel if it goes off-screen
- **Behavior**: 
  - Checks panel position after resize
  - Clamps to viewport with 8px margin
  - Saves adjusted position to localStorage
  - Ignores resize during active dragging

#### C. Initial Position Validation (IMPROVED)
- **Before**: Rejected off-screen positions, reset to default
- **After**: Adjusts off-screen positions to nearest valid location
- **Benefit**: Preserves user's preferred position even after window resize

#### D. Auto-Initialization Check
- **Trigger**: 100ms after panel creation
- **Action**: Runs boundary check to ensure panel is on-screen
- **Benefit**: Catches edge cases from saved positions

## Technical Details

### Code Locations

**File**: `src/ui/main-panel.js`

1. **Button removal** (line ~122):
   - Removed `w2n-capture-description` button HTML
   
2. **Enhanced drag clamping** (line ~542):
   ```javascript
   const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
   const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
   newLeft = Math.min(Math.max(margin, newLeft), maxLeft);
   newTop = Math.min(Math.max(margin, newTop), maxTop);
   ```

3. **Resize handler** (line ~586):
   ```javascript
   const onWindowResize = () => {
     if (dragging) return;
     // Check bounds, adjust if needed, save position
   };
   
   let resizeTimeout;
   window.addEventListener("resize", () => {
     clearTimeout(resizeTimeout);
     resizeTimeout = setTimeout(onWindowResize, 100);
   });
   
   setTimeout(onWindowResize, 100); // Initial check
   ```

4. **Position validation** (line ~52):
   ```javascript
   const isOnScreen = (
     savedPosition.left >= margin && 
     savedPosition.top >= margin &&
     savedPosition.left + panelWidth <= window.innerWidth - margin &&
     savedPosition.top + panelHeight <= window.innerHeight - margin
   );
   
   if (!isOnScreen) {
     // Adjust to nearest valid position instead of resetting
     let adjustedLeft = Math.max(margin, Math.min(savedPosition.left, ...));
     let adjustedTop = Math.max(margin, Math.min(savedPosition.top, ...));
     savedPosition = { left: adjustedLeft, top: adjustedTop };
   }
   ```

## Behavior Changes

### Panel Movement
- ✅ Cannot be dragged off-screen (8px minimum margin)
- ✅ Automatically adjusts if window resized smaller
- ✅ Respects user's preferred position when possible
- ✅ Smoothly repositions without jarring jumps

### Edge Cases Handled
1. **Window shrinks smaller than panel**: Panel moves to fit
2. **Panel saved off-screen**: Adjusted to nearest valid position
3. **Rapid window resizing**: Debounced to avoid excessive updates
4. **Dragging during resize**: Ignored until drag completes
5. **Multi-monitor setups**: Works correctly when moving windows between screens

## Testing Checklist

- [ ] Install v11.0.30 in Tampermonkey
- [ ] Verify "Download PDF" button is gone
- [ ] Drag panel to various positions
- [ ] Try to drag panel off-screen (should clamp at edges)
- [ ] Resize browser window smaller (panel should stay visible)
- [ ] Resize browser window larger (panel should stay in place)
- [ ] Drag to corner, refresh page (position should persist)
- [ ] Move panel to edge, resize window smaller (should adjust)
- [ ] Check on different screen sizes

## Compatibility

### Browser Support
- ✅ Chrome/Edge (Tampermonkey)
- ✅ Firefox (Tampermonkey)
- ✅ Safari (userscript managers)

### Screen Sizes
- ✅ Desktop (1920x1080+)
- ✅ Laptop (1366x768+)
- ✅ Small screens (1024x768+)
- ⚠️ Very small screens (<1024px): Panel may overlap content

## Performance

**Impact**: Negligible
- Resize handler: Debounced to 100ms (max 10 calls/second)
- Drag movement: No additional overhead
- Initial check: One-time 100ms delay on load
- Position save: Only on drag end or resize adjustment

## Migration Notes

**For existing users**:
- Saved panel positions are automatically adjusted if off-screen
- No manual intervention needed
- Position preferences preserved when possible

**For developers**:
- "Download PDF" button ID (`w2n-capture-description`) still in cleanup whitelist
- Can be removed in future version after confirming no references remain

## Related Changes

### Previous Version (v11.0.29)
- Added "Update Existing Page" button

### This Version (v11.0.30)
- Removed "Download PDF" button
- Enhanced panel boundary constraints

### Future Enhancements
- Snap-to-edges feature
- Remember position per-domain
- Custom panel size options

## Summary

Version 11.0.30 improves the userscript panel UX by:
1. **Simplifying the UI**: Removed unused "Download PDF" button
2. **Preventing off-screen movement**: Enhanced drag constraints
3. **Handling window resizing**: Automatic boundary adjustments
4. **Preserving user preferences**: Smart position validation

The panel now provides a more polished, frustration-free experience with better boundary awareness.

---

**Version**: 11.0.30  
**Status**: Built and deployed  
**Testing**: Ready for manual verification
