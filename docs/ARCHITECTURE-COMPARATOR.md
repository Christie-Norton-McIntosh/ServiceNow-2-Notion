# Text Completeness Comparator Architecture

## Overview

The Text Completeness Comparator validates that ServiceNow content is fully captured in Notion pages by comparing canonicalized text representations using LCS (Longest Common Subsequence) or Jaccard shingles algorithms.

## Architecture Flow

```
┌─────────────────┐
│ HTML Source     │
│ (ServiceNow)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Canonicalize    │────▶│ Tokenize         │
│ (Unicode NFKC,  │     │ (word splitting) │
│  punctuation,   │     └────────┬─────────┘
│  whitespace)    │              │
└─────────────────┘              │
                                 │
┌─────────────────┐              │
│ Notion Page     │              │
│ (via API)       │              │
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐              │
│ Fetch Blocks    │              │
│ (recursive,     │              │
│  paginated)     │              │
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐              │
│ Flatten to Text │              │
│ (deterministic) │              │
└────────┬────────┘              │
         │                       │
         ▼                       │
┌─────────────────┐     ┌────────▼─────────┐
│ Canonicalize    │────▶│ Tokenize         │
└────────┬────────┘     └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Compare Tokens        │
         │ (LCS or Jaccard)      │
         └───────────┬───────────┘
                     │
         ┌───────────┴────────────┐
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌──────────────────┐
│ LCS Coverage    │      │ Jaccard Shingles │
│ (exact, O(n*m)) │      │ (approximate,    │
│ DP + backtrack  │      │  scalable)       │
└────────┬────────┘      └─────────┬────────┘
         │                         │
         └────────┬────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │ Missing Spans  │
         │ + Coverage %   │
         └────────┬───────┘
                  │
         ┌────────┴────────────┐
         │                     │
         ▼                     ▼
┌─────────────────┐   ┌────────────────────┐
│ Update DB Props │   │ Append Toggle      │
│ (Coverage,      │   │ (optional, with    │
│  MissingCount,  │   │  missing spans)    │
│  Status, etc.)  │   │                    │
└─────────────────┘   └────────────────────┘
```

## Components

### 1. Canonicalization (`server/utils/canonicalize.cjs`)

**Purpose**: Normalize text for consistent comparison

**Spec**: `canon-v1.4`

**Operations**:
- Unicode normalization (NFKC)
- Non-breaking space → regular space
- Smart quotes → straight quotes
- Em/en dashes → hyphens
- Ellipsis → three dots
- Remove brackets, parentheses, colons, bullets
- Whitespace collapse to single space
- Optional: lowercase conversion

### 2. LCS Coverage (`server/utils/lcs.cjs`)

**Purpose**: Compute exact text coverage with missing spans

**Algorithm**: 
- Dynamic programming O(n*m) table construction
- Backtracking to identify matched tokens
- Contiguous unmatched span extraction

**Guardrail**: Falls back to Jaccard when (n+1)*(m+1) > MAX_CELLS

**Output**:
- Coverage percentage
- Matched token mask
- Missing spans [start, end]
- LCS length

### 3. Jaccard Shingles (fallback in `server/utils/lcs.cjs`)

**Purpose**: Scalable order-insensitive comparison for large content

**Algorithm**:
- Build k-word shingles (default k=5)
- Compute set intersection
- Approximate matching with greedy forward search

**Trade-off**: Faster but less precise than LCS

### 4. Notion Block Flattening (`server/utils/flatten-notion.cjs`)

**Purpose**: Deterministically convert Notion blocks to plain text

**Process**:
- Recursively walk block tree
- Extract rich_text.plain_text from each block
- Add newlines for headings and list items
- Preserve reading order

### 5. API Routes (`server/routes/compare.cjs`)

**Purpose**: Express endpoints for comparisons

**Endpoints**:
- `/api/compare/health` - Health check
- `/api/compare/section` - Compare two strings
- `/api/compare/notion-page` - Compare with Notion page
- `/api/compare/notion-db-row` - Compare + update properties

## Thresholds

### Coverage Threshold
- **Complete**: coverage ≥ 0.97 AND missingCount = 0
- **Attention**: coverage < 0.97 OR missingCount > 0

### Minimum Span Size
- Default: 40 tokens
- Configurable via `MIN_SPAN` env var
- Prevents noise from minor differences

### LCS DP Guardrail
- Default: 50,000,000 cells
- Configurable via `MAX_CELLS` env var
- Triggers Jaccard fallback for large content

## Determinism

### Canonicalization Spec
Version: `canon-v1.4`

Ensures consistent text normalization across:
- Different Unicode representations
- Various punctuation styles
- Multiple whitespace formats

### Block Flattening
Deterministic order preservation:
1. Parent block content first
2. Child blocks in API-returned order
3. Depth-first traversal

## Performance

### LCS Algorithm
- Time: O(n*m)
- Space: O(n*m) for DP table
- Memory-intensive for large inputs

### Jaccard Fallback
- Time: O(n+m) for shingle building + O(k) for intersection
- Space: O(n+m) for shingle sets
- Much faster for large inputs

### Optimization Strategies
1. Early termination: empty inputs
2. Guardrail: MAX_CELLS check before DP
3. Pagination: Notion API (100 blocks/page)
4. Truncation: Rich text in properties (2000 chars)

## Security

### Authentication
- Optional Bearer token (AUTH_TOKEN env var)
- Middleware validates before processing

### Notion Access
- Uses global Notion client from main server
- Inherits NOTION_TOKEN permissions
- No additional auth required

### Content Limits
- Request body: 100mb limit (inherited from main server)
- Rich text: 2000 chars per property field
- Appended blocks: 20 spans max, 100 blocks/request

## Error Handling

### Validation Errors
- Missing required parameters → 400 Bad Request
- Invalid types → 400 Bad Request

### Notion API Errors
- Client not initialized → 500 Internal Server Error
- API failures → 500 with error details

### Computation Errors
- Caught and logged
- Returned as 500 with detail message

## Integration Points

### Main Server (`server/sn2n-proxy.cjs`)
- Routes registered at startup
- Shares global Notion client
- Uses existing CORS and JSON middleware

### Existing Features
- Compatible with W2N workflow
- Can validate pages after creation
- Properties update existing validation fields

### Future Extensions
- Batch comparison endpoint
- Scheduled validation jobs
- Historical trend tracking
