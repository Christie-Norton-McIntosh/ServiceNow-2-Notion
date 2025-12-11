# Pattern Learning Quick Reference

**Version**: 11.0.113

## What Is Pattern Learning?

Auto-capture of failing HTML patterns when extraction breaks. Creates a growing library of test fixtures.

## The Flow

```
Extraction Fails (low AUDIT coverage)
         ↓
Auto-remediation runs
         ↓
Detects gap (missing content)
         ↓
Pattern captured to tests/fixtures/pattern-learning/<type>/
         ↓
Pattern available for analysis & testing
```

## Quick Commands

### View Patterns
```bash
# All patterns
node tools/manage-patterns.cjs

# By type
node tools/manage-patterns.cjs --type missing_list_items

# Statistics
node tools/manage-patterns.cjs --stats
```

### Manage Patterns
```bash
# Keep last 5 of each type
node tools/manage-patterns.cjs --clean

# Generate test scripts
node tools/manage-patterns.cjs --gen-tests
```

## Pattern Types

| Type | Meaning | Fix |
|------|---------|-----|
| `missing_list_items` | List items not extracted | Check extractLists() |
| `missing_table_content` | Table rows/cells missing | Check extractTables() |
| `missing_code` | Code blocks not extracted | Check code extraction |
| `deep_nesting` | Nested content missing | Use SN2N_STRICT_ORDER=1 |
| `hidden_elements` | Hidden content not extracted | Determine if needed |
| `duplicate_text` | Same text in multiple blocks | Add deduplication |
| `near_duplicate_text` | Similar text duplicated | Improve dedup algorithm |

## Using Captured Patterns

### 1. Understand the Problem

```bash
# View the pattern
cat tests/fixtures/pattern-learning/missing_list_items/pattern-f7e16adb-*.json | jq

# Key fields:
# - htmlPreview: First 500 chars of source
# - fullHtml: Complete HTML that failed
# - coverage: How much % was extracted
# - blockTypes: What types of blocks were extracted
```

### 2. Analyze the Gap

```json
{
  "htmlLength": 254,           // Source size
  "blocksExtracted": 3,        // What was extracted
  "coverage": 50,              // Coverage % (should be 95-105%)
  "blockTypes": {              // What types
    "heading_2": 1,
    "paragraph": 2
  }
}
```

### 3. Fix the Code

Locate the relevant extraction function:
- missing_list_items → `extractLists()` in `server/services/servicenow.cjs`
- missing_table_content → `extractTables()` in `server/services/servicenow.cjs`
- missing_code → code block extraction logic
- deep_nesting → DOM traversal in `servicenow.cjs`

### 4. Validate the Fix

```bash
# Extract the same HTML again
# Verify coverage improved
# Pattern now serves as regression test
```

## Examples

### Example 1: Missing List Items

```javascript
// Pattern file: tests/fixtures/pattern-learning/missing_list_items/pattern-*.json
{
  "patternType": "missing_list_items",
  "coverage": 50,
  "fullHtml": "<ul><li>Item 1</li><li>Item 2</li></ul>",
  "blocksExtracted": 0,
  "blockTypes": {}
}

// Problem: extractLists() didn't find the <ul>
// Fix: Check DOM selector or traversal logic
// Validate: Re-extract same HTML, coverage should be >95%
```

### Example 2: Missing Table Content

```javascript
{
  "patternType": "missing_table_content",
  "coverage": 42,
  "fullHtml": "<table><tr><td>Cell 1</td><td>Cell 2</td></tr></table>",
  "blocksExtracted": 1,
  "blockTypes": { "table": 1 }
}

// Problem: Table extracted but cells are empty
// Fix: Check cell content extraction in extractTables()
// Validate: Re-extract, cells should have content
```

## Statistics

```bash
$ node tools/manage-patterns.cjs --stats

📈 Overall Stats:
   Total pattern types: 5
   Total patterns captured: 23

📊 By Type:
   missing_list_items
   ├─ Patterns: 8
   ├─ Avg Coverage: 45%           ← This is LOWEST
   ├─ Coverage Range: 30% → 60%
   ├─ Avg HTML Size: 2,847 chars
   └─ Avg Blocks: 12

   missing_table_content
   ├─ Patterns: 7
   ├─ Avg Coverage: 42%           ← This is LOWEST
   ├─ Coverage Range: 25% → 55%
   └─ Avg Blocks: 8
```

**Insights**:
- **Most common**: missing_list_items (8 patterns)
- **Lowest coverage**: Table extraction is worst performer
- **Recommendation**: Prioritize table extraction fixes

## Pattern Storage Location

```
tests/fixtures/pattern-learning/
├── missing_list_items/
│   ├── pattern-f7e16adb-2025-12-04T16-17-27.json
│   ├── pattern-a1b2c3d4-2025-12-05T09-30-12.json
│   └── ...
├── missing_table_content/
│   ├── pattern-x9y8z7w6-2025-12-04T15-45-00.json
│   └── ...
└── ...
```

**Each file**:
- Named with SHA256 hash (8 chars) + timestamp
- Contains complete pattern data
- Hash prevents duplicates automatically

## Integration

### Automatic Capture

When AUDIT fails (coverage < 95%):

```
diagnoseAndFixAudit() → findContentGaps() → captureNewPattern()
```

No additional code needed - happens automatically!

### Manual Capture (Future)

```javascript
const { captureNewPattern } = require('./server/utils/pattern-learning.cjs');

captureNewPattern({
  html: sourceHtml,
  blocks: extractedBlocks,
  patternType: 'missing_list_items',
  audit: auditResult,
  pageTitle: 'My Page',
  log: console.log
});
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No patterns captured | Ensure AUDIT coverage is < 95% |
| Duplicate patterns | Hash dedup should prevent - check if HTML is different |
| Can't find pattern | Use `node tools/manage-patterns.cjs --type <type>` |
| Too many patterns | Run `node tools/manage-patterns.cjs --clean` |

## Next Steps

1. **Monitor**: Check `--stats` weekly to identify trends
2. **Analyze**: Review high-count gap types
3. **Fix**: Use patterns to understand and fix issues
4. **Validate**: Re-extract captured HTML to verify fixes
5. **Clean**: Archive old patterns monthly

## Related Docs

- [PATTERN-LEARNING.md](../docs/PATTERN-LEARNING.md) - Full documentation
- [AUTO-VALIDATION.md](../docs/AUTO-VALIDATION.md) - AUDIT validation details
- [RELEASE-NOTES-11.0.113.md](../docs/RELEASE-NOTES-11.0.113.md) - Release notes
