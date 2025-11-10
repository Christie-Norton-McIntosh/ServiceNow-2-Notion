# Rate Limit Protection for AutoExtract

## Overview

The ServiceNow-2-Notion tool now includes comprehensive rate limit protection to ensure **no content is lost** during AutoExtract sessions when Notion's API rate limits are hit.

## How It Works

### 1. Server-Side Protection (Proxy)

**Location**: `server/routes/w2n.cjs` (lines 630-680)

The proxy server automatically detects and handles rate limit errors (HTTP 429) from the Notion API:

- **Automatic Detection**: Catches `429 Too Many Requests` errors, `rate_limited` error codes, and rate limit messages
- **Exponential Backoff**: Waits progressively longer between retries (10s, 20s, 30s, etc., up to 60s max)
- **Retry-After Header**: Respects Notion's `retry-after` header when provided
- **Multiple Attempts**: Retries up to 5 times before giving up
- **Detailed Logging**: Logs rate limit hits, wait times, and retry attempts

**Example Log Output**:
```
⚠️ 🚦 RATE LIMIT HIT (attempt 1/6)
   Page: "Create a Product Catalog Item"
   Waiting 10 seconds before retry...
   💡 Tip: Notion API has rate limits. AutoExtract will automatically retry.
   ✅ Retry-after cooldown complete, attempting page creation again...
```

### 2. Client-Side Protection (AutoExtract)

**Location**: `src/ui/main-panel.js`

The AutoExtract feature includes intelligent rate limit handling:

- **Automatic Pause**: When rate limit is detected, AutoExtract pauses for 60 seconds
- **Failed Pages Tracking**: Maintains a list of pages that failed due to rate limiting
- **Automatic Retry**: After cooldown, retries the same page automatically
- **Progress Preservation**: Current page number and extraction state are preserved
- **User Feedback**: Shows countdown timer and clear status messages

**Example User Experience**:
```
⏸️ Rate limit hit! Pausing for 60s before retrying...
[Button shows: "⏸️ Paused: Rate limit (60s)..."]
[After 60s]
✅ Cooldown complete, retrying page 15...
```

### 3. Failed Pages Management

If a page fails after all retry attempts:

1. **Tracking**: Page info (URL, title, page number, timestamp, error) is saved
2. **Storage**: Failed pages list is saved to Tampermonkey storage
3. **Summary Report**: At the end of AutoExtract, a detailed report shows:
   - Total successful pages
   - Total failed pages
   - Rate limit hit count
   - List of failed pages with reasons

**Example Summary**:
```
⚠️ AutoExtract completed with warnings!

✅ Successfully processed: 23 pages
❌ Failed/Skipped: 2 pages
🚦 Rate limit hits: 3

Failed pages list:
1. Advanced Configuration Options (page 15)
   Reason: rate_limit
2. Troubleshooting Guide (page 22)
   Reason: rate_limit

Failed pages have been saved. You can manually retry them later.
```

## Best Practices

### For Users

1. **Monitor Progress**: Keep an eye on the AutoExtract button text for status updates
2. **Check Console**: Open browser DevTools console to see detailed rate limit logs
3. **Review Summary**: After AutoExtract completes, check the summary for any failed pages
4. **Manual Retry**: Visit failed pages manually and use single-page extract

### For Developers

1. **Rate Limit Tracking**: Check `autoExtractState.rateLimitHits` to monitor frequency
2. **Failed Pages Access**: Access failed pages list via `GM_getValue('w2n_failed_pages')`
3. **Debug Logging**: Enable verbose logging with `debug()` calls for troubleshooting

## Configuration

### Server-Side Settings

```javascript
const maxRateLimitRetries = 5; // Max retries for rate limiting
const maxRetries = 2; // Max retries for network errors
```

**Adjust in**: `server/routes/w2n.cjs` (line ~636)

### Client-Side Settings

```javascript
const waitSeconds = 60; // Default cooldown period in seconds
```

**Adjust in**: `src/ui/main-panel.js` (line ~1184)

## Technical Details

### Rate Limit Detection

The system detects rate limits through multiple signals:

1. **HTTP Status**: `error.status === 429`
2. **Error Code**: `error.code === 'rate_limited'`
3. **Error Message**: Contains "rate limit", "429", or "too many requests"

### Retry Strategy

**Server-Side**:
- Uses the lesser of `retry-after` header or `(retryCount * 10) seconds`
- Maximum wait time capped at 60 seconds per retry
- Total max retries: 5 attempts
- Total possible wait time: ~150 seconds (2.5 minutes)

**Client-Side**:
- Single 60-second pause when rate limit detected
- One automatic retry after cooldown
- If retry fails, page is marked as failed and AutoExtract continues

### State Preservation

During rate limit handling:
- ✅ Current page number preserved
- ✅ Total processed count preserved
- ✅ Processed URLs set preserved
- ✅ Failed pages list maintained
- ✅ AutoExtract state saved before page reload

## Troubleshooting

### Rate Limits Still Causing Issues?

1. **Check Retry Count**: Increase `maxRateLimitRetries` in server code
2. **Increase Wait Time**: Increase `waitSeconds` in client code
3. **Slow Down AutoExtract**: Add delays between pages in main loop
4. **Check Notion API Limits**: Review Notion's current rate limit policies

### Failed Pages Not Saved?

1. **Check Tampermonkey Permissions**: Ensure `GM_setValue` is available
2. **Check Storage**: Run `GM_getValue('w2n_failed_pages')` in console
3. **Check Console Logs**: Look for "Failed pages saved to storage" message

### AutoExtract Stopping Unexpectedly?

1. **Check Error Type**: Rate limit errors should pause, not stop
2. **Check Max Retries**: May need to increase retry limits
3. **Check Network**: Ensure proxy server is running and accessible

## Future Enhancements

Potential improvements for rate limit handling:

1. **Adaptive Rate Limiting**: Dynamically adjust request frequency based on rate limit hits
2. **Queue System**: Implement a proper job queue for failed pages with automatic retry
3. **Progress Persistence**: Save AutoExtract progress to resume after browser restart
4. **Batch Operations**: Group pages into batches with cooldowns between batches
5. **Rate Limit Prediction**: Track API usage and proactively slow down before hitting limits

## References

- **Notion API Rate Limits**: https://developers.notion.com/reference/request-limits
- **HTTP 429 Too Many Requests**: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429
- **Exponential Backoff**: Best practice for retrying failed API requests

---

**Last Updated**: November 9, 2025  
**Version**: 10.0.29  
**Author**: ServiceNow-2-Notion Development Team
