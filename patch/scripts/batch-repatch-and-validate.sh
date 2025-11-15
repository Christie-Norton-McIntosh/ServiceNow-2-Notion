#!/usr/bin/env bash
set -euo pipefail

# Batch PATCH all HTML files in updated-pages to their corresponding Notion pages
# by extracting the embedded Page ID from each file, then immediately re-validate
# each page to refresh Notion properties.

UPDATED_DIR="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update/updated-pages"
API="http://localhost:3004/api/W2N"
VAL="http://localhost:3004/api/validate"

OK=0
FAIL=0
VOK=0
VFAIL=0

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

shopt -s nullglob
for FP in "$UPDATED_DIR"/*.html; do
  FILE=$(basename "$FP")
  TITLE="${FILE%.html}"
  PAGEID=$(grep -Eo 'Page ID: [0-9a-f-]+' "$FP" | awk '{print $3}' | tr -d '\r\n')
  if [[ -z "$PAGEID" ]]; then
    echo "SKIP no pageId found in $FILE"
    continue
  fi
  PAGEIDCLEAN="${PAGEID//-/}"

  JSON=$(jq -n --arg title "$TITLE" --rawfile html "$FP" '{title:$title, contentHtml:$html}')
  RESP=$(echo "$JSON" | curl -s -w "\n%{http_code}" -X PATCH "$API/$PAGEIDCLEAN" -H 'Content-Type: application/json' -d @- || echo -e "\n000")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  SUCCESS=$(echo "$BODY" | jq -r '.success // false' 2>/dev/null || echo false)

  if [[ "$SUCCESS" == "true" && "$CODE" == "200" ]]; then
    echo "✅ PATCH OK $FILE -> $PAGEIDCLEAN"
    ((OK++))

    # Immediate validation/property refresh for this page
    VRESP=$(jq -n --arg pid "$PAGEIDCLEAN" '{pageId:$pid}' | curl -s -w "\n%{http_code}" -X POST "$VAL" -H 'Content-Type: application/json' -d @- || echo -e "\n000")
    VCODE=$(echo "$VRESP" | tail -1)
    VBODY=$(echo "$VRESP" | sed '$d')
    VOKFLAG=$(echo "$VBODY" | jq -r '.data.results[0].success // false' 2>/dev/null || echo false)
    VERR=$(echo "$VBODY" | jq -r '.data.results[0].hasErrors // false' 2>/dev/null || echo false)
    if [[ "$VOKFLAG" == "true" && "$VCODE" == "200" ]]; then
      echo "   🔄 Validate OK for $PAGEIDCLEAN (hasErrors=$VERR)"
      ((VOK++))
    else
      echo "   ⚠️ Validate FAIL ($VCODE) for $PAGEIDCLEAN"
      ((VFAIL++))
    fi
  else
    echo "❌ PATCH FAIL $FILE -> $PAGEIDCLEAN (HTTP $CODE)"
    ((FAIL++))
  fi

  # Gentle pacing to reduce chance of timeouts/rate limits
  sleep 0.4
done

echo "Patch summary: OK=$OK FAIL=$FAIL | Validate: OK=$VOK FAIL=$VFAIL"
