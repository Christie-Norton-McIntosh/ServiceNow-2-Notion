# Marker Cleanup System

## Overview

This system addresses pages that were created during AutoExtract but timed out before marker cleanup could complete, leaving `sn2n:marker` tokens in the Notion page content.

## Problem

When AutoExtract processes complex pages:
1. Client sends HTML to proxy server (timeout: 480s)
2. Server creates Notion page with deep nesting markers
3. Server runs marker sweep to clean up tokens
4. **If total processing > 480s**: Client times out, but server continues
5. Page is created successfully, but markers remain unresolved
6. Page has no validation data (validation runs after client receives response)

**Impact**: 55 pages with markers and no validation (as of v11.0.6)

## Solution Components

### 1. Prevention (v11.0.6)

**Client-Side Timeout Increase:**
- `src/api/proxy-api.js`: 300s → 480s
- Matches server adaptive timeout (batch PATCH)

**Timeout Recovery Logic:**
- `src/ui/main-panel.js`: Detect timeout, wait 60s, log warning, continue
- Prevents AutoExtract halt on timeout
- Logs warning: "⚠️ Page may have unresolved markers"

### 2. Remediation

**Marker Cleanup Endpoint:**
```
POST /api/W2N/:pageId/cleanup-markers
```

**Functionality:**
- Accepts 32-char page ID (with or without hyphens)
- Calls `sweepAndRemoveMarkersFromPage` from `deep-nesting.cjs`
- Returns `{ updated: number }` - count of blocks cleaned
- Includes retry logic for rate limits and conflicts

**Implementation:**
- File: `server/routes/w2n.cjs` (lines 2102-2166)
- Uses same sweep function as normal page creation
- Logging tag: `[MARKER-CLEANUP]`

## Usage

### Quick Test (Single Page)

```bash
# Test cleanup on one page
node test-marker-cleanup-endpoint.cjs <pageId>

# Example
node test-marker-cleanup-endpoint.cjs 1234567890abcdef1234567890abcdef
```

**Expected Output:**
```
🧹 Testing marker cleanup endpoint for page 1234567890abcdef1234567890abcdef...

📊 Status: 200

📦 Response:
{
  "success": true,
  "data": {
    "pageId": "1234567890abcdef1234567890abcdef",
    "updated": 12,
    "elapsedMs": 3456,
    "message": "Cleaned 12 block(s) with marker tokens"
  }
}

✅ Success! Updated 12 block(s)
⏱️  Elapsed: 3.5s
```

### Batch Cleanup (All Affected Pages)

```bash
# 1. Find pages with markers (outputs to file)
node find-pages-with-markers.cjs > pages-with-markers.txt

# 2. Run batch cleanup
bash batch-cleanup-markers.sh < pages-with-markers.txt

# Or pipe directly
node find-pages-with-markers.cjs 2>/dev/null | bash batch-cleanup-markers.sh
```

**Output:**
```
🧹 Batch Marker Cleanup
Started: Mon Jan 20 10:30:00 PST 2025

📋 Reading page IDs from stdin...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Page 1: 1234567890abcdef1234567890abcdef
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SUCCESS
   Blocks updated: 8
   Elapsed: 2.3s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Page 2: abcdef1234567890abcdef1234567890
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SUCCESS
   Blocks updated: 15
   Elapsed: 4.1s

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total pages:    55
Successful:     55
Failed:         0
Blocks updated: 634

Completed: Mon Jan 20 10:45:23 PST 2025
Log: ./logs/marker-cleanup-20250120-103000.log

✅ All pages cleaned successfully!
```

## Scripts Reference

### `find-pages-with-markers.cjs`

**Purpose:** Query Notion database for pages with marker tokens

**How it works:**
- Queries Notion API with filter: `Validation contains "sn2n:"`
- Outputs page IDs to stdout (one per line)
- Logs progress to stderr (can be redirected separately)

**Usage:**
```bash
# Save to file
node find-pages-with-markers.cjs > pages.txt

# Pipe to cleanup
node find-pages-with-markers.cjs 2>/dev/null | bash batch-cleanup-markers.sh

# View progress only
node find-pages-with-markers.cjs 2>&1 > /dev/null
```

### `batch-cleanup-markers.sh`

**Purpose:** Execute cleanup for multiple pages with progress tracking

**Features:**
- Rate limit protection (500ms between requests)
- Progress tracking with page numbers
- Success/failure summary
- Timestamped logs in `./logs/`

**Requirements:**
- Server running on port 3004
- Page IDs from stdin or file
- `jq` for JSON parsing (install: `brew install jq`)

### `test-marker-cleanup-endpoint.cjs`

**Purpose:** Test single page cleanup

**Usage:**
```bash
node test-marker-cleanup-endpoint.cjs <pageId>
```

**Use cases:**
- Verify endpoint works before batch run
- Test specific problematic page
- Quick validation check

## Troubleshooting

### Server Not Running

```
❌ Error: Server not running on port 3004
```

**Fix:**
```bash
# Start server with verbose logging
npm start

# Or use VS Code task
# "🚀 Start Server (Verbose)"
```

### Invalid Page ID

```
❌ Error: Page ID must be 32 characters (UUID without hyphens)
```

**Fix:**
- Remove hyphens from UUID: `123e4567-e89b-12d3-a456-426614174000` → `123e4567e89b12d3a456426614174000`
- Verify length is exactly 32 characters

### No Pages Found

```
✅ Search complete. Found 0 page(s) with markers.
```

**Possible causes:**
1. All markers already cleaned (good!)
2. Database ID incorrect in script
3. Validation property doesn't contain "sn2n:"

**Verify manually in Notion:**
- Open database
- Filter: Validation contains "sn2n:"
- Check if pages exist

### Rate Limit Errors

The cleanup endpoint includes built-in rate limit protection with exponential backoff:
- Max 5 retries per page
- Delays: 1s, 2s, 4s, 5s, 5s

If still hitting rate limits:
```bash
# Increase delay in batch script
# Edit batch-cleanup-markers.sh line 24:
DELAY_MS=1000  # Changed from 500
```

## Monitoring

### Server Logs

Look for `[MARKER-CLEANUP]` tags:
```
🧹 [MARKER-CLEANUP] Starting marker cleanup for page 1234...
✅ [MARKER-CLEANUP] Completed in 3.2s. Blocks updated: 12
```

### Batch Logs

Stored in `./logs/marker-cleanup-YYYYMMDD-HHMMSS.log`

**Example:**
```bash
# View latest log
tail -f logs/marker-cleanup-*.log | grep -E '(SUCCESS|FAILED|SUMMARY)'

# Count successes
grep '✅ SUCCESS' logs/marker-cleanup-*.log | wc -l

# Find failures
grep '❌ FAILED' logs/marker-cleanup-*.log
```

## Integration with Auto-Validation

After marker cleanup, pages should be re-validated:

```bash
# Option 1: PATCH endpoint (deletes all blocks, re-creates)
curl -X PATCH http://localhost:3004/api/W2N/<pageId> \
  -H "Content-Type: application/json" \
  -d '{"title":"...","contentHtml":"...","url":"..."}'

# Option 2: Trigger AutoExtract on same page (if still available)
# Manual process via userscript UI
```

**Note:** Marker cleanup only removes tokens, doesn't run validation. Pages will still show validation errors until re-extracted or patched.

## Future Improvements

1. **Auto-Validation After Cleanup:**
   - Run content validation automatically after marker removal
   - Update Validation property with "Markers cleaned" status

2. **Notification System:**
   - Email/Slack notification when markers detected
   - Daily summary of cleanup operations

3. **Prevention Enhancement:**
   - Adaptive timeout based on page complexity
   - Partial marker sweep checkpoints
   - Resume capability after timeout

4. **Monitoring Dashboard:**
   - Track marker cleanup metrics
   - Identify pages prone to timeout
   - Performance trends over time

## Related Documentation

- `docs/AUTO-VALIDATION.md` - Validation system overview
- `patch/README.md` - Batch PATCH workflow
- `.github/copilot-instructions.md` - Development patterns
- `server/orchestration/deep-nesting.cjs` - Marker sweep implementation
