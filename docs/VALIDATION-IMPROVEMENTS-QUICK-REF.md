# Validation Improvements — Quick Reference

## v11.0.200: Enhanced Diff & Unicode Normalization

### What Changed

**1. Unicode Normalization (NFC)**
- Applied to both HTML and Notion text extraction
- Fixes smart quotes, accents, composite characters
- Pattern: `.normalize('NFC')` after every text extraction

**2. Line-by-Line Diff**
- Automatic on validation failures (< 95% coverage)
- Shows exactly which blocks are missing
- Uses `diff` library (fallback to Set comparison)

**3. Red Color for Inline Code**
- Changed from `code: true` → `color: 'red'`
- Technical identifiers now included in validation
- ~20% more content validated

### Quick Test

```bash
# 1. Ensure server has latest changes
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion
npm install  # Install 'diff' package

# 2. Start server with AUDIT enabled
SN2N_AUDIT_CONTENT=1 npm start

# 3. Extract a complex page with technical terms

# 4. Check logs for:
#    - "[DIFF]" keywords
#    - "Missing from Notion" section
#    - Block count comparisons
```

### Log Output Example

**Success** (no diff):
```
📊 [AUDIT] ✅ PASS (98.7% coverage) — 2,847 / 2,884 chars
```

**Failure** (shows diff):
```
📊 [AUDIT] ❌ FAIL (92.3% coverage) — 2,663 / 2,884 chars

🔍 ========== ENHANCED DIFF ANALYSIS (v11.0.200) ==========
🔍 [DIFF] HTML blocks extracted: 47
🔍 [DIFF] Notion blocks extracted: 43

❌ [DIFF] Missing from Notion (4 blocks):
   1. "Configure the property mapping to control which ServiceNow fields..."
   2. "The default mapping includes: short_description → Title, sys_id..."
   3. "Click the gear icon to customize field mappings for your workflow."
   4. "See the property mapping guide for advanced configuration options."

🔍 ================================================
```

### Debug Pattern

**Filter logs**:
```bash
# Console filter: /\[DIFF\]/
# Or grep terminal output:
grep "\[DIFF\]" server/logs/server-terminal-*.log
```

**Check diff results**:
```js
// In validation callback:
if (sourceAudit?.result?.diff) {
  console.log(`Missing: ${sourceAudit.result.diff.missingBlocks}`);
  console.log(`Samples:`, sourceAudit.result.diff.missingSamples);
}
```

### Architecture

**Flow**:
1. HTML → AUDIT text extraction (with `.normalize('NFC')`)
2. Notion blocks created
3. Notion → AUDIT text extraction (with `.normalize('NFC')`)
4. Compare character counts (95-100% threshold)
5. **IF FAILED**: Run enhanced diff analysis
6. Store diff results in `sourceAudit.result.diff`

**Code Locations**:
- HTML normalization: `server/services/servicenow.cjs:~294-302`
- Notion normalization: `server/services/servicenow.cjs:~6153-6164`
- Diff analysis: `server/services/servicenow.cjs:~6415+`
- Red color: `server/services/servicenow.cjs:~1055-1067`, `server/converters/rich-text.cjs:~684-690`

### Performance Impact

**Before**: AUDIT takes ~5-10ms per page  
**After**: AUDIT + diff takes ~8-15ms per page (only on failures)

**Typical**: 99% of pages pass validation → no diff overhead

### Troubleshooting

**Issue**: Diff not appearing in logs  
**Fix**: 
1. Check `SN2N_AUDIT_CONTENT=1` is set
2. Verify validation actually failed (< 95%)
3. Search for `[DIFF]` in full log output

**Issue**: Missing blocks seem incorrect  
**Check**:
1. Red-colored text is filtered (technical identifiers)
2. Code blocks are skipped
3. Buttons, figcaptions removed
4. Whitespace normalized

**Issue**: Too many false positives  
**Solution**: 
1. Check Unicode normalization is applied both sides
2. Verify red color filter is working
3. Consider adjusting threshold (currently 95%)

### Related Docs

- Full implementation: `ENHANCED-VALIDATION-v11.0.200.md`
- Inline code changes: `INLINE-CODE-TO-RED-COLOR.md`
- AUDIT system: `docs/AUDIT-VALIDATION-REPLACEMENT.md`
- Auto-validation: `docs/AUTO-VALIDATION.md`

### Next Steps (Future)

**Medium Priority**:
- Use Notion's `plain_text` field (more accurate)
- Consistent newline handling between blocks

**Low Priority**:
- Fuzzy matching for near-identical blocks
- Diff visualization in UI
- Configurable diff detail level
