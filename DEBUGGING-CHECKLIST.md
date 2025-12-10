# AUDIT Failure Debugging Checklist

## Answer to Your Question

**Is formatting causing all AUDIT failures?**

### ❌ NO

**Evidence:**
- ✅ All block TYPES are correct (tables, lists, paragraphs, headings)
- ✅ All blocks ARE being created
- ❌ But all blocks are **EMPTY** (0 characters)
- ❌ **Content is not being extracted**, not formatting

**The diagnosis files show:**
```
"totalChars": 0,          ← Empty blocks
"emptyBlocks": [19]       ← 19 out of 19 blocks are empty
"missing_list_items": 11  ← Content that should be there
"missing_table_content": 18
```

---

## What's Actually Broken

### 🔴 Critical (Must Fix)

**1. List Extraction** (11 items missing per page avg)
- `<ul>/<ol>` → Notion list items NOT working
- File: `server/services/servicenow.cjs`
- Function: `extractLists()`
- Test: Do list items appear in extracted content?

**2. Table Content** (18 cells missing per page avg)
- `<td>` content → Notion tables are EMPTY
- File: `server/converters/table.cjs`
- Function: `extractTables()`
- Test: Do table cells have content?

**3. Block Text Assembly** (All blocks empty)
- Content → block `rich_text` arrays NOT populated
- File: `server/services/servicenow.cjs`
- Function: Main block assembly loop
- Test: Are `rich_text` arrays being filled?

### 🟡 High (Should Fix)

**4. Deep Nesting** (100+ items missing per page)
- Nested content past 2 levels → NOT appended
- File: `server/orchestration/deep-nesting.cjs`
- Function: `orchestrateDeepNesting()`
- Test: Are nested blocks being appended after page creation?

---

## Quick Debug Steps

### Step 1: Check if Lists Are Being Extracted

```bash
# Check a diagnosis file
jq '.gaps[] | select(.type == "missing_list_items")' \
  patch/logs/audit-diagnosis-*.json | head -1
```

Expected output:
```json
{
  "type": "missing_list_items",
  "count": 11,
  "preview": "Some list item text"
}
```

If you see this → **Lists are NOT being extracted**

### Step 2: Check if Tables Are Getting Content

```bash
# Check table issues
jq '.gaps[] | select(.type == "missing_table_content")' \
  patch/logs/audit-diagnosis-*.json | head -1
```

Expected output:
```json
{
  "type": "missing_table_content",
  "count": 18,
  "preview": "Cell content here"
}
```

If you see this → **Table content is NOT being extracted**

### Step 3: Check Block Emptiness

```bash
# Count blocks by how empty they are
jq '.blockAnalysis.emptyBlocks | length' \
  patch/logs/audit-diagnosis-*.json | sort | uniq -c
```

Expected output:
```
  11 19   ← 11 files with 19 empty blocks out of 19
```

If you see high numbers → **Blocks are being created but are EMPTY**

### Step 4: Check Total Characters

```bash
# Check if blocks have ANY text
jq '.blockAnalysis.totalChars' patch/logs/audit-diagnosis-*.json
```

Expected (broken):
```
0
0
0
0
```

If you see all 0s → **NO TEXT IS BEING ADDED TO BLOCKS**

---

## Diagnosis File Summary

Run this to get an overview:

```bash
jq '{
  page: .pageTitle,
  coverage: .coverage,
  missing: [.gaps[].type] | unique,
  emptyBlockCount: .blockAnalysis.emptyBlocks | length,
  totalBlocks: .blockAnalysis.totalBlocks
}' patch/logs/audit-diagnosis-*.json | head -50
```

This will show you the pattern of what's missing on each page.

---

## Where Content Gets Lost (Likely Points)

### 📍 Point 1: HTML → Extraction
```
ServiceNow HTML
  ↓
cheerio.load()
  ↓ (should find <li>, <td>, <p>, etc.)
HTML Elements Found
  ↓
SOMEWHERE CONTENT IS LOST ← Debug here
```

**Check**: Does `extractLists()` find any `<li>` elements?

### 📍 Point 2: Elements → Blocks
```
<li>Item 1</li>
<li>Item 2</li>
  ↓
Extract as blocks
  ↓ (should create numbered_list_item with rich_text)
numbered_list_item block
  ↓
CONTENT NOT IN rich_text? ← Debug here
```

**Check**: Are `rich_text` arrays being populated?

### 📍 Point 3: Blocks → Notion API
```
Notion block {
  type: "numbered_list_item",
  numbered_list_item: {
    rich_text: [
      { text: { content: "Item 1" } }  ← Should be here
    ]
  }
}
  ↓
API Call to notion.pages.create()
  ↓
EMPTY BLOCK IN NOTION? ← Check API payload
```

**Check**: What does the actual API payload look like?

---

## Debugging Commands

### See what's in one diagnosis file
```bash
jq '.gaps' patch/logs/audit-diagnosis-*.json | head -100
```

### See what types of content are missing across all pages
```bash
jq -r '.gaps[].type' patch/logs/audit-diagnosis-*.json | sort | uniq -c
```

### See severity/priority of fixes needed
```bash
jq -r '.recommendations[] | "\(.priority): \(.action)"' \
  patch/logs/audit-diagnosis-*.json | sort | uniq -c
```

### See which functions need fixing
```bash
jq -r '.gaps[].fixCode' patch/logs/audit-diagnosis-*.json | sort | uniq
```

Output will show:
```
Check extractLists() in servicenow.cjs
Check extractTables() in servicenow.cjs
Use SN2N_STRICT_ORDER=1 for strict DOM traversal
```

---

## What NOT to Fix

❌ Don't mess with formatting (Notion handles that)
❌ Don't change block structure (types are correct)
❌ Don't modify property mappings (that's working)
❌ Don't touch PATCH logic (that's working)

---

## What TO Fix

✅ Fix `extractLists()` to actually extract list items
✅ Fix `extractTables()` to extract table cell content
✅ Fix block assembly to populate `rich_text` arrays
✅ Fix deep nesting orchestration to append nested content
✅ Test with simple HTML examples first
✅ Verify with diagnosis files after each fix

---

## Success Criteria

Once fixed, diagnosis files should show:
- Coverage: 95-105% ✅ (not 40-60%)
- Empty blocks: 0 ✅ (not 19/19)
- Total chars: > 5000 ✅ (not 0)
- No missing content gaps ✅

**Current state: 40-60% coverage** ← All from missing content extraction
**Target state: 95-105% coverage** ← All extracted content in Notion
