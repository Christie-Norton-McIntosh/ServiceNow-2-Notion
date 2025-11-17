#!/bin/bash

# Simple property refresh for all updated pages
# Skips validation, just updates properties directly

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

PATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPDATED_DIR="$PATCH_DIR/pages/updated-pages"

echo ""
echo "=================================================="
echo "  🔄 Simple Property Refresh"
echo "=================================================="
echo ""

# Collect all page IDs
PAGE_IDS=()
for f in "$UPDATED_DIR"/*.html; do
  [ ! -f "$f" ] && continue
  page_id=$(grep -m 1 "Page ID:" "$f" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/')
  page_id=$(echo "$page_id" | tr -d '-')
  if [ -n "$page_id" ]; then
    PAGE_IDS+=("$page_id")
  fi
done

echo "Found ${#PAGE_IDS[@]} pages to refresh"
echo ""

# Process in small chunks with delays to avoid rate limits
chunk_size=3
idx=0
chunk_num=1

updated_total=0
cleared_total=0
failed_total=0

while [ $idx -lt ${#PAGE_IDS[@]} ]; do
  chunk=( "${PAGE_IDS[@]:$idx:$chunk_size}" )
  chunk_len=${#chunk[@]}

  echo -e "${BLUE}[$chunk_num]${NC} Processing chunk of $chunk_len pages (IDs $((idx+1))-$((idx+chunk_len)))..."

  # Build JSON
  python3 - "${chunk[@]}" <<'PY'
import sys, json
from pathlib import Path
ids = sys.argv[1:]
Path('/tmp/sn2n-prop-refresh.json').write_text(json.dumps({"pageIds": ids}), encoding='utf-8')
PY

  # POST with retries for rate limits
  max_retries=3
  retry=0
  success=false

  while [ $retry -lt $max_retries ] && [ "$success" = "false" ]; do
    if [ $retry -gt 0 ]; then
      wait_time=$((retry * 30))
      echo -e "  ${BLUE}⏳${NC} Rate limited, waiting ${wait_time}s before retry $retry/$max_retries..."
      sleep $wait_time
    fi

    resp=$(curl -s -m 60 -w "\n%{http_code}" -X POST "http://localhost:3004/api/validate" \
      -H "Content-Type: application/json" \
      -d @/tmp/sn2n-prop-refresh.json 2>/dev/null || echo -e "\n000")
    
    http_code=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | sed '$d')

    if [ "$http_code" = "200" ]; then
      # Check for rate limit in response
      rate_limited=$(echo "$body" | python3 -c "import sys, json; j=json.loads(sys.stdin.read()); print('true' if any('rate limit' in str(r.get('error', '')).lower() for r in j.get('data', {}).get('results', [])) else 'false')" 2>/dev/null || echo "false")
      
      if [ "$rate_limited" = "true" ]; then
        retry=$((retry + 1))
        continue
      fi

      # Parse summary
      summary=$(echo "$body" | python3 -c "
import sys, json
try:
  j = json.loads(sys.stdin.read())
  s = j.get('data', {}).get('summary', {})
  print(f\"{s.get('updated',0)} {s.get('errorsCleared',0)} {s.get('failed',0)}\")
except:
  print('0 0 0')
" 2>/dev/null || echo "0 0 0")
      
      read updated cleared failed <<< "$summary"
      updated_total=$((updated_total + updated))
      cleared_total=$((cleared_total + cleared))
      failed_total=$((failed_total + failed))
      
      echo -e "  ${GREEN}✅${NC} HTTP 200 | updated=$updated errorsCleared=$cleared failed=$failed"
      success=true
    else
      retry=$((retry + 1))
    fi
  done

  if [ "$success" = "false" ]; then
    echo -e "  ${RED}❌${NC} Failed after $max_retries retries"
    failed_total=$((failed_total + chunk_len))
  fi

  idx=$((idx + chunk_size))
  chunk_num=$((chunk_num + 1))
  
  # Small delay between chunks
  sleep 5
done

echo ""
echo "=================================================="
echo "Property refresh totals:"
echo "  Total pages:       ${#PAGE_IDS[@]}"
echo -e "  ${GREEN}✅${NC} Updated:         $updated_total"
echo -e "  🧹 Errors cleared:  $cleared_total"
echo -e "  ${RED}❌${NC} Failed:          $failed_total"
echo "=================================================="
echo ""
