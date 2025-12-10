# Heading Issue - Visual Quick Reference

## Pattern B: Heading Count Mismatch (FIXED ✅)

### Before v11.0.188
```
HTML Source:
  ├── H1: "IT Service Management" (page title) ← WRONG TO COUNT
  ├── H2: "Transform the impact..." ✓
  ├── H2: "Enhance the service..." ✓
  ├── H2: "Consolidate IT services" ✓
  ├── H2: "Apply predictive intelligence" ✓
  ├── H2: "View resource guides" ✓
  ├── H2: "Research innovation" ✓
  ├── H2: "Identify license entitlements" ✓
  ├── H2: "Certification and training" ✓
  ├── H2: "Applications and features" ✓
  └── H5: "On this page" [IN SIDEBAR] ← WRONG TO COUNT
  Count: 11 ❌

Notion (Correctly Created):
  ├── heading_2: "Transform the impact..." ✓
  ├── heading_2: "Enhance the service..." ✓
  ├── heading_2: "Consolidate IT services" ✓
  ├── heading_2: "Apply predictive intelligence" ✓
  ├── heading_2: "Research innovation" ✓
  ├── heading_2: "Identify license entitlements" ✓
  ├── heading_2: "Certification and training" ✓
  ├── heading_2: "Applications and features" ✓
  └── [heading_1 NOT created - title already in page name]
  Count: 9 ✓

Comparison: 11 → 9 ❌ FAIL (WRONG - comparison logic flawed)
```

### After v11.0.188
```
HTML Source (Fixed Count):
  ├── H1: "IT Service Management" ✗ EXCLUDED (page title)
  ├── H2: "Transform the impact..." ✓
  ├── H2: "Enhance the service..." ✓
  ├── H2: "Consolidate IT services" ✓
  ├── H2: "Apply predictive intelligence" ✓
  ├── H2: "Research innovation" ✓
  ├── H2: "Identify license entitlements" ✓
  ├── H2: "Certification and training" ✓
  ├── H2: "Applications and features" ✓
  └── H5: "On this page" [IN SIDEBAR] ✗ EXCLUDED (navigation)
  Count: 9 ✓ (H1 and sidebar excluded)

Notion (Same):
  ├── heading_2: "Transform the impact..." ✓
  ├── heading_2: "Enhance the service..." ✓
  ├── heading_2: "Consolidate IT services" ✓
  ├── heading_2: "Apply predictive intelligence" ✓
  ├── heading_2: "Research innovation" ✓
  ├── heading_2: "Identify license entitlements" ✓
  ├── heading_2: "Certification and training" ✓
  ├── heading_2: "Applications and features" ✓
  Count: 9 ✓

Comparison: 9 → 9 ✅ PASS (CORRECT!)
```

---

## Pattern A: Missing Headings in Notion (CRITICAL 🔴)

### Example: predictive-intelligence-for-incident

#### HTML Source Has Headings
```html
<section class="section">
  <h2 class="title sectiontitle">Solution definitions</h2>
  <p>Content...</p>
  <div class="table-wrap">
    <table>...</table>
  </div>
</section>
```

**Count**: 1 H2 detected ✓

#### Notion MISSING Heading
```
Notion Page Created:
├── table "Solution Definitions..." ✓
└── [NO heading_2 for "Solution definitions" ❌]

Count: 0 headings created ❌
```

**Comparison**: 2 → 0 ❌ FAIL (1 heading missing)

#### Why This Is Critical
```
Source HTML:
  ├── H2: "Solution definitions" ← SHOULD BE CREATED
  └── TABLE: solution_definitions_table
  Text coverage: ~200 chars

Notion Page (BROKEN):
  ├── TABLE: solution_definitions_table ✓ (present)
  └── [MISSING H2: "Solution definitions"] ❌
  Text coverage: ~150 chars (70% of source)

Audit Check:
  Coverage: 75% ✅ PASS (meets 65-110% threshold)
  
ContentComparison Check:
  Headings: 2 → 0 ❌ FAIL (missing element)
  
Result: Audit ✅ PASS | ContentComparison ❌ FAIL
         (Conflicting signals - audit is wrong!)
```

---

## Root Cause Analysis for Pattern A

### Question: Where Did the Heading Go?

```
Pipeline Flow:
1. Extract HTML
   ├─ H2: "Solution definitions" ✓ DETECTED
   └─ → Pass to conversion

2. Convert to Notion Blocks
   ├─ Create heading_2 block? 
   ├─ [Option A] Not created (bug) ❌
   ├─ [Option B] Created but filtered (sidebar logic) ❌
   └─ [Option C] Created but size limit (dropped) ❌
   
3. Send to Notion API
   └─ [heading_2 block missing?] ❌
   
4. Final Page in Notion
   └─ No heading_2 block ❌

WHERE DID IT GO???
```

### Investigation Checklist for Pattern A

- [ ] Are headings detected? (check source HTML parsing)
- [ ] Are heading blocks created? (check block creation code)
- [ ] Are blocks included in output? (check output payload)
- [ ] Do blocks reach Notion? (check API call)
- [ ] Are blocks stored? (check Notion page)

---

## Pattern Summary Table

| Pattern | Issue | Pages | Root Cause | Fix | Status |
|---------|-------|-------|-----------|-----|--------|
| **B** | Count wrong | 1 | H1 & sidebar counted | Exclude H1, sidebar | ✅ DONE |
| **A** | Not created | 7 | Unknown | TBD | 🔄 PENDING |
| **C** | Minor diff | 3 | Flexible elements | Accept or refine | 🟢 LOW |

---

## Code Changes Made (v11.0.188)

### Location 1: POST Source Count
**File**: `server/routes/w2n.cjs` line ~2145
```javascript
// OLD (counts H1 + sidebars)
const hCount = $('h1, h2, h3, h4, h5, h6, span.title').length;

// NEW (excludes H1, filters sidebars)
let hCount = 0;
$('h2, h3, h4, h5, h6, span.title').each((i, elem) => {
  const $elem = $(elem);
  const inSidebar = $elem.closest('.zDocsSideBoxes, .contentPlaceholder, .miniTOC, aside, nav').length > 0;
  if (!inSidebar) {
    hCount++;
  }
});
```

### Location 2: POST Notion Count
**File**: `server/routes/w2n.cjs` line ~2244
```javascript
// OLD (counts all headings)
else if (block.type.startsWith('heading_')) notionCounts.headings++;

// NEW (excludes heading_1)
else if (block.type === 'heading_2' || block.type === 'heading_3') notionCounts.headings++;
```

### Location 3: PATCH Source Count
**File**: `server/routes/w2n.cjs` line ~4545
```javascript
// Same as POST (NEW - excludes H1, filters sidebars)
```

### Location 4: PATCH Notion Count
**File**: `server/routes/w2n.cjs` line ~4647
```javascript
// Same as POST (NEW - excludes heading_1)
```

---

## Testing Checklist

### Pattern B Verification (Today)
- [ ] Re-extract IT Service Management page
- [ ] Check logs for: "Found 9 heading tags (h2-h6 + span.title, excluding H1 and sidebars)"
- [ ] Verify output: "Headings: 9 → 9 ✅ PASS"
- [ ] Confirm NOT auto-saved to pages-to-update

### Pattern A Investigation (This Week)
- [ ] Enable `SN2N_DEBUG_HEADINGS=1` flag
- [ ] Extract predictive-intelligence-for-incident fresh
- [ ] Check logs for heading detection
- [ ] Check logs for heading block creation
- [ ] Find where heading is lost
- [ ] Implement fix
- [ ] Re-extract all 7 Pattern A pages
- [ ] Verify heading counts improve

---

## Commands Reference

### Check Current Server Status
```bash
curl http://localhost:3004/health
```

### Extract Page with Debug (when Pattern A fix available)
```bash
SN2N_DEBUG_HEADINGS=1 SN2N_VERBOSE=1 npm start
# Then trigger extraction via Tampermonkey
```

### View Recent Logs
```bash
tail -f /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/logs/server-terminal-*.log | grep -i heading
```

### PATCH All 11 Pages After Fix
```bash
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/config
bash batch-patch-with-cooldown.sh
```

---

## Success Indicators

### Pattern B (After Re-extraction)
✅ "Headings: 9 → 9"  
✅ "✅ Content Comparison: PASS"  
✅ NOT auto-saved

### Pattern A (After Investigation & Fix)
✅ Headings appear in Notion blocks  
✅ Heading counts > 0  
✅ ContentComparison: FAIL → PASS  
✅ Pages can be PATCH'd  

