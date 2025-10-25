# Terminal Logging Guide

This guide explains how to capture complete terminal output from the SN2N proxy server for debugging and analysis.

## Quick Start

### Start Server with Logging

```bash
./start-with-logging.sh
```

This will:
- Start the server normally
- Display all output in the terminal
- Save all output to `server/logs/server-terminal-TIMESTAMP.log`
- Capture both stdout and stderr

### Stop the Server

Press `Ctrl+C` to stop the server. The log file will be saved in `server/logs/`.

---

## Log File Location

Log files are saved to:
```
server/logs/server-terminal-YYYYMMDD-HHMMSS.log
```

Example:
```
server/logs/server-terminal-20251025-163045.log
```

---

## Searching Logs

### Find Recent Log Files

```bash
ls -lt server/logs/server-terminal-*.log | head -5
```

### Search for Specific Content

**Find callout processing:**
```bash
grep "MATCHED CALLOUT" server/logs/server-terminal-*.log
```

**Find nested block processing:**
```bash
grep -A 5 "Processing callout nested block" server/logs/server-terminal-*.log
```

**Find page creation:**
```bash
grep "Page created successfully" server/logs/server-terminal-*.log
```

**Find orchestration details:**
```bash
grep "Orchestrator" server/logs/server-terminal-*.log
```

### View Recent Log Content

**Last 100 lines of most recent log:**
```bash
tail -100 server/logs/server-terminal-*.log | tail -1
```

**View specific log file:**
```bash
less server/logs/server-terminal-20251025-163045.log
```

---

## Advanced Usage

### Start with Verbose Logging

For extra debugging output, set environment variables before starting:

```bash
SN2N_VERBOSE=1 SN2N_EXTRA_DEBUG=1 ./start-with-logging.sh
```

### Manual Logging (Without Script)

**Option 1: Redirect to file only**
```bash
npm start > server-output.log 2>&1
```

**Option 2: See output AND save to file**
```bash
npm start 2>&1 | tee server-output.log
```

**Option 3: Append to existing log**
```bash
npm start 2>&1 | tee -a server-output.log
```

---

## Common Search Patterns

### Debug Callout Issues

```bash
# Find callout with specific class
grep -A 10 "note note note_note" server/logs/server-terminal-*.log

# See what nested blocks were detected
grep -A 3 "Callout nested blocks check" server/logs/server-terminal-*.log

# Check callout content extraction
grep "Has callout content" server/logs/server-terminal-*.log

# See what blocks were returned from nested processing
grep "Returned.*blocks" server/logs/server-terminal-*.log
```

### Debug List Processing

```bash
# Find ordered list processing
grep "Processing <ol>" server/logs/server-terminal-*.log

# See nested blocks in list items
grep "list item contains.*nested" server/logs/server-terminal-*.log
```

### Debug Orchestration

```bash
# See markers being collected
grep "Found marker" server/logs/server-terminal-*.log

# See blocks being appended
grep "Will append.*block" server/logs/server-terminal-*.log

# Check orchestration results
grep "Orchestrator result" server/logs/server-terminal-*.log
```

---

## Analyzing a Specific Extraction

After extracting a ServiceNow page, follow this workflow:

1. **Find the log file for your session:**
   ```bash
   ls -lt server/logs/server-terminal-*.log | head -1
   ```

2. **Search for the page title or URL:**
   ```bash
   grep "Page title" server/logs/server-terminal-20251025-163045.log
   ```

3. **Extract processing logs for that page:**
   ```bash
   grep -A 100 "POST /api/W2N" server/logs/server-terminal-20251025-163045.log
   ```

4. **Focus on specific issues:**
   ```bash
   # Callout processing
   grep -E "(MATCHED CALLOUT|Processing callout nested block)" server/logs/server-terminal-20251025-163045.log
   
   # Block counts
   grep -E "(Total blocks|Creating.*block)" server/logs/server-terminal-20251025-163045.log
   
   # Errors or warnings
   grep -E "(⚠️|❌|Error)" server/logs/server-terminal-20251025-163045.log
   ```

---

## Log File Management

### Clean Up Old Logs

**Remove logs older than 7 days:**
```bash
find server/logs/server-terminal-*.log -mtime +7 -delete
```

**Keep only the 10 most recent logs:**
```bash
ls -t server/logs/server-terminal-*.log | tail -n +11 | xargs rm -f
```

### Archive Logs

**Create archive of logs:**
```bash
tar -czf server-logs-$(date +%Y%m%d).tar.gz server/logs/server-terminal-*.log
```

---

## Troubleshooting

### Script Not Executable

If you get "Permission denied":
```bash
chmod +x start-with-logging.sh
```

### Log Files Growing Too Large

If log files are very large, consider:
1. Using grep to filter before saving
2. Rotating logs more frequently
3. Using `head` or `tail` to limit output

### Can't Find Recent Logs

Check if server is actually running:
```bash
ps aux | grep node | grep sn2n-proxy
```

If not running, start with:
```bash
./start-with-logging.sh
```

---

## Tips

- **Use `less`** to view large log files interactively
- **Use `grep -C 5`** to see 5 lines before and after matches
- **Use `tail -f`** to watch logs in real-time (though `tee` already shows output)
- **Save important logs** before they're cleaned up automatically
- **Search for emoji markers** like `🔍`, `✅`, `⚠️`, `📦` to find key events

---

## Related Documentation

- `docs/module-guide.md` - Module-level code documentation
- `docs/auto-pr-workflow.md` - Automated PR workflow
- `server/logs/` - Where all logs are stored
