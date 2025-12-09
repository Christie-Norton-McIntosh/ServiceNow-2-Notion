#!/usr/bin/env bash
set -euo pipefail

# Re-extract all pages in pages-to-update/ with the fixed extraction/validation logic
# This script reads each failure HTML file and performs a dry-run extraction via the proxy
# to regenerate expected callout counts and other validation metrics with the fix applied.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$ROOT_DIR/patch/pages"
SRC_DIR="$BASE_DIR/pages-to-update"
LOG_DIR="$BASE_DIR/log"
mkdir -p "$LOG_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/re-extract-all-pages-$TS.log"

API_URL="http://localhost:3004/api/W2N"
HEALTH_URL_PRIMARY="http://localhost:3004/api/health"
HEALTH_URL_ALT="http://localhost:3004/health"

echo "========================================" | tee -a "$LOG_FILE"
echo "🔄 RE-EXTRACT ALL PAGES WITH FIX v11.0.215" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Start time: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check if source directory exists and has files
if [[ ! -d "$SRC_DIR" ]]; then
  echo "❌ Error: Source directory not found: $SRC_DIR" | tee -a "$LOG_FILE"
  exit 1
fi

PAGE_COUNT=$(find "$SRC_DIR" -maxdepth 1 -type f -name "*.html" | wc -l)
if [[ $PAGE_COUNT -eq 0 ]]; then
  echo "❌ Error: No HTML files found in $SRC_DIR" | tee -a "$LOG_FILE"
  exit 1
fi

echo "📊 Found $PAGE_COUNT pages to re-extract" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check server health
echo "[SERVER] Checking proxy availability..." | tee -a "$LOG_FILE"
health_ok=0
if curl -sf -m2 "$HEALTH_URL_PRIMARY" >/dev/null 2>&1; then
  health_ok=1
  echo "✅ Proxy healthy (primary health endpoint)" | tee -a "$LOG_FILE"
elif curl -sf -m2 "$HEALTH_URL_ALT" >/dev/null 2>&1; then
  health_ok=1
  echo "✅ Proxy healthy (legacy health endpoint)" | tee -a "$LOG_FILE"
fi

if [[ $health_ok -ne 1 ]]; then
  echo "❌ Proxy not responding. Please start the server:" | tee -a "$LOG_FILE"
  echo "   npm start" | tee -a "$LOG_FILE"
  echo "   Or: npm run build && npm start" | tee -a "$LOG_FILE"
  exit 1
fi

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "🚀 Starting re-extraction process..." | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

SUCCESS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

# Process each HTML file
while IFS= read -r -d '' html_file; do
  filename=$(basename "$html_file")
  
  # Extract page ID from filename (format: page-name-failure-YYYY-MM-DDTHH-MM-SS.html)
  # The page ID is embedded in the failure HTML as a comment
  page_id=""
  if grep -q "<!-- PAGE_ID: " "$html_file" 2>/dev/null; then
    page_id=$(grep "<!-- PAGE_ID: " "$html_file" | sed 's/<!-- PAGE_ID: \([^-]*\).*/\1/' | head -1)
  fi
  
  # Extract page title from filename (remove -failure-YYYY-MM-DDTHH-MM-SS.html suffix)
  page_title=$(echo "$filename" | sed 's/-failure-[0-9T:-]*\.html$//')
  
  echo "📄 Processing: $page_title" | tee -a "$LOG_FILE"
  if [[ -n "$page_id" ]]; then
    echo "   Page ID: $page_id" | tee -a "$LOG_FILE"
  fi
  
  # Extract the HTML body (remove the header comment)
  html_content=$(sed -n '/^-->/,$ p' "$html_file" | tail -n +2)
  
  if [[ -z "$html_content" ]]; then
    echo "   ⚠️  Skipped: No HTML content found" | tee -a "$LOG_FILE"
    ((SKIP_COUNT++))
    continue
  fi
  
  # Create a temporary JSON request for dry-run extraction
  # The extraction will recalculate expected callouts with the fixed logic
  temp_request="/tmp/re-extract-request-$$.json"
  
  cat > "$temp_request" <<'EOJSON'
{
  "title": "TITLE_PLACEHOLDER",
  "contentHtml": "HTML_PLACEHOLDER",
  "dryRun": true
}
EOJSON
  
  # Escape the HTML content for JSON (this is tricky - use jq if available)
  if command -v jq &> /dev/null; then
    # Use jq to safely encode JSON
    jq --arg title "$page_title" --arg html "$html_content" '.title = $title | .contentHtml = $html' "$temp_request" > "${temp_request}.tmp"
    mv "${temp_request}.tmp" "$temp_request"
  else
    # Fallback: simple sed replacement (less safe but works for most cases)
    html_escaped=$(echo "$html_content" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed 's/$/\\n/' | tr -d '\n')
    sed -i.bak "s|HTML_PLACEHOLDER|$html_escaped|g" "$temp_request"
    sed -i.bak "s/TITLE_PLACEHOLDER/$page_title/g" "$temp_request"
    rm -f "${temp_request}.bak"
  fi
  
  # Send dry-run request to proxy
  response=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d @"$temp_request" 2>&1 || echo '{"error":"curl_failed"}')
  
  # Clean up temp file
  rm -f "$temp_request"
  
  # Check if response contains validation stats
  if echo "$response" | grep -q '"children"'; then
    # Parse response to extract validation stats if present
    blocks_count=$(echo "$response" | grep -o '"children"' | wc -l)
    echo "   ✅ Re-extracted: $blocks_count blocks" | tee -a "$LOG_FILE"
    ((SUCCESS_COUNT++))
  elif echo "$response" | grep -q '"error"'; then
    error_msg=$(echo "$response" | grep -o '"error":"[^"]*"' | head -1)
    echo "   ❌ Failed: $error_msg" | tee -a "$LOG_FILE"
    ((FAIL_COUNT++))
  else
    echo "   ⚠️  Unknown response format" | tee -a "$LOG_FILE"
    echo "      Response: $(echo "$response" | head -c 100)..." | tee -a "$LOG_FILE"
    ((FAIL_COUNT++))
  fi
  
  # Small delay between pages
  sleep 1
  
done < <(find "$SRC_DIR" -maxdepth 1 -type f -name "*.html" -print0)

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "📊 RE-EXTRACTION SUMMARY" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "✅ Successful:  $SUCCESS_COUNT" | tee -a "$LOG_FILE"
echo "❌ Failed:      $FAIL_COUNT" | tee -a "$LOG_FILE"
echo "⏭️  Skipped:     $SKIP_COUNT" | tee -a "$LOG_FILE"
echo "📊 Total:       $((SUCCESS_COUNT + FAIL_COUNT + SKIP_COUNT))/$PAGE_COUNT" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "End time: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "✅ ALL PAGES RE-EXTRACTED SUCCESSFULLY!" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "📝 Next step: Run batch PATCH to update Notion pages" | tee -a "$LOG_FILE"
  echo "   cd patch/config && bash batch-patch-with-cooldown.sh" | tee -a "$LOG_FILE"
else
  echo "⚠️  Some pages failed to re-extract. Check log for details:" | tee -a "$LOG_FILE"
  echo "   $LOG_FILE" | tee -a "$LOG_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "📋 Full log: $LOG_FILE" | tee -a "$LOG_FILE"
