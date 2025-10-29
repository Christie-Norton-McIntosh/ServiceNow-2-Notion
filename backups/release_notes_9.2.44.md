# Release Notes - Version 9.2.44

**Release Date:** October 28, 2025

## Summary
This release adds inline code formatting for role names in prerequisite sections, completing the formatting enhancements for ServiceNow documentation extraction.

## What's New

### Role Name Formatting
- **Single-word role names** (admin, sam, asset) now appear as inline code in "Role required:" text
- Previously, only roles with underscores (e.g., `asset_admin`) were formatted as code
- Pattern matching added to `parseRichText` function in `servicenow.cjs`

## Technical Details

### Changes Made
- **File Modified:** `server/services/servicenow.cjs`
- **Location:** Line ~516 (before multi-word identifier pattern)
- **Pattern Added:** `/\b(Role required:)\s+([a-z_]+(?:,\s*[a-z_]+)*)/gi`
- **Functionality:** Detects "Role required:" followed by comma-separated role names and wraps each in `__CODE_START__` / `__CODE_END__` markers

### Implementation Notes
- Pattern placed in `parseRichText` function (NOT `convertRichTextBlock` in rich-text.cjs)
- Runs before the multi-word technical identifier pattern to catch single-word roles
- Supports multiple comma-separated roles: "Role required: admin, asset, sam"
- Debug logging added to trace pattern matching

## Example Output

**Before:**
```
Role required: admin
```

**After:**
```
Role required: `admin`
```

## Context

This fix addresses the final formatting issue in the ServiceNow-to-Notion extraction workflow:
1. ✅ Nav elements properly extracted and ordered
2. ✅ Note callouts in tables with "Note:" labels preserved
3. ✅ Brackets/parentheses removed from inline code
4. ✅ Prerequisite text nodes captured ("Role required: sam")
5. ✅ UI chrome (dropdowns, export buttons) filtered out
6. ✅ **Role names formatted as inline code** ← THIS RELEASE

## Testing
- Tested with "Request Predictive Intelligence for Incident Management" page
- Verified role name "admin" formatted correctly
- Confirmed pattern logging in server output
- Validated no regression on multi-word technical identifiers

## Files Changed
- `server/services/servicenow.cjs` - Added role pattern matching

## Compatibility
- Userscript version: 9.2.44
- Server version: Compatible with all 9.2.x clients
- No breaking changes

## Known Issues
None

---

**Previous Release:** [9.2.4](./release_notes_9.2.4.md)
