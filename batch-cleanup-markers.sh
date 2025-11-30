#!/bin/bash

##############################################################################
# Batch Marker Cleanup Script
#
# Cleans up orphaned sn2n:marker tokens from pages that timed out during
# AutoExtract. Reads page IDs from stdin or file and calls the cleanup
# endpoint for each page.
#
# Usage:
#   1. Find pages with markers:
#      node find-pages-with-markers.cjs > pages-with-markers.txt
#
#   2. Run cleanup:
#      bash batch-cleanup-markers.sh < pages-with-markers.txt
#
#   Or pipe directly:
#      node find-pages-with-markers.cjs 2>/dev/null | bash batch-cleanup-markers.sh
#
# Features:
#   - Progress tracking with page numbers
#   - Success/failure summary
#   - Logs to timestamped file
#   - Rate limit protection (500ms between requests)
##############################################################################

set -euo pipefail

# Configuration
API_BASE="http://localhost:3004/api"
DELAY_MS=500  # Delay between requests (milliseconds)

# Create logs directory if needed
LOGS_DIR="$(dirname "$0")/logs"
mkdir -p "$LOGS_DIR"

# Timestamped log file
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOGS_DIR/marker-cleanup-$TIMESTAMP.log"

echo "🧹 Batch Marker Cleanup" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if server is running (canonical health endpoint)
if ! curl -s -f http://localhost:3004/api/health > /dev/null 2>&1; then
  echo "❌ Error: Server not running on port 3004" | tee -a "$LOG_FILE"
  echo "   Run: npm start (or VS Code task '🚀 Start Server (Verbose)')" | tee -a "$LOG_FILE"
  exit 1
fi

# Counters
total=0
success=0
failed=0
updated=0

# Read page IDs from stdin
echo "📋 Reading page IDs from stdin..." | tee -a "$LOG_FILE"

while IFS= read -r page_id; do
  # Skip empty lines
  [[ -z "$page_id" ]] && continue
  
  total=$((total + 1))
  
  echo "" | tee -a "$LOG_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  echo "📄 Page $total: $page_id" | tee -a "$LOG_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  
  # Call cleanup endpoint
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    "$API_BASE/W2N/$page_id/cleanup-markers" \
    2>&1 || echo '{"success":false,"error":"Request failed"}')
  
  # Parse response
  if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
    blocks_updated=$(echo "$response" | jq -r '.data.updated')
    elapsed=$(echo "$response" | jq -r '.data.elapsedMs')
    elapsed_sec=$(awk "BEGIN {printf \"%.1f\", $elapsed/1000}")
    
    echo "✅ SUCCESS" | tee -a "$LOG_FILE"
    echo "   Blocks updated: $blocks_updated" | tee -a "$LOG_FILE"
    echo "   Elapsed: ${elapsed_sec}s" | tee -a "$LOG_FILE"
    
    success=$((success + 1))
    updated=$((updated + blocks_updated))
  else
    error_msg=$(echo "$response" | jq -r '.message // .error // "Unknown error"')
    echo "❌ FAILED: $error_msg" | tee -a "$LOG_FILE"
    echo "$response" >> "$LOG_FILE"
    failed=$((failed + 1))
  fi
  
  # Rate limit protection
  sleep 0.5
done

# Summary
echo "" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "📊 SUMMARY" | tee -a "$LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
echo "Total pages:    $total" | tee -a "$LOG_FILE"
echo "Successful:     $success" | tee -a "$LOG_FILE"
echo "Failed:         $failed" | tee -a "$LOG_FILE"
echo "Blocks updated: $updated" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Completed: $(date)" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [[ $failed -gt 0 ]]; then
  echo "⚠️  Some pages failed. Check log for details." | tee -a "$LOG_FILE"
  exit 1
else
  echo "✅ All pages cleaned successfully!" | tee -a "$LOG_FILE"
  exit 0
fi
