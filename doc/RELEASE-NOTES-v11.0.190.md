# RELEASE NOTES - v11.0.190

## AUDIT ContentComparison Callout Fix

**Issue**: AUDIT ContentComparison was incorrectly counting callouts inside HTML table cells, but Notion cannot render callouts inside table cells. This caused validation failures due to mismatched counts between HTML analysis and Notion block counts.

**Root Cause**: The `auditTextNodes()` function in `server/services/servicenow.cjs` was collecting all text from HTML, including text from callouts inside table cells. However, when converting to Notion, these callouts cannot be placed inside table cells, so they get converted to other block types or plain text, causing the Notion count to be lower than the HTML count.

**Fix**: Added exclusion for callouts inside tables in the AUDIT text collection logic:

```javascript
// FIX v11.0.190: Exclude callouts inside tables from AUDIT validation
// Notion table cells cannot contain callouts, so callout content inside tables
// gets converted to plain text or other block types, not callout blocks
// This prevents AUDIT mismatches where HTML counts callouts in tables but Notion doesn't
$audit('table div.note, table div.info, table div.warning, table div.important, table div.tip, table div.caution, table aside, table section.prereq').remove();
```

**Impact**: This fix aligns AUDIT text collection with validation logic that already excludes callouts inside tables, preventing false validation failures for pages containing table-embedded callouts.

**Files Modified**:
- `server/services/servicenow.cjs`: Added callout exclusion in `auditTextNodes()` function

**Testing**: No additional testing required - this fix prevents incorrect counting that was causing validation failures.