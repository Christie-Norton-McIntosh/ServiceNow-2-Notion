#!/usr/bin/env bash
# revalidate-updated-pages.sh - Dry-run validate all updated pages
# Moves files with validation errors back to pages-to-update for review

# === Configuration ===
API_URL="http://localhost:3004/api/W2N"
DB_ID="282a89fedba5815e91f0db972912ef9f"
SCRIPT_DIR="$(cd "$(dirname "$0")/../pages-to-update" && pwd)"
UPDATED_DIR="$SCRIPT_DIR/updated-pages"
PAGES_DIR="$SCRIPT_DIR"
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

echo ""
echo "=================================================="
echo "  🔍 Revalidate Updated Pages"
echo "=================================================="
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
    
    # Move file back to pages-to-update
    mv "$f" "$PAGES_DIR/" && echo -e "  ↳ ${YELLOW}Moved back to pages-to-update/${NC}" && moved=$((moved + 1))
    failed=$((failed + 1))
  fi
  
  echo ""
  
  # Rate limit protection
  sleep "$DELAY"
done

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
