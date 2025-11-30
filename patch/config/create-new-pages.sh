#!/usr/bin/env bash
set -euo pipefail

# Create new pages from pages-to-update and validate immediately
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAGES_DIR="$PATCH_DIR/pages/pages-to-update"
UPDATED_DIR="$PATCH_DIR/pages/created-pages"
API="http://localhost:3004/api/W2N"
VAL="http://localhost:3004/api/validate"
DB_ID="1524506adba58133b45ad4bb20d13c2e"

OK=0
FAIL=0
VOK=0
VFAIL=0

shopt -s nullglob
for FP in "$PAGES_DIR"/*.html; do
  FILE=$(basename "$FP")
  TITLE="${FILE%.html}"
  
  echo "Creating: $FILE"
  
  JSON=$(jq -n --arg title "$TITLE" --arg dbId "$DB_ID" --rawfile html "$FP" '{title:$title, databaseId:$dbId, contentHtml:$html}')
  RESP=$(echo "$JSON" | curl -s -w "\n%{http_code}" -X POST "$API" -H 'Content-Type: application/json' -d @- || echo -e "\n000")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  
  SUCCESS=$(echo "$BODY" | jq -r '.success // false' 2>/dev/null || echo false)
  PAGE_ID=$(echo "$BODY" | jq -r '.data.id // ""' 2>/dev/null || echo "")
  
  if [[ "$SUCCESS" == "true" && "$CODE" == "200" && -n "$PAGE_ID" ]]; then
    echo "  ✅ Created: $PAGE_ID"
    ((OK++))
    
    # Move to updated-pages
    mv "$FP" "$UPDATED_DIR/"
    
    # Immediate validation
    VRESP=$(jq -n --arg pid "$PAGE_ID" '{pageId:$pid}' | curl -s -w "\n%{http_code}" -X POST "$VAL" -H 'Content-Type: application/json' -d @- || echo -e "\n000")
    VCODE=$(echo "$VRESP" | tail -1)
    VBODY=$(echo "$VRESP" | sed '$d')
    VOKFLAG=$(echo "$VBODY" | jq -r '.data.results[0].success // false' 2>/dev/null || echo false)
    VERR=$(echo "$VBODY" | jq -r '.data.results[0].hasErrors // false' 2>/dev/null || echo false)
    
    if [[ "$VOKFLAG" == "true" && "$VCODE" == "200" ]]; then
      echo "  🔄 Validated (hasErrors=$VERR)"
      ((VOK++))
    else
      echo "  ⚠️ Validation failed ($VCODE)"
      ((VFAIL++))
    fi
  else
    ERROR_MSG=$(echo "$BODY" | jq -r '.error.message // .message // "unknown error"' 2>/dev/null || echo "HTTP $CODE")
    echo "  ❌ Failed - $ERROR_MSG"
    ((FAIL++))
  fi
  
  sleep 0.4
done

echo ""
echo "Summary: Created=$OK Failed=$FAIL | Validated=$VOK ValidationFailed=$VFAIL"
