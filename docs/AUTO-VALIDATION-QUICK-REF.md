# Auto-Validation Quick Reference

## Environment Variables

```bash
# Enable block count validation (±30% tolerance)
export SN2N_VALIDATE_OUTPUT=1

# Enable content validation (text order & completeness, ≥95% similarity)
export SN2N_CONTENT_VALIDATION=1

# Enable verbose logging
export SN2N_VERBOSE=1

# All together
export SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1 SN2N_VERBOSE=1
```

## Start Server with Validation

```bash
# Option 1: Set environment then start
cd server
export SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1
npm start

# Option 2: Inline environment
cd server
SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1 npm start

# Option 3: Use VS Code task "🚀 Start Server (Verbose)"
# Already includes SN2N_VALIDATE_OUTPUT=1
```

## VS Code Tasks

Press `Cmd+Shift+P` → "Run Task" → Select:

- **🚀 Start Server (Verbose)** - Starts with validation enabled
- **🛑 Stop Server** - Kills all node processes
- **🔨 Build Userscript** - Rebuilds client script

## What Gets Validated

### Block Count Validation
- Expected vs actual block count
- ±30% tolerance (70%-150% range)
- Catches: missing blocks, excessive duplication, failed nesting

### Content Validation
- Text content order and completeness
- ≥95% similarity threshold
- Catches: missing text, incorrect order, lost content

## Notion Property Updates

Both validations update:

**Validation** (rich_text):
```
[2025-11-26] Block Validation: ✅ PASS
Expected: 85 blocks | Actual: 87 blocks (102.4%)

[2025-11-26] Content Validation: ✅ PASS  
Similarity: 98.5% | HTML: 12450 chars | Notion: 12478 chars (+0.2%)
```

**Error** (checkbox):
- Checked if EITHER validation fails
- Unchecked if BOTH pass

**Stats** (rich_text, block validation only):
```json
{
  "totalBlocks": 87,
  "expectedBlocks": 85,
  "percentOfExpected": 102.4,
  "maxDepth": 3
}
```

## Failed Pages Auto-Capture

When block validation fails, HTML saved to:

```
patch/pages-to-update/page-title-TIMESTAMP.html
```

With embedded metadata for batch re-extraction.

## Filtering in Notion

**Show failed pages:**
- Filter: `Error` is `checked`

**Show passed pages:**
- Filter: `Error` is `not checked`

**Show block validation failures:**
- Filter: `Validation` contains `Block Validation: ❌`

**Show content validation failures:**
- Filter: `Validation` contains `Content Validation: ❌`

## Batch Re-Extract Failed Pages

```bash
cd patch/config
bash batch-patch-with-cooldown.sh
```

Successful pages move to `patch/pages/updated-pages/`.

## Common Issues

### "Validation skipped"
**Cause:** Environment variable not set
**Fix:** Set `SN2N_VALIDATE_OUTPUT=1` or `SN2N_CONTENT_VALIDATION=1` and restart server

### "Failed to update validation properties"
**Cause:** Missing Notion properties in database schema
**Fix:** Add to database:
- Validation (Rich Text)
- Error (Checkbox)
- Stats (Rich Text)

### Content validation fails but looks correct
**Cause:** Navigation/TOC included in comparison
**Fix:** Check `extractPlainTextFromHtml()` filters in `server/services/content-validator.cjs`

## Implementation Files

- `server/routes/w2n.cjs` - Validation orchestration (lines 1050-1250)
- `server/services/content-validator.cjs` - Content validation logic
- `server/utils/validate-notion-page.cjs` - Block count validation logic
- `docs/AUTO-VALIDATION.md` - Complete documentation
- `docs/NOTION-VALIDATION-PROPERTIES.md` - Property format details

## Testing

```bash
# Extract single page with validation
curl -X POST http://localhost:3004/api/W2N \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Page",
    "databaseId": "xxx",
    "contentHtml": "<html>...</html>",
    "url": "https://example.com",
    "properties": {}
  }'

# Check logs for validation results
# Check Notion page properties
```

## See Also

- `docs/AUTO-VALIDATION.md` - Complete guide
- `docs/NOTION-VALIDATION-PROPERTIES.md` - Property updates
- `docs/CONTENT-VALIDATION-TOOLS.md` - CLI validation tools
- `patch/config/README.md` - Batch workflows
