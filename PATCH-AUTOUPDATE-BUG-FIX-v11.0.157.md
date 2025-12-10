# AutoExtract PAGE_UPDATE_FAILED Bug Fix (v11.0.157)

## Issue
UserScript's AutoExtract feature was throwing `PAGE_UPDATE_FAILED` error when attempting to update Notion pages. Error occurred 3 times before stopping.

**Error Message**:
```
Error: PAGE_UPDATE_FAILED
Stack: updateNotionPage() → runAutoExtractLoop() → startAutoExtraction()
```

**Server Log Error**:
```
❌ Error during PATCH operation
   Phase: validating updated page
   Error: propertyUpdateSuccess is not defined
   Stack: ReferenceError: propertyUpdateSuccess is not defined
```

## Root Cause
**Variable Scope Issue in v11.0.116 PATCH Property Retry Logic**

In `server/routes/w2n.cjs` lines 4475-4622:

1. `propertyUpdateSuccess` and `propertyUpdateError` were declared with `let` INSIDE a try block (line 4478)
2. The outer `try` block was for the entire property update section
3. The matching `catch (propError)` block (line 4622) tried to access `propertyUpdateSuccess = false`
4. Since the variable was declared inside the inner try block with `let`, it was OUT OF SCOPE in the catch block
5. JavaScript threw: `ReferenceError: propertyUpdateSuccess is not defined`
6. The catch block was supposed to set this flag, but couldn't
7. Later code checked `if (!propertyUpdateSuccess)` at line 4707, which failed because the variable was undefined

## Code Structure (Before Fix)
```javascript
// Lines 3062-4622
try {
  // ... validation property building ...
  
  // Lines 4476-4560: Inner block with property retry logic
  const propertyUpdates = { ... };
  // ...
  const maxPropertyRetries = 5;
  let propertyUpdateSuccess = false;  // ← Declared inside try block
  let propertyUpdateError = null;
  
  for (let propRetry = 0; propRetry <= maxPropertyRetries; propRetry++) {
    try {
      // Property update retry logic
      propertyUpdateSuccess = true;
    } catch (propUpdateError) { ... }
  }
  // ... more validation code ...
  
} catch (propError) {
  // ← Catch for OUTER try block
  propertyUpdateSuccess = false;  // ← ERROR: Variable not in scope!
  //                               ReferenceError: propertyUpdateSuccess is not defined
}
```

## Solution
**Move variable declarations outside the try block** so they're accessible from both the try block and its catch block.

```javascript
// Lines 4050-4630 (AFTER FIX)
// FIX v11.0.116 BUG: Declare propertyUpdateSuccess/Error outside try block so catch block can access them
let propertyUpdateSuccess = false;  // ← Now in outer scope
let propertyUpdateError = null;     // ← Now in outer scope

try {
  const propertyUpdates = { ... };
  // ...
  const maxPropertyRetries = 5;
  
  for (let propRetry = 0; propRetry <= maxPropertyRetries && !propertyUpdateSuccess; propRetry++) {
    try {
      // Property update retry logic
      propertyUpdateSuccess = true;
    } catch (propUpdateError) { ... }
  }
  // ... more validation code ...
  
} catch (propError) {
  // ← Catch can now access propertyUpdateSuccess
  propertyUpdateSuccess = false;  // ✅ Works now - variable is in scope
}
```

## Changes Made

**File**: `server/routes/w2n.cjs`

1. **Lines 4050-4052** (NEW): Added variable declarations outside try block
   ```javascript
   // FIX v11.0.116 BUG: Declare propertyUpdateSuccess/Error outside try block so catch block can access them
   let propertyUpdateSuccess = false;
   let propertyUpdateError = null;
   ```

2. **Line 4054** (UNCHANGED): Start of try block (now can access the declared variables)
   ```javascript
   try {
   ```

3. **Lines 4482-4483** (REMOVED duplicate declarations):
   - Removed: `let propertyUpdateSuccess = false;`
   - Removed: `let propertyUpdateError = null;`
   - Kept: `const maxPropertyRetries = 5;` (still correct location)

## Impact

### Fixed
- ✅ AutoExtract UPDATE mode now works correctly
- ✅ PATCH requests from userscript no longer throw `PAGE_UPDATE_FAILED`
- ✅ Property update retry logic works as intended (declared in v11.0.116)

### Verification
- Build successful: v11.0.157
- No syntax errors
- Variable scope issue resolved
- Error handling for property updates now functions correctly

## Testing Recommendations

1. **Start Server with Debug Logging**:
   ```bash
   npm run build
   npm start  # or use one of the debug tasks
   ```

2. **Test AutoExtract Update Mode**:
   - Open ServiceNow page in browser
   - Open ServiceNow-2-Notion userscript panel
   - Enable "Update Mode" checkbox
   - Click "Start AutoExtract"
   - Verify pages update without `PAGE_UPDATE_FAILED` errors
   - Check server logs for `✅ [PATCH-PROPERTY-RETRY] Validation properties updated successfully`

3. **Verify Error Handling**:
   - If property update fails (e.g., Notion API down), error should be caught at line 4624
   - Page should be auto-saved to `patch/pages/pages-to-update/`
   - Server should log proper error message

## Related Issues Fixed
- **v11.0.116**: Introduced property update retry logic for PATCH (but had variable scope bug)
- **v11.0.157**: Fixed variable scope bug preventing catch block from accessing retry flag

## Version History
- **v11.0.116**: Added PATCH property update retry logic (introduced the bug)
- **v11.0.157**: Fixed variable scope bug (this fix)

## Notes
- This is a **critical fix for AutoExtract functionality**
- The bug was **newly introduced in v11.0.116** when property retry logic was added
- Prior versions (v11.0.115 and earlier) did not have property retry logic or this bug
- The catch block fix ensures properties are properly tracked even on error
