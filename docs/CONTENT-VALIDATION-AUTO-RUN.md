# Automatic Content Validation - Implementation Summary

## Overview

Content validation has been integrated into the auto-extraction workflow. Every page captured during AutoExtract now automatically runs content validation and updates Notion properties with results.

## What Was Implemented

### 1. Server-Side Content Validator Service

**File:** `server/services/content-validator.cjs`

**Functions:**
- `extractPlainTextFromHtml(html)` - Extracts text from HTML (removes nav, scripts, TOC)
- `extractTextFromNotionBlocks(notion, blockId)` - Recursively extracts text from Notion blocks
- `normalizeText(text)` - Normalizes for comparison (lowercase, remove punctuation, collapse whitespace)
- `calculateSimilarity(arr1, arr2)` - LCS algorithm for similarity percentage
- `validateContentOrder(html, pageId, notion)` - Main validation orchestrator
- `updateNotionValidationProperty(pageId, result, notion)` - Updates Notion properties
- `runValidationAndUpdate(html, pageId, notion)` - Complete workflow (validate + update)

### 2. Integration with W2N Route

**File:** `server/routes/w2n.cjs`

**Changes:**
- Added import: `const { runValidationAndUpdate } = require('../services/content-validator.cjs')`
- Added validation check after block validation (lines ~1215-1240)
- Runs automatically when `SN2N_CONTENT_VALIDATION=1` is set
- Updates Notion page properties with results
- Independent from block-count validation

**Flow:**
```
Page Created → Block Validation → Content Validation → Properties Updated
```

### 3. Documentation

**Created/Updated:**
- `docs/AUTO-VALIDATION.md` - Complete guide for both validation systems
- `docs/AUTO-VALIDATION-QUICK-REF.md` - Quick reference for developers
- `docs/NOTION-VALIDATION-PROPERTIES.md` - Property format specifications
- `.github/copilot-instructions.md` - Updated with new validation info

## How to Use

### Enable Content Validation

Set environment variable:

```bash
export SN2N_CONTENT_VALIDATION=1
```

Or start server with:

```bash
cd server
SN2N_CONTENT_VALIDATION=1 npm start
```

Or use VS Code task: **"🚀 Start Server (Verbose)"** (may need to add variable)

### Enable Both Validations

```bash
export SN2N_VALIDATE_OUTPUT=1        # Block count validation
export SN2N_CONTENT_VALIDATION=1     # Content validation
```

### AutoExtract Flow

1. User starts AutoExtract in browser
2. For each page:
   - Content extracted
   - Sent to proxy server
   - Page created in Notion
   - **Block validation runs** (if enabled)
   - **Content validation runs** (if enabled)
   - Properties updated with results
3. Failed pages automatically saved to `patch/pages-to-update/`

### Notion Property Updates

**Validation Property:**
```
[2025-11-26] Block Validation: ✅ PASS
Expected: 85 blocks | Actual: 87 blocks (102.4%)

[2025-11-26] Content Validation: ✅ PASS
Similarity: 98.5% | HTML: 12450 chars | Notion: 12478 chars (+0.2%)
All content present and in correct order.
```

**Error Checkbox:**
- Checked if EITHER validation fails
- Unchecked if BOTH pass

## Validation Criteria

### Block Count Validation
- **Pass:** Actual blocks within ±30% of expected (70%-150%)
- **Fail:** Outside tolerance range

### Content Validation
- **Pass:** ≥95% text similarity using LCS algorithm
- **Fail:** <95% similarity (missing/incorrect content)

## Benefits

1. **Automatic Quality Control** - Every page validated without manual intervention
2. **Immediate Feedback** - Results visible in Notion properties
3. **Filterable** - Use Error checkbox to find problematic pages
4. **Independent Systems** - Block and content validation catch different issues
5. **Audit Trail** - Validation history preserved in Validation property

## Testing

### Verify Implementation

1. **Start server with validation:**
   ```bash
   cd server
   SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1 SN2N_VERBOSE=1 npm start
   ```

2. **Extract a test page:**
   - Use browser AutoExtract
   - Or POST to `/api/W2N` endpoint

3. **Check server logs for:**
   ```
   📋 [VALIDATION] Starting content validation for page xxx
      ✓ Found X HTML segments
      ✓ Found Y Notion segments
      📊 Similarity: Z%
      ✅ PASS - Content validation passed
      ✓ Updated Notion page properties
   ```

4. **Check Notion page:**
   - Validation property shows results
   - Error checkbox reflects pass/fail
   - Stats property (block validation) shows details

### Expected Log Output

```
✅ Page created successfully: page-id-here
📤 Sending response to client...
✅ Response sent - continuing with post-processing...

🔍 Running post-creation validation...
✅ Validation function completed
✅ Validation passed - clearing Error checkbox
📊 Setting Stats property with validation statistics
✅ Validation properties updated successfully

📋 Running content validation (text order and completeness)...
📋 [VALIDATION] Starting content validation for page page-id-here
   📝 Extracting text from HTML...
   ✓ Found 145 HTML segments (138 after normalization)
   🌐 Fetching text from Notion page...
   ✓ Found 142 Notion segments (138 after normalization)
   📊 Similarity: 98.5%
   ✅ PASS - Content validation passed
   ✓ Updated Notion page properties with validation results
✅ Content validation PASSED (98.5% similarity)

🔗 Page URL: https://www.notion.so/...
```

## Troubleshooting

### Content Validation Not Running

**Check logs for:**
```
ℹ️ Content validation skipped (SN2N_CONTENT_VALIDATION not enabled)
```

**Solution:** Set environment variable and restart server.

### "Failed to update Notion validation property"

**Possible causes:**
1. Database missing Validation or Error properties
2. Notion API token expired
3. Rate limit exceeded

**Solution:**
- Ensure database has Validation (Rich Text) and Error (Checkbox) properties
- Check `NOTION_TOKEN` environment variable
- Wait and retry if rate limited

### Low Similarity Score

**If similarity <95% but page looks correct:**
1. Check HTML extraction filters
2. Review text normalization logic
3. Verify Notion text extraction includes all block types

**Debug by checking log output:**
```
   ✓ Found X HTML segments (Y after normalization)
   ✓ Found X Notion segments (Y after normalization)
```

Large discrepancy indicates missing content.

## Architecture

### Text Extraction

**HTML:**
```
HTML → Cheerio → Remove nav/scripts/TOC → Extract text nodes → Segments
```

**Notion:**
```
Page ID → Fetch blocks → Recursive traversal → Extract rich_text → Segments
```

### Comparison

```
HTML Segments → Normalize (lowercase, no punct, trim) → Normalized HTML
Notion Segments → Normalize (lowercase, no punct, trim) → Normalized Notion
                                ↓
                        LCS Algorithm
                                ↓
                    Similarity Percentage
                                ↓
                        Pass (≥95%) / Fail (<95%)
```

### Property Update

```
Validation Result → Format text → Update Notion API
                                       ↓
                            [Date] Content Validation: STATUS
                            Similarity: X% | Chars: HTML vs Notion
                            Summary message
```

## Files Modified

1. `server/services/content-validator.cjs` - **NEW** - Core validation logic
2. `server/routes/w2n.cjs` - Added content validation integration
3. `docs/AUTO-VALIDATION.md` - **NEW** - Complete documentation
4. `docs/AUTO-VALIDATION-QUICK-REF.md` - **NEW** - Quick reference
5. `.github/copilot-instructions.md` - Updated with validation info

## Next Steps

1. **Test with real AutoExtract session:**
   - Start AutoExtract in browser
   - Capture 5-10 pages
   - Verify validation runs for each
   - Check Notion properties updated

2. **Monitor validation rates:**
   - Create Notion views for passed/failed pages
   - Track similarity percentages
   - Identify patterns in failures

3. **Tune threshold if needed:**
   - Current: 95% similarity required
   - Adjust in `content-validator.cjs` if too strict/lenient

4. **Add to batch scripts:**
   - Consider adding content validation to PATCH operations
   - Update batch scripts to report validation stats

## Success Criteria

- [x] Content validation runs automatically after page creation
- [x] Results update Notion properties
- [x] Independent from block validation
- [x] Configurable via environment variable
- [x] Comprehensive documentation
- [ ] Tested with real AutoExtract session (next step)

## Status

**Implementation:** ✅ COMPLETE  
**Documentation:** ✅ COMPLETE  
**Server Running:** ✅ WITH VALIDATION ENABLED  
**Testing:** ⏳ Ready for production test

---

*Implementation Date: November 26, 2025*  
*Version: 11.0.6 (content validation auto-run feature)*
