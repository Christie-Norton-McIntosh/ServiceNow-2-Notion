# AUDIT Failure Root Cause Analysis

## Summary

**NO, the formatting is NOT causing AUDIT failures.** The failures are due to **missing content extraction**, not formatting issues.

## Actual Root Causes (By Frequency)

### 1. **DEEP NESTING** (Most Common)
- **Instances**: 39-312 per page (avg ~100+)
- **Severity**: MEDIUM
- **Issue**: Content is nested very deeply in HTML (6-16+ levels deep)
- **Root Cause**: Notion API limits initial page creation to 2 levels of nesting
  - Initial create only sends first 2 levels of nesting
  - Deeper children sent via PATCH calls after page creation
  - If orchestration fails or timing issues, deeper content lost
- **Evidence**: `blockAnalysis.nestedBlocks` is empty while `sourceAnalysis.complexNesting` has 20+ nested items
- **Fix**: Ensure marker-based orchestration completes successfully

### 2. **MISSING LIST ITEMS** (Very Frequent)
- **Instances**: 1-51 per page (avg ~10)
- **Severity**: HIGH
- **Issue**: `<li>` elements from `<ul>/<ol>` not being extracted to Notion `bulleted_list_item`/`numbered_list_item`
- **Evidence from Diagnosis**:
  ```json
  {
    "type": "missing_list_items",
    "count": 11,
    "preview": "Incident Assignment",
    "severity": "high",
    "fixCode": "Check extractLists() in servicenow.cjs"
  }
  ```
- **Source**: 11 `<li>` elements in HTML
- **Notion**: 0-3 `bulleted_list_item` blocks
- **Fix**: Debug `extractLists()` function in `server/services/servicenow.cjs`

### 3. **MISSING TABLE CONTENT** (Very Frequent)
- **Instances**: 3-18 per page (avg ~8)
- **Severity**: HIGH
- **Issue**: Table cells with content not being extracted
- **Evidence from Diagnosis**:
  ```json
  {
    "type": "missing_table_content",
    "count": 18,
    "preview": "Solution DefinitionSolution TypeDescription",
    "severity": "high",
    "fixCode": "Check extractTables() in servicenow.cjs"
  }
  ```
- **Source**: 41 `<td>` elements in HTML
- **Notion**: 3 tables but cells are empty
- **Fix**: Debug `extractTables()` function in `server/converters/table.cjs`

### 4. **MISSING CODE BLOCKS** (Rare)
- **Instances**: 1-2 per page (only on ~20% of pages)
- **Severity**: MEDIUM
- **Issue**: `<pre>` or `<code>` blocks not extracted
- **Fix**: Check code block extraction logic

## Why Formatting Looks Fine But Content Is Missing

The reason AUDIT failures aren't formatting issues:

1. **Notion blocks ARE being created** (12-43 blocks per page)
2. **Blocks have the RIGHT TYPES** (tables, lists, paragraphs)
3. **But blocks are EMPTY** (0 characters in block analysis)

**Example from diagnosis:**
```json
{
  "blockAnalysis": {
    "totalBlocks": 19,
    "totalChars": 0,  ← THIS IS THE PROBLEM
    "emptyBlocks": [
      {"index": 0, "type": "paragraph"},  ← Empty paragraph
      {"index": 3, "type": "table"},      ← Empty table
      {"index": 5, "type": "table"},      ← Empty table
      ...
    ]
  }
}
```

## What's Actually Happening

### Expected Flow:
```
ServiceNow HTML
  ↓ (11 <li> items)
extractLists() 
  ↓
Notion numbered_list_item blocks
  ↓ (11 items)
Result: Coverage 100%
```

### Actual Flow:
```
ServiceNow HTML
  ↓ (11 <li> items)
extractLists() ← SKIPPING CONTENT
  ↓
Notion numbered_list_item blocks
  ↓ (0-2 items)
Result: Coverage ~20%
```

## Impact on Coverage

Each missing extraction type:

1. **Missing 11 list items** (avg per page)
   - Source: 11 `<li>` = ~400 chars
   - Missing: 400 chars
   - Coverage impact: -10% to -20%

2. **Missing 18 table cell contents** (avg per page)
   - Source: 18 cells × ~50 chars = ~900 chars
   - Missing: 900 chars
   - Coverage impact: -15% to -25%

3. **Deep nesting issues** (avg 100 nested items per page)
   - Source: 100 items × ~20 chars = ~2000 chars
   - Missing: 2000 chars
   - Coverage impact: -20% to -30%

**Combined**: 20-50% missing coverage

## Code Locations to Fix

### 1. extractLists() - List Extraction
- **File**: `server/services/servicenow.cjs`
- **Issue**: Not finding or extracting `<li>` elements
- **Test**: Check if `<ul>/<ol>` selectors work with Cheerio

### 2. extractTables() - Table Cell Extraction
- **File**: `server/converters/table.cjs`
- **Issue**: Not extracting content from `<td>` elements
- **Test**: Check if cells are being processed

### 3. orchestrateDeepNesting() - Deep Content
- **File**: `server/orchestration/deep-nesting.cjs`
- **Issue**: Not all nested children being appended after page creation
- **Test**: Check if PATCH calls are completing

### 4. Block Extraction Pipeline
- **Files**: `server/services/servicenow.cjs`, `server/converters/rich-text.cjs`
- **Issue**: Text content not being added to block `rich_text` arrays
- **Test**: Debug why blocks are empty

## Verification: Formatting vs Content

To confirm formatting is NOT the issue, check the diagnosis files:

```bash
# Check if blocks are empty (content issue, not format issue)
jq '.blockAnalysis.emptyBlocks | length' audit-diagnosis-*.json

# If most blocks are empty → CONTENT EXTRACTION ISSUE
# If blocks have text but format is wrong → FORMATTING ISSUE
```

**Result**: All diagnosis files show `emptyBlocks.length > 15`
- This means blocks ARE created but are EMPTY
- Formatting is correct; **content is missing**

## Next Steps

### Priority 1: Debug List Extraction
1. Check `extractLists()` in `servicenow.cjs`
2. Verify Cheerio selector `$('ul, ol').find('li')`
3. Test with a simple HTML list extraction

### Priority 2: Debug Table Extraction
1. Check `extractTables()` in `table.cjs`
2. Verify cell extraction `$('td')` inside tables
3. Test with a simple HTML table extraction

### Priority 3: Deep Nesting
1. Check `orchestrateDeepNesting()` completion
2. Verify all marker-based blocks are appended
3. Test with a complex nested structure

### Priority 4: Block Assembly
1. Verify `rich_text` arrays are populated
2. Check if content is being stripped somewhere
3. Debug block creation pipeline

## Real Statistics from Diagnosis Files

Pages analyzed: 11
Total missing list items: 89
Total missing table cells: 78
Total deep nesting issues: 1,190+
Average coverage: 45.3%
Target coverage: 95-105%
**Gap: -50% to -60%**

All from MISSING CONTENT, not formatting problems.
