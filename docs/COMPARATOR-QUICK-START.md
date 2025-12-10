# Text Completeness Comparator - Quick Start Guide

## 5-Minute Setup

### 1. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit .env and set at minimum:
NOTION_TOKEN=secret_your_notion_token_here
```

### 2. Start Server

```bash
npm install  # If not already done
npm start
```

You should see:
```
✅ Comparator routes loaded successfully
[SN2N] SN2N proxy listening on port 3004
```

### 3. Test Health

```bash
curl http://localhost:3004/api/compare/health
```

Expected response:
```json
{
  "status": "ok",
  "time": "2025-12-10T22:00:00.000Z",
  "version": {
    "canon": "canon-v1.4",
    "algo": "lcs-v1.0"
  }
}
```

## Common Use Cases

### Use Case 1: Compare Two Text Strings

**Scenario:** Check if destination text contains all source text

```bash
curl -X POST http://localhost:3004/api/compare/section \
  -H "Content-Type: application/json" \
  -d '{
    "srcText": "Approvals must be captured with rationale for audit purposes.",
    "dstText": "Approvals must be captured with rationale.",
    "options": {
      "minMissingSpanTokens": 3
    }
  }'
```

**Response:**
```json
{
  "runId": "028f1bc78519890a",
  "method": "lcs",
  "coverage": 0.555556,
  "lcsLength": 5,
  "srcTokenCount": 9,
  "dstTokenCount": 6,
  "missingSpans": [
    {
      "start": 5,
      "end": 9,
      "text": "rationale for audit purposes."
    }
  ]
}
```

### Use Case 2: Compare ServiceNow HTML with Notion Page

**Scenario:** Validate that a Notion page contains all content from ServiceNow

```bash
curl -X POST http://localhost:3004/api/compare/notion-page \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "12345678-1234-1234-1234-123456789abc",
    "srcText": "Your ServiceNow HTML content extracted as plain text"
  }'
```

**Response:**
```json
{
  "pageId": "12345678-1234-1234-1234-123456789abc",
  "method": "lcs",
  "coverage": 0.987,
  "lcsLength": 1234,
  "srcTokenCount": 1250,
  "dstTokenCount": 1275,
  "missingSpans": [
    {
      "start": 540,
      "end": 592,
      "text": "missing content here..."
    }
  ]
}
```

### Use Case 3: Compare and Update Notion Database

**Scenario:** Validate content and update page properties automatically

```bash
curl -X POST http://localhost:3004/api/compare/notion-db-row \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "12345678-1234-1234-1234-123456789abc",
    "srcText": "Your ServiceNow content"
  }'
```

**Response:**
```json
{
  "pageId": "12345678-1234-1234-1234-123456789abc",
  "updated": true,
  "coverage": 0.987,
  "missingCount": 2,
  "method": "lcs",
  "missingSpans": [
    "missing span 1...",
    "missing span 2..."
  ]
}
```

**Database Properties Updated:**
- `Coverage` (Number): 0.987
- `MissingCount` (Number): 2
- `Method` (Select): lcs
- `LastChecked` (Date): 2025-12-10T22:00:00.000Z
- `MissingSpans` (Rich text): Top 5 spans
- `RunId` (Rich text): Unique identifier
- `Status` (Select): Complete or Attention

## Configuration Options

### Environment Variables

```bash
# Required
NOTION_TOKEN=secret_xxx              # Your Notion integration token

# Optional - Comparator Settings
MAX_CELLS=50000000                   # LCS DP memory guardrail
MIN_SPAN=40                          # Minimum tokens to report a span
APPEND_TOGGLE=false                  # Append missing spans to page

# Optional - Security
AUTH_TOKEN=your-secret-bearer-token  # API authentication
```

### Request Options

All comparison endpoints accept these options:

```json
{
  "options": {
    "maxCells": 50000000,           // LCS DP guardrail
    "minMissingSpanTokens": 40,     // Min tokens to report
    "lowerCase": true               // Case-insensitive comparison
  }
}
```

## Understanding Results

### Coverage Percentage

- **1.0 (100%)**: Perfect match, all source content found in destination
- **0.97-0.99**: Excellent, minor differences (usually formatting)
- **0.90-0.96**: Good, some content missing
- **< 0.90**: Significant content missing

### Status Determination

- **Complete**: `coverage ≥ 0.97` AND `missingCount = 0`
- **Attention**: Any other case

### Method

- **lcs**: Exact LCS algorithm used (dynamic programming)
- **jaccard**: Jaccard shingles fallback used (for very large content)

## Notion Database Setup

### Required Properties

Add these properties to your Notion database:

| Property | Type | Description |
|----------|------|-------------|
| Coverage | Number | Coverage percentage (0.0 to 1.0) |
| MissingCount | Number | Number of missing spans |
| Method | Select | Options: `lcs`, `jaccard` |
| LastChecked | Date | Timestamp of last comparison |
| MissingSpans | Rich text | Top 5 missing spans |
| RunId | Rich text | Unique run identifier |
| Status | Select | Options: `Complete`, `Attention` |

### Formula for Status (Optional)

```
if(prop("Coverage") >= 0.97 and prop("MissingCount") == 0, "Complete", "Attention")
```

## Testing

### Run Smoke Tests

```bash
node server/tests/comparator-smoke-test.cjs
```

Expected output:
```
Running comparator smoke tests...

- Health check ... ✅ PASS
- Exact match (100% coverage) ... ✅ PASS
- Partial match with missing span ... ✅ PASS
- Empty source text ... ✅ PASS
- Empty destination text ... ✅ PASS
- Case sensitivity option ... ✅ PASS
- Punctuation normalization ... ✅ PASS
- Unicode normalization ... ✅ PASS
- Minimum span threshold ... ✅ PASS
- Response fields validation ... ✅ PASS

10 passed, 0 failed

✅ All tests passed
```

## Troubleshooting

### "Notion client not initialized"

**Problem:** Notion token not configured

**Solution:**
```bash
# Check .env file
cat .env | grep NOTION_TOKEN

# Set token if missing
echo "NOTION_TOKEN=secret_your_token" >> .env

# Restart server
npm start
```

### "401 Unauthorized"

**Problem:** AUTH_TOKEN required but not provided

**Solution:**
```bash
# Option 1: Remove AUTH_TOKEN from .env
sed -i '/AUTH_TOKEN/d' .env

# Option 2: Include Bearer token in request
curl -H "Authorization: Bearer YOUR_TOKEN" ...
```

### "Property does not exist"

**Problem:** Required properties missing from database

**Solution:** Add all required properties to your Notion database (see "Notion Database Setup" above)

### Low Coverage (< 0.90) When Content Looks Complete

**Problem:** Text formatting differences (whitespace, punctuation)

**Explanation:** The comparator uses canonicalization to normalize text, but some edge cases may remain

**Solution:**
1. Check the `missingSpans` in the response
2. Compare canonical text manually
3. Adjust `minMissingSpanTokens` if needed

## Next Steps

- [Full API Reference](./API-COMPARATOR.md) - Detailed endpoint documentation
- [Architecture Guide](./ARCHITECTURE-COMPARATOR.md) - How it works under the hood
- [Deployment Guide](./DEPLOYMENT-COMPARATOR.md) - Production deployment
- [Main Documentation](./COMPLETENESS-COMPARATOR.md) - Complete overview

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review [API documentation](./API-COMPARATOR.md)
3. Run smoke tests to verify setup
4. Check server logs for error messages
