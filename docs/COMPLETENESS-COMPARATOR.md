# ServiceNow → Notion Completeness Comparator

Validate that text captured from ServiceNow pages is **complete** in Notion despite formatting/nesting differences. We canonicalize both sources, compute **LCS coverage** (exact missing spans) with **Jaccard shingles** fallback for very large sections, then update a Notion **database page** with structured results and (optionally) append a **toggle** on the page containing canonical missing text.

## Overview

The Text Completeness Comparator provides a way to validate that content extracted from ServiceNow pages is fully captured in Notion pages, even when formatting and structure differ between the two systems.

## Key Features

- **Canonicalization**: Normalizes text for consistent comparison (Unicode NFKC, punctuation mapping, whitespace normalization)
- **LCS Coverage**: Computes exact missing text spans using dynamic programming
- **Jaccard Fallback**: Scalable order-insensitive comparison for very large content
- **Notion Integration**: Fetches page content, updates database properties, optional toggle append
- **Configurable Thresholds**: Customize coverage requirements and minimum span sizes
- **Multiple Usage Options**: Integrated PATCH workflow, standalone validation, or manual API calls

## Usage Options

The comparator can be used in three ways:

1. **Option A: Integrated PATCH Workflow** - Automatically validates during PATCH operations
2. **Option B: Standalone Validation** - Validate existing pages without re-PATCHing
3. **Option C: Manual API Calls** - Direct API integration for custom workflows

See [COMPARATOR-LOCAL-USAGE.md](COMPARATOR-LOCAL-USAGE.md) for detailed instructions on all three options.

## Key References

- **Notion page content** is represented as **block children**; retrieve/append via the Blocks Children endpoints. Structured data belongs in **page properties**.
- **Update page properties** in a Notion database using `pages.update`.
- **Express 4** (Node ≥ 18) provides built-in `express.json()` middleware for APIs.
- **LCS DP/backtracking** vs **Jaccard shingles** trade-off (exact vs scalable).

## API Endpoints

### Health Check
- **GET** `/api/compare/health` — Health check with version information

### Text Comparison
- **POST** `/api/compare/section` — Coverage + exact canonical missing text between two strings
- **POST** `/api/compare/notion-page` — Fetch Notion page blocks → flatten → compare
- **POST** `/api/compare/notion-db-row` — Compare and **write** results to DB properties; optional toggle append

## Thresholds (defaults)

- **Complete** when `coverage ≥ 0.97` and **MissingCount = 0**
- Report missing spans when **≥ 40 tokens**
- LCS DP guardrail: **50 million cells** (triggers Jaccard fallback)

## Notion Database Properties

To use the database integration features, add these properties to your Notion database:

- `Coverage` (Number) - Coverage percentage (0.0 to 1.0)
- `MissingCount` (Number) - Number of missing spans detected
- `Method` (Select) - Algorithm used: `lcs` or `jaccard`
- `LastChecked` (Date) - Timestamp of last comparison
- `MissingSpans` (Rich text) - Top 5 missing spans as text
- `RunId` (Rich text) - Unique run identifier
- `Status` (Select or Formula) - `Complete` or `Attention`

## Configuration

Configuration is done via environment variables. See `.env.example` for all options:

```bash
# Text Completeness Comparator Configuration
MAX_CELLS=50000000      # LCS DP guardrail: (n+1)*(m+1)
MIN_SPAN=40             # Min tokens to report a missing span

# Optional: append a callout/toggle with missing spans on the page
APPEND_TOGGLE=false     # true => append a callout/toggle with missing spans

# Optional: Bearer token for API authentication
# AUTH_TOKEN=replace-with-secret
```

## Run Locally

```bash
# Install dependencies (if not already installed)
npm install

# Configure environment
cp .env.example .env
# Edit .env and set NOTION_TOKEN and other values

# Start the server
npm start

# Check health
curl http://localhost:3004/api/compare/health
```

## Why Hybrid (Properties + Toggle)?

- **Properties**: Queryable, filterable KPIs (dashboards, rollups)
- **Toggle content**: Editor-friendly remediation in context (optional). Append children with limits.

## Integration with W2N Workflow

The comparator is designed to work alongside the existing W2N (Web-to-Notion) workflow:

1. Extract content from ServiceNow using W2N
2. Create Notion page with formatted content
3. Use comparator to validate completeness
4. Update page properties with validation results
5. Optionally append missing spans for editor review

## See Also

- [API Reference](./API-COMPARATOR.md)
- [Architecture Details](./ARCHITECTURE-COMPARATOR.md)
- [Deployment Guide](./DEPLOYMENT-COMPARATOR.md)
