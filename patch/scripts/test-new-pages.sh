#!/usr/bin/env bash
set -euo pipefail

# Test new pages in pages-to-update with dryRun validation
PAGES_DIR="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update"
API="http://localhost:3004/api/W2N"
DB_ID="1524506adba58133b45ad4bb20d13c2e"

OK=0
FAIL=0

shopt -s nullglob
for FP in "$PAGES_DIR"/*.html; do
  FILE=$(basename "$FP")
  TITLE="${FILE%.html}"
  
  echo "Testing: $FILE"
  
  JSON=$(jq -n --arg title "$TITLE" --arg dbId "$DB_ID" --rawfile html "$FP" '{title:$title, databaseId:$dbId, contentHtml:$html, dryRun:true}')
  RESP=$(echo "$JSON" | curl -s -w "\n%{http_code}" -X POST "$API" -H 'Content-Type: application/json' -d @- || echo -e "\n000")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  
  SUCCESS=$(echo "$BODY" | jq -r '.success // false' 2>/dev/null || echo false)
  
  if [[ "$SUCCESS" == "true" && "$CODE" == "200" ]]; then
    HAS_VIDEOS=$(echo "$BODY" | jq -r '.data.hasVideos // false' 2>/dev/null || echo false)
    BLOCK_COUNT=$(echo "$BODY" | jq -r '.data.children | length' 2>/dev/null || echo 0)
    echo "  ✅ OK - Blocks: $BLOCK_COUNT, Videos: $HAS_VIDEOS"
    ((OK++))
  else
    ERROR_MSG=$(echo "$BODY" | jq -r '.error.message // .message // "unknown error"' 2>/dev/null || echo "HTTP $CODE")
    echo "  ❌ FAIL - $ERROR_MSG"
    ((FAIL++))
  fi
  
  sleep 0.3
done

echo ""
echo "Summary: OK=$OK FAIL=$FAIL"
