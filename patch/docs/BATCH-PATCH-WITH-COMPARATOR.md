# Batch PATCH with Text Completeness Comparator

## Overview

The `batch-patch-with-comparator.sh` script enhances the standard PATCH workflow by adding **Text Completeness Comparator** validation. This ensures that pages not only pass standard validation but also have complete content coverage.

## Features

1. **Dual Validation**:
   - Standard validation (block count, structure)
   - Completeness validation (text coverage using LCS/Jaccard)

2. **Automatic Property Updates**:
   - Updates Coverage, MissingCount, Method properties in Notion
   - Updates Status based on combined validation results

3. **Smart File Management**:
   - Successful pages → `updated-pages/`
   - Incomplete content → `incomplete-content/` for review
   - Failed pages remain in `pages-to-update/`

4. **Rate Limit Protection**:
   - Processes in chunks of 3 pages
   - 10-second cooldown between chunks
   - 2-second delay between pages

## Prerequisites

### 1. Notion Database Properties

Add these properties to your Notion database:

| Property | Type | Description |
|----------|------|-------------|
| Coverage | Number | Coverage percentage (0.0 to 1.0) |
| MissingCount | Number | Number of missing text spans |
| Method | Select | Algorithm used: `lcs` or `jaccard` |
| LastChecked | Date | Timestamp of last comparison |
| MissingSpans | Rich text | Top 5 missing spans (truncated) |
| RunId | Rich text | Unique comparison identifier |
| Status | Select | `Complete` or `Attention` |

### 2. Server Configuration

```bash
# Start server with validation enabled
SN2N_VALIDATE_OUTPUT=1 npm start
```

### 3. Environment Variables (Optional)

```bash
# Comparator thresholds
export COVERAGE_THRESHOLD=0.97    # Default: 97% coverage required
export MAX_MISSING_SPANS=0        # Default: No missing spans allowed

# Cooldown settings
export PAGES_PER_CHUNK=3
export COOLDOWN_AFTER_CHUNK=10
export PAGE_DELAY=2
```

## Usage

### Basic Usage

```bash
cd patch/config
bash batch-patch-with-comparator.sh
```

### With Custom Thresholds

```bash
# Allow 95% coverage with up to 2 missing spans
COVERAGE_THRESHOLD=0.95 MAX_MISSING_SPANS=2 bash batch-patch-with-comparator.sh
```

### Dry Run (Check What Would Happen)

The script automatically checks server and comparator availability before processing. If no files are found or servers aren't running, it provides helpful guidance.

## Workflow

### 1. Initial Check
- Verifies server is running
- Checks comparator API availability
- Counts files to process

### 2. For Each Page
```
┌─────────────────────────────────────┐
│ Extract Page ID & Content           │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 1️⃣ PATCH Operation                  │
│   - Delete existing blocks          │
│   - Upload new content              │
│   - Run orchestration               │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Check Standard Validation           │
│   - Block count validation          │
│   - Structure validation            │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 2️⃣ Completeness Comparison          │
│   - Canonicalize source text        │
│   - Fetch Notion page blocks        │
│   - Run LCS/Jaccard comparison      │
│   - Update Notion properties        │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 3️⃣ Final Status Determination       │
│   ✅ Both passed → updated-pages/   │
│   ⚠️ Incomplete → incomplete-content/│
│   ❌ Failed → stays in place        │
└─────────────────────────────────────┘
```

### 3. Status Determination

**Move to `updated-pages/`** if:
- ✅ PATCH successful
- ✅ Standard validation passed
- ✅ Coverage ≥ 0.97 (or custom threshold)
- ✅ Missing spans ≤ 0 (or custom threshold)

**Copy to `incomplete-content/`** if:
- ⚠️ Coverage below threshold
- ⚠️ Missing spans exceed threshold

**Keep in `pages-to-update/`** if:
- ❌ PATCH failed
- ❌ Standard validation failed
- ❌ Comparator validation failed

## Output

### Console Output

```
========================================
Batch PATCH with Completeness Comparator
Started: 2025-12-10 22:00:00
========================================

[SERVER] ✅ Server is healthy
[COMPARATOR] ✅ Comparator API available
[COMPARATOR] Version: canon-v1.4

[PROCESSING] Found 5 HTML files to process

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1/5] Processing: approvals-must-be-captured.html
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📄 Page ID: 12345678-1234-1234-1234-123456789abc
  1️⃣  Running PATCH operation...
  ✅ PATCH successful
  ✅ Standard validation passed
  2️⃣  Running completeness comparison...
  📊 Coverage: 0.987 (threshold: 0.97)
  📊 Missing spans: 0 (max allowed: 0)
  📊 Method: lcs
  ✅ Completeness validation passed
  
  ✅ Moving to updated-pages/ (all validations passed)

========================================
Batch Processing Complete
========================================
Processed: 5
Successful: 4
Failed PATCH: 0
Failed Standard Validation: 1
Failed Completeness: 1
Incomplete Content: 1 (see patch/pages/incomplete-content/)

Log file: patch/pages/log/batch-patch-comparator-20251210-220000.log
Finished: 2025-12-10 22:05:30
========================================
```

### Log File

Detailed log saved to `patch/pages/log/batch-patch-comparator-YYYYMMDD-HHMMSS.log`

## Directory Structure

```
patch/pages/
├── pages-to-update/          # Input: Pages to PATCH
│   ├── page1.html           # Stays if validation fails
│   └── page2.html
├── updated-pages/            # Output: Successfully updated
│   └── page1.html           # Moved after all validations pass
├── incomplete-content/       # NEW: Pages with content gaps
│   └── page3.html           # Copied for content review
├── problematic-files/        # Timeout/API errors
├── failed-validation/        # JSON error details
└── log/                      # Execution logs
    └── batch-patch-comparator-*.log
```

## Troubleshooting

### Comparator Not Available

```
[WARNING] Comparator API not available - will skip completeness validation
```

**Solution**: Ensure the comparator routes are registered. The script will continue with standard validation only.

### No Files Found

```
[INFO] No files found in patch/pages/pages-to-update
```

**Solution**: Pages are auto-saved to this directory when validation fails during AutoExtract. To populate:

1. Enable validation: `export SN2N_VALIDATE_OUTPUT=1`
2. Run AutoExtract on ServiceNow pages
3. Pages with validation failures will auto-save

### Coverage Below Threshold

```
❌ Completeness validation failed
   Coverage 0.87 below threshold 0.97
```

**Options**:
1. Review the page in `incomplete-content/`
2. Lower threshold: `COVERAGE_THRESHOLD=0.87 bash batch-patch-with-comparator.sh`
3. Re-extract from ServiceNow with better content capture

### Missing Spans Detected

```
📊 Missing spans: 3 (max allowed: 0)
```

**Action**: Check the MissingSpans property in Notion for the specific missing content. Re-extract or manually add the missing content.

## Comparison with Standard PATCH

| Feature | Standard PATCH | With Comparator |
|---------|---------------|-----------------|
| Block count validation | ✅ | ✅ |
| Structure validation | ✅ | ✅ |
| Text completeness | ❌ | ✅ |
| Missing content detection | ❌ | ✅ |
| Coverage metrics | ❌ | ✅ |
| Notion properties updated | Validation, Stats | + Coverage, MissingCount, Status |

## Best Practices

1. **Start with Standard PATCH**: Use `batch-patch-with-cooldown.sh` for initial updates
2. **Add Comparator**: Use this script for critical pages requiring content validation
3. **Review Incomplete**: Check `incomplete-content/` directory for pages needing attention
4. **Adjust Thresholds**: Lower `COVERAGE_THRESHOLD` if normal differences are expected
5. **Monitor Logs**: Review logs for patterns in completeness issues

## Integration with Existing Workflow

This script complements the existing PATCH workflow:

```bash
# Option 1: Standard PATCH (fast, structure validation only)
bash batch-patch-with-cooldown.sh

# Option 2: PATCH with completeness validation (thorough)
bash batch-patch-with-comparator.sh

# Option 3: Re-validate already patched pages
bash revalidate-updated-pages.sh
```

## See Also

- [Text Completeness Comparator](../../docs/COMPLETENESS-COMPARATOR.md) - Feature overview
- [API Reference](../../docs/API-COMPARATOR.md) - Comparator API details
- [PATCH Workflow](../../docs/patch-workflow.md) - Standard PATCH documentation
- [Auto-Validation](../../docs/AUTO-VALIDATION.md) - Auto-save documentation
