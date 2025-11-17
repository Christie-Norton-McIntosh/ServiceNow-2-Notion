#!/usr/bin/env bash
# revalidate-updated-pages.sh - Dry-run validate all updated pages
# Moves files with validation errors back to pages-to-update for review

# === Configuration ===
API_URL="http://localhost:3004/api/W2N"
DB_ID="282a89fedba5815e91f0db972912ef9f"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
UPDATED_DIR="$ROOT_DIR/patch/pages/updated-pages"
PAGES_DIR="$ROOT_DIR/patch/pages/pages-to-update"
DELAY=0.3  # 300ms between requests

# === Color codes ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# === Counters ===
total=0
passed=0
failed=0
moved=0

# === Arrays ===
# Collect page IDs that pass validation so we can refresh properties after the run
PAGE_IDS_TO_REFRESH=()

echo ""
echo "=================================================="
echo "  🔍 Revalidate Updated Pages"
echo "=================================================="
echo ""

# === Health check ===
echo "🏥 Checking server health..."
health_check=$(curl -sf -m 5 "http://localhost:3004/api/health" 2>/dev/null || curl -sf -m 5 "http://localhost:3004/health" 2>/dev/null)
if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Server not responding${NC}"
  echo "   Please start the server before running this script:"
  echo "   cd server && npm start"
  exit 1
fi
echo -e "${GREEN}✅ Server healthy${NC}"
echo ""

echo "API URL: $API_URL"
echo "Database ID: $DB_ID"
echo "Source Dir: updated-pages/"
echo "Move-back Dir: pages-to-update/"
echo "Delay: ${DELAY}s between requests"
echo ""
echo "=================================================="
echo ""

# === Helper function to extract page ID ===
extract_page_id() {
  local file="$1"
  local page_id=$(grep -m 1 "Page ID:" "$file" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/')
  page_id=$(echo "$page_id" | tr -d '-')
  
  if [ -n "$page_id" ]; then
    echo "$page_id"
    return 0
  else
    return 1
  fi
}

# === Process each HTML file in updated-pages ===
for f in "$UPDATED_DIR"/*.html; do
  [ ! -f "$f" ] && continue
  
  total=$((total + 1))
  filename=$(basename "$f")
  
  # Extract title
  title=$(echo "$filename" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}\.html$//' | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
  
  # Extract page ID
  page_id=$(extract_page_id "$f")
  
  if [ -z "$page_id" ]; then
    echo -e "${YELLOW}⏩ SKIP${NC} $filename"
    echo "  ↳ No page ID found in file metadata"
    echo ""
    continue
  fi
  
  echo -e "${BLUE}🔍 VALIDATE${NC} $filename"
  echo "  ↳ Title: $title"
  echo "  ↳ Page ID: $page_id"
  
  # Build JSON payload for dry-run
  python3 - "$f" "$title" "$DB_ID" <<'PY'
import sys, json
from pathlib import Path

file, title, db = sys.argv[1:]
html = Path(file).read_text(encoding='utf-8')

# Build dry-run payload
payload = {
  "title": title,
  "databaseId": db,
  "contentHtml": html,
  "dryRun": True
}

Path('/tmp/sn2n-validate.json').write_text(json.dumps(payload), encoding='utf-8')
PY
  
  # Execute dry-run POST request
  resp=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d @/tmp/sn2n-validate.json 2>&1 || echo -e "\n000")
  
  # Extract HTTP status code and body
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  
  # Check success
  success=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  print("true" if j.get("success") else "false")
except:
  print("false")
' <<<"$body" 2>/dev/null || echo "false")
  
  if [ "$success" = "true" ]; then
    echo -e "  ↳ ${GREEN}✅ VALIDATION PASSED${NC} (HTTP $http_code)"
    passed=$((passed + 1))
    # Always track for property refresh - even if validation had warnings
    PAGE_IDS_TO_REFRESH+=("$page_id")
  else
    echo -e "  ↳ ${RED}❌ VALIDATION FAILED${NC} (HTTP $http_code)"
    
    # Extract error message
    error=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  msg = j.get("error", {}).get("message", "Unknown error")
  print(msg[:150])
except:
  print("Parse error")
' <<<"$body" 2>/dev/null || echo "Response parse error")
    
    echo "  ↳ Error: $error"

    # If server is unreachable (HTTP 000), don't move files; treat as transient
    if [ "$http_code" = "000" ]; then
      echo -e "  ↳ ${YELLOW}Server unavailable; skipping move for now.${NC}"
      # Still add to refresh list - page exists, just can't validate right now
      PAGE_IDS_TO_REFRESH+=("$page_id")
    else
      # Move file back to pages-to-update
      mv "$f" "$PAGES_DIR/" && echo -e "  ↳ ${YELLOW}Moved back to pages-to-update/${NC}" && moved=$((moved + 1))
    fi
    failed=$((failed + 1))
  fi
  
  echo ""
  
  # Rate limit protection
  sleep "$DELAY"
done

# === Property refresh pass ===
if [ ${#PAGE_IDS_TO_REFRESH[@]} -gt 0 ]; then
  echo ""
  echo "=================================================="
  echo "  🔄 Property Refresh (Notion)"
  echo "=================================================="
  echo ""
  echo "Refreshing ${#PAGE_IDS_TO_REFRESH[@]} pages to update Validation/Stats properties"
  echo ""

  updated_total=0
  cleared_total=0
  failed_total=0
  total_total=0

  chunk_size=5
  idx=0
  chunk_num=1
  
  while [ $idx -lt ${#PAGE_IDS_TO_REFRESH[@]} ]; do
    chunk=( "${PAGE_IDS_TO_REFRESH[@]:$idx:$chunk_size}" )
    chunk_len=${#chunk[@]}

    echo -e "${BLUE}[$chunk_num]${NC} Processing chunk of $chunk_len pages (IDs $((idx+1))-$((idx+chunk_len)))..."

    # Build JSON for this chunk
    python3 - "${chunk[@]}" <<'PY'
import sys, json
from pathlib import Path
ids = sys.argv[1:]
payload = {"pageIds": ids}
json_file = Path('/tmp/sn2n-prop-refresh.json')
json_file.write_text(json.dumps(payload), encoding='utf-8')
PY

    # Verify file exists
    if [ ! -f /tmp/sn2n-prop-refresh.json ]; then
      echo -e "  ${RED}❌ Failed to create JSON file${NC}"
      failed_total=$((failed_total + chunk_len))
      idx=$((idx + chunk_size))
      chunk_num=$((chunk_num + 1))
      continue
    fi

    # POST chunk with longer timeout for large batches  
      # Capture both stdout and stderr separately to diagnose failures
      err_file="/tmp/sn2n-curl-err-$$"
      resp=$(curl -s -S -m 90 -w "\n%{http_code}" -X POST "http://localhost:3004/api/validate" \
        -H "Content-Type: application/json" \
        -d @/tmp/sn2n-prop-refresh.json 2>"$err_file" || echo -e "\n000")
    http_code=$(echo "$resp" | tail -1)
    body=$(echo "$resp" | sed '$d')
    
      # Check for curl errors
      if [ -s "$err_file" ]; then
        curl_err=$(cat "$err_file")
      else
        curl_err=""
      fi
      rm -f "$err_file"

    if [ "$http_code" = "200" ]; then
      # Summarize response
      summary=$(python3 - <<'PY'
import sys, json
try:
  j = json.loads(sys.stdin.read())
  d = j.get('data', {})
  s = d.get('summary', {})
  print(f"{s.get('updated',0)} {s.get('errorsCleared',0)} {s.get('failed',0)} {s.get('total',0)}")
except Exception:
  print("0 0 0 0")
PY
<<<"$body" 2>/dev/null)

      u=$(echo "$summary" | awk '{print $1}')
      c=$(echo "$summary" | awk '{print $2}')
      f=$(echo "$summary" | awk '{print $3}')
      t=$(echo "$summary" | awk '{print $4}')

      updated_total=$((updated_total + u))
      cleared_total=$((cleared_total + c))
      failed_total=$((failed_total + f))
      total_total=$((total_total + t))

      echo -e "  ${GREEN}✅${NC} HTTP $http_code | updated=$u errorsCleared=$c failed=$f total=$t"
    else
        if [ -n "$curl_err" ]; then
          echo -e "  ${RED}❌ HTTP $http_code${NC} | Curl error: $curl_err"
        else
          echo -e "  ${RED}❌ HTTP $http_code${NC} | Request failed"
        fi
      failed_total=$((failed_total + chunk_len))
      
      # Show error if available
      if [ "$http_code" != "000" ]; then
        error=$(python3 -c "import json, sys; j=json.loads(sys.stdin.read()); print(j.get('message', 'Unknown')[:100])" <<<"$body" 2>/dev/null || echo "Parse error")
        echo -e "     ${YELLOW}Error: $error${NC}"
      fi
    fi

    # small delay between chunks
    sleep "$DELAY"

    idx=$((idx + chunk_size))
    chunk_num=$((chunk_num + 1))
  done

  echo ""
  echo -e "${BLUE}Property refresh totals:${NC}"
  echo "  Total pages:       $total_total"
  echo "  ✅ Updated:         $updated_total"
  echo "  🧹 Errors cleared:  $cleared_total"
  echo "  ❌ Failed:          $failed_total"
  echo ""
  
  # Cleanup temp file
  rm -f /tmp/sn2n-prop-refresh.json
else
  echo ""
  echo "=================================================="
  echo "  ℹ️  No pages to refresh"
  echo "=================================================="
  echo ""
fi

# === Summary ===
echo ""
echo "=================================================="
echo "  📊 Revalidation Results"
echo "=================================================="
echo ""
echo -e "${BLUE}Total Files:${NC}         $total"
echo -e "${GREEN}✅ Passed:${NC}            $passed (remain in updated-pages/)"
echo -e "${RED}❌ Failed:${NC}            $failed (moved back to pages-to-update/)"
echo -e "${YELLOW}📤 Moved Back:${NC}        $moved"
echo ""
echo "=================================================="
echo ""

if [ $failed -gt 0 ]; then
  echo -e "${YELLOW}⚠️  Note:${NC} $failed files failed validation and were moved back."
  echo "   These need to be reviewed and re-PATCHed after fixes."
  echo ""
fi

if [ $passed -eq $total ]; then
  echo -e "${GREEN}✅ Perfect:${NC} All files passed validation!"
  echo ""
fi

# Cleanup
rm -f /tmp/sn2n-validate.json

exit 0
