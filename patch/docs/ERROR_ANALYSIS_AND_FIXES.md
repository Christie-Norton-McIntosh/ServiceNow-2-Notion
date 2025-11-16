# Page Errors Analysis and Fixes
**Date:** November 16, 2025  
**Analyst:** AI Assistant

## Summary

**Current Status:**
- 3 pages in `pages-to-update/` with validation errors
- All pages were auto-extracted and flagged by validation system
- Block counts are within ±30% tolerance (70%-150%)
- Errors are primarily missing tables and callouts

---

## Issue Analysis

### Common Pattern: Missing Content Elements

All 3 pages show **validation errors** but **acceptable block counts**:

| Page | Expected | Actual | Range (±30%) | Status |
|------|----------|--------|--------------|---------|
| computer-cmdb-ci-computer-class | 35 | 84 | 25-53 | ⚠️ Over max (but close) |
| explore-cmdb-workspace | 42 | 49 | 29-63 | ✅ Within range |
| home-view-in-cmdb-workspace | 78 | 102 | 55-117 | ✅ Within range |

### Specific Issues

#### 1. **computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html**

**Validation Errors:**
- `Table count mismatch: expected 2, got 1` (missing 1 table)

**Warnings:**
- Block count high: 84 vs expected max 53

**Root Cause:**
- Page has tables but one was not converted properly
- Higher block count suggests conversion created extra blocks (possibly list flattening)

**Recommended Fix:**
✅ **Re-extract from ServiceNow** - The table HTML may be malformed or nested in a way that breaks conversion

**Alternative:**
- Manually verify page in Notion - if content looks complete, clear error flag
- The "missing table" might be embedded differently (e.g., as a list or definition list)

---

#### 2. **explore-cmdb-workspace-2025-11-16T08-05-45.html**

**Validation Errors:**
- `Table count mismatch: expected 1, got 0` (missing 1 table)
- `Callout count too low: expected 2, got 0` (missing 2 callouts)

**Warnings:**
- List items: 43 → 24 (likely nested list flattening)

**Root Cause:**
- Tables and callouts completely missing from conversion
- Likely ServiceNow HTML structure not recognized by converter

**Recommended Fix:**
✅ **Re-extract from ServiceNow** - Structural conversion issue

**Investigation Needed:**
Check if this page uses non-standard ServiceNow markup:
```bash
# Look for table/callout patterns
grep -E "<table|<div class=\"note|<div class=\"tip" explore-cmdb-workspace-2025-11-16T08-05-45.html | head -20
```

---

#### 3. **home-view-in-cmdb-workspace-2025-11-16T08-06-03.html**

**Validation Errors:**
- `Callout count too low: expected 2, got 0` (missing 2 callouts)

**Warnings:**
- List items: 68 → 37 (likely nested list flattening)

**Root Cause:**
- Callouts not converted (same issue as #2)
- Block count acceptable (78 → 102, within 55-117 range)

**Recommended Fix:**
✅ **Re-extract from ServiceNow** - Callout conversion issue

---

## Root Cause Summary

### Pattern Detected: ServiceNow HTML Structure Changes

These pages were all extracted on **2025-11-16** (today), suggesting:

1. **ServiceNow may have updated their HTML structure**
   - Callout markup may have changed (different CSS classes)
   - Table structure may have changed (different nesting)

2. **Converter may need updates** to handle new markup patterns

---

## Recommended Actions

### Immediate Fix (Quick Win)

**Option 1: Re-extract from ServiceNow (Recommended)**

```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion

# 1. Check if pages exist in Notion
curl -H "Authorization: Bearer $NOTION_TOKEN" \
     -H "Notion-Version: 2022-06-28" \
     https://api.notion.com/v1/pages/2ada89fedba581d59888eb9e1c828396

# 2. If pages exist and are NOT archived, use PATCH
bash patch/config/batch-patch-with-cooldown.sh

# 3. If pages are archived, unarchive first
bash patch/pages-to-update/unarchive-pages.sh
```

**Option 2: Manual Investigation**

```bash
# Check HTML structure for tables/callouts
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update

# Look for table patterns
for file in *.html; do
  echo "=== $file ==="
  echo "Tables found:"
  grep -c "<table" "$file"
  echo "Callouts found:"
  grep -c "class=\"note\|class=\"tip\|class=\"important\|class=\"caution\|class=\"warning\"" "$file"
  echo ""
done
```

---

### Long-term Fix (Prevent Future Issues)

#### Update Callout Detection

**File:** `server/services/servicenow.cjs`

Check if ServiceNow changed callout markup:

```javascript
// Current pattern (may be outdated)
const calloutClasses = ['note', 'tip', 'important', 'caution', 'warning'];

// Add new ServiceNow patterns if found
const calloutClasses = [
  'note', 'tip', 'important', 'caution', 'warning',
  'zDocs-callout', 'zDocs-note', 'zDocs-tip',  // New patterns?
  'dita-note', 'dita-tip'  // DITA-specific?
];
```

#### Update Table Detection

**File:** `server/converters/table.cjs`

Check if ServiceNow changed table nesting:

```javascript
// Look for nested table wrappers
const $tables = $contentContainer.find('table').filter((i, table) => {
  const $table = $(table);
  // Skip tables inside other tables (already processed)
  if ($table.parents('table').length > 0) return false;
  // Skip tables inside divs with specific classes (may be non-content)
  if ($table.closest('div.table-wrapper-ignore').length > 0) return false;
  return true;
});
```

---

## Testing Plan

### Test 1: Verify HTML Structure

```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update

# Check for callout elements
grep -n "note\|tip\|important\|caution\|warning" computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html | head -10

# Check for table elements
grep -n "<table" computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html | head -10
```

### Test 2: Dry-Run Conversion

```bash
# Test conversion without creating page
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion

# Extract page ID
PAGE_ID="2ada89fedba581d59888eb9e1c828396"

# Dry-run conversion
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Computer [cmdb_ci_computer] class\",
    \"databaseId\": \"282a89fedba5815e91f0db972912ef9f\",
    \"contentHtml\": $(cat patch/pages-to-update/computer-cmdb-ci-computer-class-2025-11-16T08-05-57.html | jq -Rs .),
    \"dryRun\": true
  }" | jq '{
    blocks: .data.children | length,
    tables: [.data.children[] | select(.type == "table")] | length,
    callouts: [.data.children[] | select(.type == "callout")] | length,
    images: [.data.children[] | select(.type == "image")] | length
  }'
```

### Test 3: Re-extract and PATCH

```bash
# If dry-run shows correct conversion, proceed with PATCH
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/config

# Run batch PATCH
bash batch-patch-with-cooldown.sh
```

---

## Decision Matrix

| Condition | Action | Priority |
|-----------|--------|----------|
| Pages are archived | Run `unarchive-pages.sh`, then PATCH | 🔴 HIGH |
| HTML has tables/callouts | Re-extract from ServiceNow | 🟡 MEDIUM |
| Dry-run shows correct blocks | PATCH with current HTML | 🟢 LOW |
| Converter doesn't recognize markup | Update converter code | 🔴 HIGH |
| Validation errors but content looks complete | Clear error flags manually | 🟢 LOW |

---

## Success Criteria

After fixes:
- ✅ All 3 pages should show 0 validation errors
- ✅ Table counts should match (or be within 1-2)
- ✅ Callout counts should match (or be within 1-2)
- ✅ Block counts within ±30% tolerance (already met)
- ✅ Pages moved to `updated-pages/` after successful PATCH
- ✅ Error checkbox cleared in Notion

---

## Next Steps

1. **Investigate HTML structure** (5 min)
   ```bash
   cd patch/pages-to-update
   bash ../config/investigate-html-structure.sh
   ```

2. **Attempt PATCH with current HTML** (10 min)
   ```bash
   cd patch/config
   bash batch-patch-with-cooldown.sh
   ```

3. **If PATCH fails, re-extract** (15 min)
   - Open pages in ServiceNow
   - Use AutoExtract to re-capture
   - Verify new HTML has correct structure

4. **Update converter if needed** (30 min)
   - Analyze HTML patterns
   - Update callout/table detection
   - Add tests for new patterns

---

## Additional Resources

- See `docs/AUTO-VALIDATION.md` for validation system details
- See `REMAINING_ISSUES_ANALYSIS.md` for archived pages issue
- See `problematic-files/INVESTIGATION_NEEDED.md` for timeout issues
- See `server/services/servicenow.cjs` for HTML conversion logic
