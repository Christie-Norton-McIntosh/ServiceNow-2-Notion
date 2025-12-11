# Text Completeness Comparator API Reference

## Base URL

When running locally: `http://localhost:3004/api/compare`

## Authentication

Optional Bearer token authentication. If `AUTH_TOKEN` is set in environment variables, include it in requests:

```
Authorization: Bearer YOUR_AUTH_TOKEN
```

## Endpoints

### Health Check

**GET** `/api/compare/health`

Returns health status and version information.

**Response**
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

---

### Compare Two Text Sections

**POST** `/api/compare/section`

Compare two arbitrary text sections and return coverage statistics with exact missing spans.

**Request Body**
```json
{
  "srcText": "string (required)",
  "dstText": "string (required)",
  "options": {
    "maxCells": 50000000,
    "minMissingSpanTokens": 40,
    "lowerCase": true
  }
}
```

**Parameters**
- `srcText` (string, required) - Source text to check coverage for
- `dstText` (string, required) - Destination text to compare against
- `options.maxCells` (number, optional) - LCS DP guardrail, default: 50,000,000
- `options.minMissingSpanTokens` (number, optional) - Minimum tokens to report a span, default: 40
- `options.lowerCase` (boolean, optional) - Convert to lowercase, default: true

**Response**
```json
{
  "runId": "2f74b9c91b3b0e5e",
  "method": "lcs",
  "coverage": 0.987,
  "lcsLength": 1234,
  "srcTokenCount": 1250,
  "dstTokenCount": 1275,
  "missingSpans": [
    {
      "start": 540,
      "end": 592,
      "text": "exact canonical missing text ..."
    }
  ],
  "params": {
    "lowerCase": true,
    "maxCells": 50000000,
    "minMissingSpanTokens": 40
  },
  "version": {
    "canon": "canon-v1.4",
    "algo": "lcs-v1.0"
  }
}
```

**Response Fields**
- `runId` - Unique identifier for this comparison run
- `method` - Algorithm used: `lcs` or `jaccard`
- `coverage` - Coverage percentage (0.0 to 1.0)
- `lcsLength` - Length of longest common subsequence
- `srcTokenCount` - Number of tokens in source
- `dstTokenCount` - Number of tokens in destination
- `missingSpans` - Array of missing text spans with indices and canonical text

---

### Compare Against Notion Page

**POST** `/api/compare/notion-page`

Fetches **page content** via **Blocks Children** (pagination + recursion), flattens deterministically, canonicalizes, and compares with source text.

**Request Body**
```json
{
  "pageId": "YOUR_PAGE_ID",
  "srcText": "string (required)",
  "options": {
    "maxCells": 50000000,
    "minMissingSpanTokens": 40,
    "lowerCase": true
  }
}
```

**Parameters**
- `pageId` (string, required) - Notion page ID (32-char UUID with or without hyphens)
- `srcText` (string, required) - Source text to check coverage for
- `options` - Same as `/section` endpoint

**Response**
```json
{
  "pageId": "YOUR_PAGE_ID",
  "method": "lcs",
  "coverage": 0.987,
  "lcsLength": 1234,
  "srcTokenCount": 1250,
  "dstTokenCount": 1275,
  "missingSpans": [
    {
      "start": 540,
      "end": 592,
      "text": "exact canonical missing text ..."
    }
  ]
}
```

---

### Compare and Update Database Properties

**POST** `/api/compare/notion-db-row`

Compares source text with Notion page content and **writes results** to **database page properties** via `pages.update`. Updates properties: Coverage, MissingCount, Method, LastChecked, MissingSpans, RunId, Status.

**Optional:** Append a callout/toggle containing canonical missing text if `APPEND_TOGGLE=true` in environment.

**Request Body**
```json
{
  "pageId": "YOUR_DB_PAGE_ID",
  "srcText": "string (required)",
  "options": {
    "maxCells": 50000000,
    "minMissingSpanTokens": 40,
    "lowerCase": true
  }
}
```

**Parameters**
- `pageId` (string, required) - Notion database page ID
- `srcText` (string, required) - Source text to check coverage for
- `options` - Same as `/section` endpoint

**Response**
```json
{
  "pageId": "YOUR_DB_PAGE_ID",
  "updated": true,
  "coverage": 0.987,
  "missingCount": 2,
  "method": "lcs",
  "missingSpans": [
    "exact canonical missing text span 1 ...",
    "exact canonical missing text span 2 ..."
  ]
}
```

**Database Properties Updated**
- `Coverage` (Number) - Coverage percentage
- `MissingCount` (Number) - Number of missing spans
- `Method` (Select) - `lcs` or `jaccard`
- `LastChecked` (Date) - ISO timestamp
- `MissingSpans` (Rich text) - Top 5 spans (truncated to 2000 chars each)
- `RunId` (Rich text) - 16-char hash identifier
- `Status` (Select) - `Complete` (coverage ≥ 0.97 and no missing spans) or `Attention`

---

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "Error message",
  "detail": "Additional details (optional)"
}
```

**Status Codes**
- `400` - Bad request (missing parameters)
- `401` - Unauthorized (invalid Bearer token)
- `500` - Internal server error

## Examples

### Basic Section Comparison

```bash
curl -X POST http://localhost:3004/api/compare/section \
  -H "Content-Type: application/json" \
  -d '{
    "srcText": "Approvals must be captured with rationale for audit purposes",
    "dstText": "Approvals must be captured with rationale",
    "options": {
      "minMissingSpanTokens": 3
    }
  }'
```

### Compare with Notion Page

```bash
curl -X POST http://localhost:3004/api/compare/notion-page \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "12345678-1234-1234-1234-123456789abc",
    "srcText": "Your source text here..."
  }'
```

### Update Database Row

```bash
curl -X POST http://localhost:3004/api/compare/notion-db-row \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "12345678-1234-1234-1234-123456789abc",
    "srcText": "Your source text here..."
  }'
```

## Notes

- Page IDs can be provided with or without hyphens
- Text content is automatically flattened from Notion blocks
- Appended child blocks are limited per request (max 100 blocks, two nesting levels)
- Large text comparisons automatically fall back to Jaccard shingles when exceeding `maxCells`
