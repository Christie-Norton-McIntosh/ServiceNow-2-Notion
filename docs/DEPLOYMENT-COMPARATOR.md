# Text Completeness Comparator Deployment Guide

## Prerequisites

### System Requirements
- **Node.js**: ≥ 18.0.0
- **npm**: ≥ 8.0.0
- **Operating System**: Linux, macOS, or Windows

### Notion Requirements
- Notion integration with **read/update** capabilities
- Database and pages shared with the integration bot
- Notion API token (internal integration)

### Database Properties
Add these properties to your Notion database before using the comparator:

| Property Name | Type | Options/Format |
|--------------|------|----------------|
| `Coverage` | Number | Format: Number (0.0 to 1.0) |
| `MissingCount` | Number | Format: Number |
| `Method` | Select | Options: `lcs`, `jaccard` |
| `LastChecked` | Date | Format: Date & Time |
| `MissingSpans` | Rich text | - |
| `RunId` | Rich text | - |
| `Status` | Select or Formula | Options: `Complete`, `Attention` |

**Formula for Status** (optional):
```
if(prop("Coverage") >= 0.97 and prop("MissingCount") == 0, "Complete", "Attention")
```

## Installation

### 1. Install Dependencies

The comparator uses dependencies already included in the main project:

```bash
npm install
```

Dependencies used:
- `express`: ^4.18.2 (already installed)
- `@notionhq/client`: ^2.2.15 (already installed)

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and configure the following:

```bash
# Required: Notion Integration
NOTION_TOKEN=secret_your_notion_token_here

# Optional: Comparator Settings
MAX_CELLS=50000000      # LCS DP guardrail
MIN_SPAN=40             # Minimum tokens to report
APPEND_TOGGLE=false     # Append missing spans as toggle

# Optional: Security
AUTH_TOKEN=your-secret-bearer-token

# Optional: Server Port (default: 3004)
# PORT=3004
```

### 3. Share Database with Integration

1. Open your Notion database
2. Click **Share** (top right)
3. Search for your integration name
4. Click **Invite** to grant access

## Running the Server

### Development Mode

```bash
npm start
```

or with nodemon for auto-restart:

```bash
npm run start:dev
```

### Production Mode

Using PM2 (recommended):

```bash
npm run start:pm2
```

### Verify Server is Running

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

## Testing the Installation

### Test Basic Comparison

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

Expected response includes:
- `coverage` < 1.0 (some text is missing)
- `missingSpans` with "for audit purposes"

### Test Notion Integration

Replace `YOUR_PAGE_ID` with an actual page ID:

```bash
curl -X POST http://localhost:3004/api/compare/notion-page \
  -H "Content-Type: application/json" \
  -d '{
    "pageId": "YOUR_PAGE_ID",
    "srcText": "Your test source text here"
  }'
```

## Environment Variables Reference

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `NOTION_TOKEN` | Notion API integration token | `secret_abc123...` |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3004` |
| `MAX_CELLS` | LCS DP guardrail (n+1)*(m+1) | `50000000` |
| `MIN_SPAN` | Min tokens to report missing span | `40` |
| `APPEND_TOGGLE` | Append missing spans toggle to page | `false` |
| `AUTH_TOKEN` | Bearer token for API authentication | (none) |
| `NOTION_LOG_LEVEL` | Notion SDK log level | `warn` |
| `SN2N_VERBOSE` | Verbose logging | `0` |
| `SN2N_EXTRA_DEBUG` | Extra debug logging | `0` |

## Monitoring

### Server Logs

Monitor server output for:
- `✅ Comparator routes loaded successfully` - Routes loaded correctly
- `compare/notion-page error:` - Notion API errors
- `compare/notion-db-row error:` - Database update errors

### Health Checks

Set up automated health checks:

```bash
*/5 * * * * curl -f http://localhost:3004/api/compare/health || echo "Health check failed"
```

### Common Issues

#### "Notion client not initialized"
**Cause**: NOTION_TOKEN not set or invalid
**Solution**: Verify `.env` file has correct NOTION_TOKEN

#### "Failed to retrieve database"
**Cause**: Database not shared with integration
**Solution**: Share database with integration via Notion UI

#### "Property does not exist"
**Cause**: Required properties missing from database
**Solution**: Add all required properties to database (see Prerequisites)

#### "401 Unauthorized"
**Cause**: AUTH_TOKEN mismatch or missing
**Solution**: Remove AUTH_TOKEN from .env or include correct Bearer token in requests

## Security Considerations

### API Authentication

If deploying to production:

1. **Set AUTH_TOKEN**: Generate a secure random token
   ```bash
   AUTH_TOKEN=$(openssl rand -base64 32)
   echo "AUTH_TOKEN=$AUTH_TOKEN" >> .env
   ```

2. **Use HTTPS**: Deploy behind a reverse proxy with SSL
   ```nginx
   location /api/compare {
       proxy_pass http://localhost:3004/api/compare;
       proxy_set_header Authorization $http_authorization;
   }
   ```

3. **Restrict Access**: Use firewall rules to limit access
   ```bash
   # Allow only from specific IP
   iptables -A INPUT -p tcp --dport 3004 -s YOUR_IP -j ACCEPT
   iptables -A INPUT -p tcp --dport 3004 -j DROP
   ```

### Notion Token Security

- Store NOTION_TOKEN in environment variables only
- Never commit `.env` to version control
- Rotate tokens periodically
- Use minimal required permissions (read + update pages)

### Content Logging

- Log minimal content only
- Canonical missing text may be long—consider capping in logs
- MissingSpans property automatically truncates to 2000 chars per span

## Scaling Considerations

### Memory Usage

LCS algorithm uses O(n*m) memory:
- 10,000 × 10,000 tokens = ~400 MB
- Guardrail (MAX_CELLS) triggers Jaccard fallback automatically

### Request Timeouts

- Notion API requests: 30 seconds
- Server timeout: 5 minutes (inherited from main server)
- Consider increasing for very large pages

### Rate Limits

Notion API rate limits:
- 3 requests per second per integration
- Comparator respects existing rate limit handling

### Batch Processing

For batch comparisons, implement queuing:
1. Use message queue (Redis, RabbitMQ)
2. Process comparisons sequentially
3. Respect Notion rate limits

## Troubleshooting

### Enable Debug Logging

```bash
# In .env
SN2N_VERBOSE=1
SN2N_EXTRA_DEBUG=1
NOTION_LOG_LEVEL=debug
```

### Check Notion API Access

```bash
curl https://api.notion.com/v1/users/me \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28"
```

### Verify Database Schema

```bash
curl http://localhost:3004/api/databases/YOUR_DATABASE_ID
```

### Test with Minimal Example

Create a test page with simple content:
1. Add page to database
2. Compare with simple text
3. Verify properties update correctly

## Support

For issues specific to the comparator:
1. Check server logs for error messages
2. Verify environment variables are set correctly
3. Test with minimal examples first
4. Review API documentation for correct request format

## Maintenance

### Regular Tasks

1. **Monitor disk space**: Server logs can grow large
2. **Check Notion token expiry**: Rotate tokens if needed
3. **Update dependencies**: `npm update` regularly
4. **Review database properties**: Ensure schema matches requirements

### Updates

When updating the comparator:

```bash
git pull origin main
npm install
npm start
```

Verify health check after update:

```bash
curl http://localhost:3004/api/compare/health
```
