#!/usr/bin/env bash
# patch-specific-pages.sh - PATCH 7 specific pages to populate Validation properties

API_URL="http://localhost:3004/api/W2N"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
UPDATED_DIR="$ROOT_DIR/patch/pages/updated-pages"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo "=================================================="
echo "  🔧 PATCH 7 Specific Pages"
echo "=================================================="
echo ""

# Page IDs and filenames
PAGE_IDS=(
  "2c2a89fedba5813b9efada6c97373667"
  "2c2a89fedba581d8a2b1cfa7a02b93e5"
  "2c2a89fedba581dfbdc1fdd8c75b30c1"
  "2c2a89fedba581c583a6c60fc6b253e1"
  "2c2a89fedba5813fb4fecbd346bbd726"
  "2c2a89fedba58173a346dcf19bdf3546"
  "2c2a89fedba581e28086c93f57c2b67a"
)

FILES=(
  "create-a-purchase-order-2025-12-07T09-35-26.html"
  "add-a-user-or-asset-to-a-contract-2025-12-07T09-29-52.html"
  "add-terms-and-conditions-to-a-contract-2025-12-07T09-29-05.html"
  "receive-a-purchase-order-for-contract-assets-content-validation-failed-2025-12-07T09-25-03.html"
  "supply-contract-renewal-information-content-validation-failed-2025-12-07T09-23-49.html"
  "view-ibm-pvu-mappings-for-the-legacy-ibm-pvu-process-pack-content-validation-failed-2025-12-07T09-12-35.html"
  "predictive-intelligence-for-incident-management-2025-12-07T09-00-44.html"
)

success_count=0
fail_count=0

for i in "${!PAGE_IDS[@]}"; do
  page_id="${PAGE_IDS[$i]}"
  filename="${FILES[$i]}"
  filepath="$UPDATED_DIR/$filename"
  
  if [ ! -f "$filepath" ]; then
    echo -e "${RED}❌ File not found:${NC} $filename"
    echo ""
    fail_count=$((fail_count + 1))
    continue
  fi
  
  title=$(echo "$filename" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}\.html$//' | sed 's/-content-validation-failed$//' | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
  
  echo -e "${BLUE}🔧 PATCHING${NC} $title"
  echo "   File: $filename"
  echo "   Page ID: $page_id"
  
  # Build JSON payload
  python3 - "$filepath" "$title" <<'PY'
import sys, json
from pathlib import Path

file, title = sys.argv[1:]
html = Path(file).read_text(encoding='utf-8')

payload = {
  "title": title,
  "contentHtml": html,
  "url": ""
}

Path('/tmp/sn2n-patch-specific.json').write_text(json.dumps(payload), encoding='utf-8')
PY
  
  # Execute PATCH
  resp=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/$page_id" \
    -H "Content-Type: application/json" \
    -d @/tmp/sn2n-patch-specific.json 2>&1 || echo -e "\n000")
  
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  
  if [ "$http_code" = "200" ]; then
    echo -e "   ${GREEN}✅ SUCCESS${NC} (HTTP $http_code)"
    success_count=$((success_count + 1))
  else
    echo -e "   ${RED}❌ FAILED${NC} (HTTP $http_code)"
    echo "   Response: $(echo "$body" | head -c 200)"
    fail_count=$((fail_count + 1))
  fi
  
  echo ""
  sleep 1
done

echo ""
echo "=================================================="
echo "  📊 Results"
echo "=================================================="
echo ""
echo -e "${GREEN}✅ Success:${NC} $success_count"
echo -e "${RED}❌ Failed:${NC} $fail_count"
echo ""

if [ $success_count -eq 7 ]; then
  echo -e "${GREEN}🎉 All pages successfully PATCH'd!${NC}"
  echo "   Properties (Validation, Stats, Error) should now be populated in Notion."
else
  echo -e "${YELLOW}⚠️  Some pages failed - check errors above${NC}"
fi
