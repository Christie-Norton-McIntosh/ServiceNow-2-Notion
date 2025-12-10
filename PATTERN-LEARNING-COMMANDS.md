# Pattern Learning System — Complete Reference

**Quick Start**: `npm run patterns --stats`

---

## npm Scripts (New in v11.0.113)

```bash
# View patterns
npm run patterns                    # List all captured patterns
npm run patterns --type <type>     # Filter by pattern type

# Analyze
npm run patterns:stats              # Show statistics
npm run patterns --stats           # Alternative

# Manage
npm run patterns:clean              # Clean old patterns (keep last 5)
npm run patterns:gen-tests         # Generate test scripts
```

---

## CLI Tool: `tools/manage-patterns.cjs`

```bash
# Direct usage (no npm)
node tools/manage-patterns.cjs [options]

# Options:
#   (none)              List all patterns
#   --type <type>       Filter by pattern type
#   --stats             Show statistics
#   --clean             Clean old patterns
#   --gen-tests         Generate comparison tests
```

---

## Complete Workflow

### 1. Extraction Fails
```
Page extracted with AUDIT coverage < 95%
```

### 2. Auto-Remediation Runs
```
diagnoseAndFixAudit() → findContentGaps() → captureNewPattern()
Pattern saved automatically ✓
```

### 3. Review Patterns
```bash
npm run patterns           # See what was captured
npm run patterns:stats    # Analyze trends
```

### 4. Understand the Gap
```bash
cat tests/fixtures/pattern-learning/missing_list_items/pattern-*.json | jq
# Review: htmlPreview, coverage, blocksExtracted
```

### 5. Fix Extraction Code
```javascript
// Fix in server/services/servicenow.cjs or related files
// Example: extractLists() function for missing_list_items
```

### 6. Validate Fix
```bash
# Re-extract same HTML
# Verify coverage improved
# Pattern now serves as regression test
```

---

## Pattern Types Reference

| Type | Trigger | Typical Coverage | Fix Location |
|------|---------|------------------|--------------|
| `missing_list_items` | List items not extracted | 30-60% | extractLists() |
| `missing_table_content` | Table rows/cells missing | 25-55% | extractTables() |
| `missing_code` | Code blocks not extracted | 40-70% | code extraction |
| `deep_nesting` | Nested content missing | 35-65% | DOM traversal |
| `hidden_elements` | Hidden content ignored | 80-95% | visibility check |
| `duplicate_text` | Exact duplicates found | 100-120%* | deduplication |
| `near_duplicate_text` | Similar text duplicated | 105-150%* | dedup algorithm |

*Coverage > 100% means content extracted multiple times

---

## File Locations

```
Pattern Storage:
  tests/fixtures/pattern-learning/<type>/pattern-<hash>-YYYY-MM-DD.json

Tools:
  tools/manage-patterns.cjs         # Management CLI
  test-pattern-capture-integration.cjs  # Integration test

Documentation:
  docs/PATTERN-LEARNING.md          # Full documentation
  docs/PATTERN-LEARNING-INTEGRATION.md  # Integration guide
  PATTERN-LEARNING-QUICKREF.md      # Quick reference
  PATTERN-LEARNING-COMPLETE.md      # Implementation summary
  README.md                         # Main README (updated)

Source Code:
  server/utils/pattern-learning.cjs          # Core module
  server/utils/audit-auto-remediate.cjs      # Integration point
```

---

## Example Sessions

### Session 1: Initial Capture

```
$ npm run patterns
📚 CAPTURED PATTERNS
📂 missing_list_items (1 patterns)
   1. [50%] Test Page - Pattern Capture
      📅 Captured: 12/4/2025, 10:17:27 AM
      📝 Blocks: 3 (heading_2:1, paragraph:2)

$ npm run patterns:stats
📈 Overall Stats:
   Total pattern types: 1
   Total patterns captured: 1
   Missing_list_items: Avg coverage 50%, 254 char HTML
```

### Session 2: Multiple Failures

```
$ npm run patterns
📚 CAPTURED PATTERNS
📂 missing_list_items (3 patterns)
   1. [45%] Service Config...
   2. [50%] Test Page...
   3. [40%] API Docs...

📂 missing_table_content (2 patterns)
   1. [42%] CMDB Query Builder...
   2. [38%] Schema Definition...

$ npm run patterns:stats
📊 Overall Stats:
   Total pattern types: 2
   Total patterns captured: 5
   
   missing_list_items: 3 patterns, avg 45% coverage
   missing_table_content: 2 patterns, avg 40% coverage
```

### Session 3: Fix Validation

```
# Before fix
$ npm run patterns:stats
missing_list_items: Avg coverage 45% (LOW)

# Fix extractLists() in servicenow.cjs
# ...

# After fix - re-run extraction
$ npm run patterns:stats
missing_list_items: NEW patterns would show higher coverage
(confirmation that fix worked)
```

---

## Understanding Statistics

```
$ npm run patterns:stats

📊 By Type:
   missing_list_items
   ├─ Patterns: 3           # How many times this failed
   ├─ Avg Coverage: 45%    # Average coverage when it fails
   ├─ Coverage Range: 30% → 60%  # Severity variation
   ├─ Avg HTML Size: 2,847 chars  # Typical complexity
   └─ Avg Blocks: 12        # Typical output size
```

**What This Means**:
- **Patterns: 3** → This type of failure happens frequently
- **Avg Coverage: 45%** → When it fails, it's SEVERE (need 95%)
- **Coverage Range** → Sometimes better (60%), sometimes worse (30%)
- **Avg HTML Size** → Medium complexity (2.8KB)
- **Avg Blocks** → Usually produces ~12 blocks despite issues

**Action Items**:
1. `missing_list_items` is #1 priority (most frequent + severe)
2. Focus fixes on list extraction logic
3. Test fixes with captured 2.8K HTML samples

---

## Maintenance Tasks

### Daily (Automatic)
- ✓ Patterns captured automatically on AUDIT failures
- ✓ No manual action required
- ✓ Deduplication prevents duplicates

### Weekly
```bash
npm run patterns:stats
# Review trends:
# - Which gaps are most common?
# - Are averages improving?
# - Any new gap types?
```

### Monthly
```bash
npm run patterns:clean
# Keeps last 5 per type for regression testing
# Prevents directory bloat
```

### As Needed
```bash
npm run patterns --type missing_list_items
# When investigating specific gap type
# When fixing extraction code
```

---

## Troubleshooting

### No Patterns Captured
**Check**:
1. Run test: `node test-pattern-capture-integration.cjs`
2. Verify AUDIT coverage actually < 95%
3. Check import in `server/utils/audit-auto-remediate.cjs`

**Fix**: Manually trigger with low-coverage HTML

### Duplicate Patterns
**Normal**: Hash-based dedup should prevent duplicates  
**If happening**: Check if HTML is actually different (might have formatting changes)

### Can't Find Pattern by Type
**Solution**:
```bash
npm run patterns               # See available types
npm run patterns --type <type> # Use correct type name
```

### Management Tool Not Working
**Try**:
```bash
node tools/manage-patterns.cjs                    # Direct execution
npm run patterns                                   # Via npm script
node tools/manage-patterns.cjs --stats            # Direct with option
npm run patterns:stats                            # Via npm script
```

---

## Integration Architecture

### Auto-Remediation Flow
```
POST /api/W2N (dryRun=true)
         ↓
AUDIT validation (coverage < 95%)
         ↓
remediateAudit() → diagnoseAndFixAudit()
         ↓
findContentGaps()
         ↓
For each gap: captureNewPattern() ← Pattern saved!
         ↓
Pattern JSON in tests/fixtures/pattern-learning/<type>/
```

### No API Changes
- All existing APIs unchanged
- Pattern learning is completely optional
- No impact on extraction quality or performance

---

## Performance Impact

| Operation | Time | When |
|-----------|------|------|
| Pattern capture | ~20ms | Only on AUDIT failures |
| Hash generation | ~1ms | Per pattern |
| File write | ~5-10ms | Per pattern |
| Directory creation | ~2-5ms | First pattern of type |
| Statistics analysis | ~50-100ms | On demand |

**Net Impact**: None on normal operations (happens only on failures)

---

## Code References

### Pattern Learning Module
**File**: `server/utils/pattern-learning.cjs`
**Lines**: 349
**Functions**: 5

```javascript
captureNewPattern(options)      // Main capture function
loadPatterns(type)              // Load patterns by type
getPatternStatistics()          // Get stats
generateComparisonScript()      // Auto-gen tests
_generateHash(data)             // SHA256 hash
```

### Auto-Remediation Integration
**File**: `server/utils/audit-auto-remediate.cjs`
**Lines**: 669 total (200+ new)
**Integration Points**: 7

```javascript
// Line 20: Import
const { captureNewPattern } = require('./pattern-learning.cjs');

// Line 83: Pass to findContentGaps
diagnosis.gaps = findContentGaps(html, blocks, sourceAnalysis, log, {
  pageTitle,
  audit,
  captureNewPattern
});

// Lines 305-450: Capture calls for 5 gap types
if (captureNewPattern) {
  captureNewPattern({...});
}
```

---

## Examples: Real Usage

### Example 1: Analyze List Extraction Issues

```bash
# 1. See missing_list_items patterns
npm run patterns --type missing_list_items

# 2. Get statistics
npm run patterns:stats

# 3. Review one pattern
cat tests/fixtures/pattern-learning/missing_list_items/pattern-*.json | jq '.htmlPreview'

# 4. Fix extractLists() in server/services/servicenow.cjs

# 5. Re-test with captured HTML
# (verify coverage improves)
```

### Example 2: Track Improvement

```bash
# Day 1: Initial capture
npm run patterns:stats
# Output: missing_list_items avg 45% coverage

# (Fix code...)

# Day 7: Verify improvement
npm run patterns --type missing_list_items
# New patterns would show higher coverage
# OR captured patterns would no longer fail
```

### Example 3: Generate Regression Tests

```bash
# Generate test scripts
npm run patterns:gen-tests

# Tests created:
ls tests/test-pattern-*.cjs

# Run tests:
for f in tests/test-pattern-*.cjs; do
  node "$f"
done
```

---

## Key Takeaways

✅ **Automatic**: No manual setup needed  
✅ **Smart**: Deduplicates with SHA256 hashes  
✅ **Organized**: Patterns stored by type  
✅ **Actionable**: Statistics guide prioritization  
✅ **Lightweight**: Minimal performance impact  
✅ **Foundation**: Enables regression testing  

---

## Related Documentation

- **PATTERN-LEARNING.md** - Technical documentation
- **PATTERN-LEARNING-INTEGRATION.md** - Integration details
- **PATTERN-LEARNING-QUICKREF.md** - Command reference
- **PATTERN-LEARNING-COMPLETE.md** - Implementation summary
- **README.md** - Project overview
- **AUTO-VALIDATION.md** - AUDIT validation details

---

## Quick Commands Cheat Sheet

```bash
# View
npm run patterns               # List all
npm run patterns --type X      # By type

# Analyze
npm run patterns:stats         # Statistics

# Maintain
npm run patterns:clean         # Keep last 5
npm run patterns:gen-tests     # Generate tests

# Direct (no npm)
node tools/manage-patterns.cjs [options]
```

---

**Version**: 11.0.113  
**Status**: ✅ Production Ready  
**Updated**: December 4, 2025
