#!/bin/bash
# Start the SN2N server with full logging to file

LOG_DIR="./server/logs"
LOG_FILE="$LOG_DIR/server-terminal-$(date +%Y%m%d-%H%M%S).log"

echo "Starting SN2N server with logging to: $LOG_FILE"
echo "Press Ctrl+C to stop the server"
echo ""

# Start server with unbuffered output and log everything
# Use stdbuf to disable buffering for immediate log writes
cd server && stdbuf -oL -eL npm start 2>&1 | tee "$LOG_FILE"
