#!/bin/bash
# Start the SN2N server with full logging to file

# Clear require cache and suppress warnings
export NODE_OPTIONS="--no-warnings"

# Get absolute path to script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOG_DIR="$SCRIPT_DIR/server/logs"
LOG_FILE="$LOG_DIR/server-terminal-$(date +%Y%m%d-%H%M%S).log"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

echo "Starting SN2N server with logging to: $LOG_FILE"
echo "NODE_OPTIONS: $NODE_OPTIONS"
echo "Press Ctrl+C to stop the server"
echo ""

# Start server with unbuffered output and log everything
cd "$SCRIPT_DIR/server" && npm start 2>&1 | tee "$LOG_FILE" &
SERVER_PID=$!

echo "Server PID: $SERVER_PID"
echo ""

# Wait for the background process
wait $SERVER_PID
