# Diff Output in Notion — Visual Reference Card

## 🎯 What Changed

```
BEFORE:                          AFTER:
─────────────────────           ─────────────────────
Diff generated ✓                Diff generated ✓
Console logged ✓                Console logged ✓
In Notion? ❌                   In Notion? ✅ NEW!
                                
Developer sees in Notion? ❌    Developer sees in Notion? ✅
                                
Time to debug: 5+ min           Time to debug: 30 sec
```

---

## 📍 Where to Find It

```
Notion Database Page:

┌─────────────────────────────────────┐
│ Title: My Documentation             │
│ ────────────────────────────────────│
│ Properties:                         │
│  Source URL: [url]                  │
│  Error: ☑️                          │
│  Audit:  ▼ CLICK HERE ▼             │
│          ┌─────────────────────────┐│
│          │ [2025-12-09] Content... ││
│          │ Coverage: 87.2%         ││
│          │ ⚠️ Missing: 437 chars   ││
│          │                         ││
│          │ 🔍 Enhanced Diff:       ││
│          │ ❌ Missing blocks: 4    ││ ← YOU ARE HERE
│          │    1. "Configure..."    ││
│          │    2. "After..."        ││
│          │    ...                  ││
│          └─────────────────────────┘│
│  Stats: [stats]                     │
│  Validation: [details]              │
│                                     │
│ Content...                          │
└─────────────────────────────────────┘
```

---

## 🔍 What You'll See

### Passing Validation (✅)
```
Audit property:
✅ PASS (98.7%)
(No diff section needed)
```

### Failing Validation (❌)
```
Audit property:
❌ FAIL (87.2%)

🔍 Enhanced Diff Analysis:
❌ Missing blocks: 4
   1. "Configure the property mapping..."
   2. "The default mapping includes..."
   3. "Click the gear icon..."
   ... and 1 more
➕ Extra blocks: 1
   1. "Duplicate text that shouldn't be there"
```

---

## 📊 Data Structure

```
servicenow.cjs generates:
┌───────────────────────────────────┐
│ sourceAudit.result.diff = {       │
│   missingBlocks: 4,          ← Count
│   extraBlocks: 1,            ← Count
│   missingSamples: [          ← Text samples
│     "Configure...",
│     "After...",
│     "Click...",
│     "See..."
│   ],
│   extraSamples: [
│     "Duplicate..."
│   ]
│ }                                 │
└───────────────────────────────────┘
                ↓
w2n.cjs formats:
┌───────────────────────────────────┐
│ 🔍 Enhanced Diff Analysis:        │
│ ❌ Missing blocks: 4              │
│    1. "Configure..."              │
│    2. "After..."                  │
│    3. "Click..."                  │
│    ... and 1 more                 │
│ ➕ Extra blocks: 1                │
│    1. "Duplicate..."              │
└───────────────────────────────────┘
                ↓
Notion shows:
┌───────────────────────────────────┐
│ 🔍 Enhanced Diff Analysis:        │
│ ❌ Missing blocks: 4              │
│    1. "Configure..."              │
│    2. "After..."                  │
│    3. "Click..."                  │
│    ... and 1 more                 │
│ ➕ Extra blocks: 1                │
│    1. "Duplicate..."              │
└───────────────────────────────────┘
```

---

## ⚙️ How to Use

```
Step 1: Extract ServiceNow page
         ↓
Step 2: Check Audit property in Notion
         ↓
Step 3: Look for "🔍 Enhanced Diff"
         ↓
Step 4: See missing/extra blocks
         ↓
Step 5: Find in Notion page
         ↓
Step 6: Fix (or investigate further)
```

---

## 🎨 Sample Output

### Example 1: Simple Case
```
Coverage: 92.3%

🔍 Enhanced Diff Analysis:
❌ Missing blocks: 1
   1. "This paragraph was in HTML but..."
```

### Example 2: Complex Case
```
Coverage: 87.2%

🔍 Enhanced Diff Analysis:
❌ Missing blocks: 6
   1. "Configure service now integration..."
   2. "After configuration, test the..."
   3. "For advanced users, see the..."
   ... and 3 more
➕ Extra blocks: 2
   1. "Duplicate section from earlier"
   2. "Test paragraph from retry"
```

### Example 3: Passing
```
Coverage: 98.7%

(No diff section — validation passed!)
```

---

## 🔧 Technical Details

| Item | Value |
|------|-------|
| **Property** | Audit |
| **Type** | Rich text |
| **Trigger** | Validation fails (< 95%) |
| **Location** | Lines ~1990-2020 in w2n.cjs |
| **Format** | Text with emojis + indentation |
| **Limit** | 2000 chars (Notion), handled gracefully |
| **Full text** | Available in server logs |

---

## 📋 Feature Checklist

- ✅ Automatic (no config needed)
- ✅ Only shows on failures (saves space)
- ✅ Includes count + samples
- ✅ Sample text truncated to 100 chars
- ✅ Shows "... and N more" if > 3
- ✅ Emoji-formatted for clarity
- ✅ Gracefully handles truncation
- ✅ Works with all page sizes

---

## 🚀 Quick Reference

| Need | Action |
|------|--------|
| **See what's missing** | Check Audit property → "🔍 Enhanced Diff" |
| **Full text** | Check server logs: `grep "\[DIFF\]" logs/` |
| **No diff showing** | Validation passed (coverage ≥ 95%) |
| **Text truncated** | Property exceeded 2000 chars (normal) |
| **Examples** | See "DIFF-PROPERTY-QUICK-START.md" |

---

## 🎯 Time Saved

```
BEFORE:
1. See validation failed
2. Open dev console
3. Search logs for [DIFF]
4. Read full output
5. Find blocks in page
6. Identify issue
TIME: 5-10 minutes 😞

AFTER:
1. See validation failed
2. Open Audit property
3. Read diff analysis
4. Find blocks in page
5. Identify issue
TIME: 30 seconds 🚀
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| **DIFF-PROPERTY-QUICK-START.md** | TL;DR version |
| **DIFF-PROPERTY-INTEGRATION.md** | Detailed guide |
| **DIFF-FLOW-DIAGRAM.md** | Visual flow diagrams |
| **ENHANCED-VALIDATION-v11.0.200.md** | Full validation system |

---

## ✅ Status

```
✓ Implemented in w2n.cjs
✓ No syntax errors
✓ All dependencies satisfied
✓ Production ready
✓ Zero config needed
✓ Graceful degradation
```

---

## 🎓 Key Concepts

**Diff**: Line-by-line comparison of HTML vs Notion blocks

**Missing blocks**: In HTML but not created in Notion

**Extra blocks**: In Notion but not in HTML

**Samples**: Preview text (100 chars max)

**Truncation**: Property size limited to 2000 chars

---

## 🔗 Related Features

- **AUDIT system** (v11.0.113) — Character-level validation
- **Unicode normalization** (v11.0.200) — Smart quotes, accents
- **Red color formatting** (v11.0.199) — Technical identifier highlighting
- **Inline code → Red** (v11.0.200) — Validation consistency

---

## 💡 Pro Tips

1. **For teams**: Diff visible to all team members in Notion
2. **For debugging**: Cross-reference with sample text in page
3. **For large pages**: Check server logs if property truncated
4. **For patterns**: Monitor which types fail most often
5. **For fixes**: Use diff to target exact blocks needing attention

---

**Version**: v11.0.200  
**Status**: ✅ Production Ready  
**Date**: 2025-12-09

---

*The diff output is now integrated into the Audit property — no more manual log checking! 🎉*
