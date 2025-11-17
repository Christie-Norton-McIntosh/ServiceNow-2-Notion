#!/usr/bin/env bash
# Clear validation errors for all pages in pages/updated-pages/
# These pages were successfully patched, so clear their Error checkbox and update validation

API_URL="http://localhost:3004/api/validate"
PATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPDATED_DIR="$PATCH_DIR/pages/updated-pages"

echo "=================================================="
echo "  🧹 Clear Validation Errors"
echo "=================================================="
echo ""
echo "Processing pages in: $UPDATED_DIR"
echo ""

# Collect all page IDs
PAGE_IDS=()

for f in "$UPDATED_DIR"/*.html; do
  [ ! -f "$f" ] && continue
  
  page_id=$(grep -m 1 "Page ID:" "$f" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' | tr -d '-')
  
  if [ -n "$page_id" ]; then
    PAGE_IDS+=("$page_id")
  fi
done

total=${#PAGE_IDS[@]}
echo "Found $total pages to refresh"
echo ""

if [ $total -eq 0 ]; then
  echo "No pages found. Exiting."
  exit 0
fi

# Process in chunks of 25
chunk_size=25
updated_total=0
cleared_total=0
failed_total=0

idx=0
chunk_num=1

while [ $idx -lt $total ]; do
  chunk=( "${PAGE_IDS[@]:$idx:$chunk_size}" )
  chunk_len=${#chunk[@]}
  
  echo "[$chunk_num] Processing chunk of $chunk_len pages (IDs $((idx+1))-$((idx+chunk_len)))..."
  
  # Build JSON
  json=$(python3 -c "import json, sys; print(json.dumps({'pageIds': sys.argv[1:]}))" "${chunk[@]}")
  
  # POST to validate endpoint
  resp=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$json" 2>&1 || echo -e "\n000")
  
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  
  if [ "$http_code" == "200" ]; then
    # Parse summary
    summary=$(python3 -c "import json, sys; d = json.loads(sys.stdin.read()).get('data', {}).get('summary', {}); print(f\"{d.get('updated',0)} {d.get('errorsCleared',0)} {d.get('failed',0)}\")" <<<"$body" 2>/dev/null)
    
    u=$(echo "$summary" | awk '{print $1}')
    c=$(echo "$summary" | awk '{print $2}')
    f=$(echo "$summary" | awk '{print $3}')
    
    updated_total=$((updated_total + u))
    cleared_total=$((cleared_total + c))
    failed_total=$((failed_total + f))
    
    echo "  ✅ HTTP $http_code | updated=$u errorsCleared=$c failed=$f"
  else
    echo "  ❌ HTTP $http_code | Request failed"
    failed_total=$((failed_total + chunk_len))
  fi
  
  idx=$((idx + chunk_size))
  chunk_num=$((chunk_num + 1))
  
  sleep 0.3
done

echo ""
echo "=================================================="
echo "  📊 Results"
echo "=================================================="
echo ""
echo "Total pages:        $total"
echo "✅ Updated:          $updated_total"
echo "🧹 Errors cleared:   $cleared_total"
echo "❌ Failed:           $failed_total"
echo ""
echo "=================================================="
