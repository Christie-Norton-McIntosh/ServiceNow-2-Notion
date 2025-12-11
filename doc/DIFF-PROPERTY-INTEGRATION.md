# Diff Output Integration — v11.0.200

**Status**: ✅ Complete  
**Date**: 2025-12-09  
**Component**: Audit Property Integration

## Overview

The line-by-line diff analysis generated in `server/services/servicenow.cjs` is now integrated into the Notion **Audit** property, making debugging information visible directly in your Notion database.

---

## Integration Details

### Where Diff Appears

**Property**: **Audit** (rich_text)  
**Trigger**: Only when validation fails (coverage < 95%)  
**Location**: After main AUDIT results, before property truncation  

### Audit Property Structure

```
[2025-12-09] Content Audit: ❌ FAIL
Coverage: 92.3% (threshold: 95-105%)
Source: 47 text nodes, 2,847 chars
Notion: 43 blocks, 2,663 chars
Block/Node Ratio: 0.91x
Content: 2 tables, 1 callout, 3 nested lists
⚠️ Missing: 184 chars (6.5%)

HTML segments: 47, Notion segments: 43

🔍 Enhanced Diff Analysis:
❌ Missing blocks: 4
   1. "Configure the property mapping to control which ServiceNow fields..."
   2. "The default mapping includes: short_description → Title, sys_id..."
   3. "Click the gear icon to customize field mappings for your workflow."
➕ Extra blocks: 1
   1. "Duplicate paragraph that shouldn't be there"
```

### Code Location

**File**: `server/routes/w2n.cjs`  
**Lines**: ~1985-2020  
**Context**: Property updates section after page creation

```javascript
// FIX v11.0.200: Add line-by-line diff analysis to Audit property
if (auditResult.diff && !auditResult.passed) {
  const diff = auditResult.diff;
  validationLines.push('');  // Blank line for readability
  validationLines.push('🔍 Enhanced Diff Analysis:');
  
  if (diff.missingBlocks > 0) {
    validationLines.push(`❌ Missing blocks: ${diff.missingBlocks}`);
    if (diff.missingSamples && diff.missingSamples.length > 0) {
      diff.missingSamples.slice(0, 3).forEach((sample, i) => {
        const preview = sample.length > 100 ? sample.substring(0, 100) + '...' : sample;
        validationLines.push(`   ${i + 1}. "${preview}"`);
      });
      if (diff.missingSamples.length > 3) {
        validationLines.push(`   ... and ${diff.missingSamples.length - 3} more`);
      }
    }
  }
  
  if (diff.extraBlocks > 0) {
    validationLines.push(`➕ Extra blocks: ${diff.extraBlocks}`);
    // ... similar formatting for extra blocks
  }
}
```

---

## Data Flow

```
servicenow.cjs
  ↓
  • Extracts HTML blocks
  • Extracts Notion blocks
  • Compares with diff library
  • Stores in sourceAudit.result.diff
  ↓
w2n.cjs (property updates)
  ↓
  • Reads auditResult from extractionResult
  • Accesses auditResult.diff
  • Formats for Audit property
  • Adds to propertyUpdates["Audit"]
  ↓
Notion Page
  ↓
  • Audit property updated with diff details
  • Shows missing blocks
  • Shows extra blocks
  • Shows sample text for each
```

---

## What Gets Stored

### auditResult.diff Object Structure

```javascript
{
  missingBlocks: 4,           // Number of blocks in HTML but not Notion
  extraBlocks: 1,             // Number of blocks in Notion but not HTML
  missingSamples: [           // Array of missing block text (up to 5)
    "Configure the property mapping...",
    "The default mapping includes...",
    "Click the gear icon...",
    "See the property mapping guide..."
  ],
  extraSamples: [             // Array of extra block text (up to 3)
    "Duplicate paragraph..."
  ]
}
```

### Property Formatting Rules

1. **Missing blocks** section (if > 0):
   - Shows count: `❌ Missing blocks: N`
   - Lists up to 3 samples with indices
   - If more than 3: `... and X more`

2. **Extra blocks** section (if > 0):
   - Shows count: `➕ Extra blocks: N`
   - Lists all samples (usually fewer)

3. **Text truncation**:
   - Each sample truncated to 100 characters
   - Full sample text available in logs

4. **Total property size**:
   - Full Audit content truncated to 2000 chars (Notion limit)
   - Diff section prioritized for inclusion
   - Earlier content truncated if necessary

---

## Debugging with Diff Property

### Finding Missing Content

1. **Check Audit property**:
   - Look for "❌ Missing blocks" section
   - Read the sample text
   - These blocks exist in ServiceNow but not in Notion

2. **Find exact block**:
   - Check the Notion page body for where it should be
   - Look at the block before the first missing sample
   - Missing content should appear after that point

3. **Example debugging**:
   - If sample says "Configure the property mapping..."
   - Search your Notion page for this text
   - If found, it's being created but might be formatted differently
   - If not found, HTML extraction worked but Notion creation failed

### Common Diff Scenarios

**Scenario 1: Complex table**
- Missing: 3-5 blocks
- Cause: Table cells not extracted properly
- Fix: Check table HTML in servicenow.cjs table converter

**Scenario 2: Deeply nested list**
- Missing: Multiple blocks
- Cause: Deep nesting > 2 levels not handled in initial creation
- Fix: Check orchestration logic for deep nesting

**Scenario 3: Code blocks**
- No blocks marked as missing (code blocks skipped in diff)
- Cause: Code blocks excluded from validation
- Fix: Normal behavior, not an issue

**Scenario 4: Inline code**
- No blocks marked as missing (red color filtered)
- Cause: Technical terms excluded from diff
- Fix: Normal behavior, not an issue

---

## Property Truncation

The Audit property has a 2000-character limit in Notion. The diff section is **prioritized** to stay within limits:

```javascript
let truncatedAuditContent = auditContent;
if (auditContent.length > 2000) {
  truncatedAuditContent = auditContent.substring(0, 1997) + '...';
  log(`⚠️ [PROPERTY-TRUNCATE] Audit property truncated to 2000 chars`);
}
```

**Priority order** (what appears first in Audit):
1. Timestamp + Coverage + Threshold (always included)
2. Source/Notion block counts (always included)
3. Block ratio + Content complexity (usually included)
4. Missing/Extra character counts (usually included)
5. Detailed comparison segments (may be truncated)
6. **🔍 Enhanced Diff Analysis** (prioritized, but may be truncated)

**Solution if truncated**:
- Check server logs for full diff (includes all samples)
- Grep for `[DIFF]` in console output
- Use DRY-RUN to see full validation before PATCH

---

## Testing the Integration

### Test 1: Passing Validation
```bash
# Extract a simple page (< 5 paragraphs)
# Expected: No diff section in Audit property
```

### Test 2: Failing Validation
```bash
# Extract a complex page intentionally:
# Edit HTML to remove a paragraph before extraction
# Expected: Audit property shows "🔍 Enhanced Diff Analysis"
```

### Test 3: Check Full Diff in Logs
```bash
# Enable verbose logging:
SN2N_VERBOSE=1 npm start

# Run extraction that fails validation:
# Check logs for: grep "\[DIFF\]" server/logs/server-terminal-*.log
```

### Test 4: Multiple Missing Blocks
```bash
# Extract page and remove several content blocks from HTML
# Verify Audit shows:
#   ❌ Missing blocks: N
#   Sample texts (up to 3)
#   "... and X more"
```

---

## Advantages

✅ **Visibility**: Debugging info directly in Notion  
✅ **Automation**: No manual log checking needed  
✅ **Context**: Sample text shows exactly what's missing  
✅ **Summarization**: Missing count + samples (not full dump)  
✅ **Graceful degradation**: Falls back to Set comparison if `diff` unavailable  

---

## Related Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Diff generation** | `server/services/servicenow.cjs:~6415+` | Creates diff.diff output |
| **Property integration** | `server/routes/w2n.cjs:~1985-2020` | **NEW** — Adds diff to Audit |
| **Validation triggers** | `server/services/servicenow.cjs:~6400` | Only generates when FAIL |
| **Notion API calls** | `server/routes/w2n.cjs:~2010+` | Sets Audit property |

---

## Configuration

**Environment Variable**: `SN2N_AUDIT_CONTENT=1` (enables AUDIT system)

**Automatic**: When audit is enabled and validation fails, diff is generated and added to Audit property automatically.

**No additional configuration needed** — if AUDIT is enabled, diff integration is enabled.

---

## Future Enhancements

1. **Separate Diff Property**:
   - Create dedicated "Diff" property for complex pages
   - Keep Audit focused on coverage metrics
   - Store full samples (not truncated)

2. **Block-Level Diff**:
   - Show which blocks are missing (p, li, h1, etc.)
   - Show context (before/after which block)
   - Enable precise debugging

3. **Fuzzy Matching**:
   - Detect similar blocks (not exact matches)
   - Reduce false positives for near-duplicate content
   - Improve accuracy for reformatted text

4. **UI Visualization**:
   - Show missing blocks in Notion UI
   - Highlight in red/yellow based on severity
   - Link to original ServiceNow content

---

## Troubleshooting

**Issue**: Diff section not appearing in Audit property  
**Cause**: Validation passed (coverage ≥ 95%)  
**Fix**: Diff only appears on failures; this is normal

**Issue**: Diff truncated, can't see all samples  
**Cause**: Audit property exceeded 2000 chars  
**Fix**: Check server logs for full output; use DRY-RUN

**Issue**: Samples show wrong text  
**Cause**: Diff extraction picking up different blocks  
**Fix**: Verify same normalization is applied (NFC, whitespace)

**Issue**: Missing blocks != difference in coverage %  
**Cause**: Diff counts blocks, coverage counts characters  
**Fix**: Block count ≠ character count; both are correct

---

## Summary

The diff output is now **fully integrated into the Audit property**, providing:
- ✅ Automatic debugging information
- ✅ Sample text for each missing/extra block
- ✅ Visible directly in Notion database
- ✅ No additional configuration needed
- ✅ Gracefully handles truncation

**Result**: When a page fails validation, you immediately see exactly which content blocks are missing/extra directly in your Notion page.

---

**Version**: v11.0.200  
**File Modified**: `server/routes/w2n.cjs` (lines ~1985-2020)  
**Type**: Enhancement (Integration)
