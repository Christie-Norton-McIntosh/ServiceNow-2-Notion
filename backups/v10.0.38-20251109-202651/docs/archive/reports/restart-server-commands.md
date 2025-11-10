# Server Restart Commands Reference

Quick reference for stopping and restarting the SN2N proxy server with clean module cache.

## Quick Restart (Recommended)

```bash
# *********Kill all node processes and restart fresh
killall node && sleep 2 && cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion && npm start
```

## Individual Commands

### Stop Server

```bash
# Option 1: Kill all node processes
killall node

# Option 2: Kill specific proxy process
pkill -f "node.*sn2n-proxy"

# Option 3: Kill by PID (if you know it)
kill <PID>
```

### Start Server

```bash
# From root directory
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion && npm start

# Or from server directory
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server && node sn2n-proxy.cjs
```

## Verify Server Status

```bash
# Check if server is running
ps aux | grep "[n]ode.*sn2n-proxy"

# Check server health
curl -s http://localhost:3004/ping

# View recent logs
tail -50 /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/logs/server-output-*.log
```

## Clean Restart with Log Capture

```bash
# Stop server
killall node

# Wait for clean shutdown
sleep 2

# Start with visible logs
cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server && node sn2n-proxy.cjs 2>&1 | tee /tmp/server-startup.log &

# View startup logs
cat /tmp/server-startup.log
```

## Important Notes

- **Hot-reload**: The server uses a hot-reload wrapper for `w2n.cjs`, but changes to `servicenow.cjs` require a full restart
- **Module cache**: Use `killall node` to ensure Node's require cache is cleared
- **Wait between restarts**: Add `sleep 2` between stop/start to avoid port conflicts
- **Log files**: Server logs are in `server/logs/server-output-*.log` (timestamped)
- **Port**: Server runs on port 3004 by default

## Troubleshooting

### Port already in use
```bash
# Find process using port 3004
lsof -i :3004

# Kill that process
kill -9 <PID>
```

### Server not responding
```bash
# Check for zombie processes
ps aux | grep node

# Kill all and restart
killall node && sleep 2 && cd /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion && npm start
```

### Verify recent changes are loaded
```bash
# Check file modification time
ls -l /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/services/servicenow.cjs

# Grep for specific code to verify it's in the file
grep -A 3 "HTML FIX: Checking article tags" /Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/server/services/servicenow.cjs
```
