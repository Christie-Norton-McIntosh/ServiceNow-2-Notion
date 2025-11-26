#!/usr/bin/env bash
set -euo pipefail

# Batch CREATE pages in Notion from HTML files (no Page ID in header)
# Uses local proxy server POST /api/W2N
#
# Config
API_URL="http://localhost:3004/api/W2N"
DB_ID="282a89fedba5815e91f0db972912ef9f"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/pages-to-update"
DEST_DIR="$SRC_DIR/updated-pages"
LOG_DIR="$SRC_DIR/log"
TS=$(date +%Y%m%d-%H%M%S)
LOG_FILE="$LOG_DIR/batch-create-$TS.log"
RESULTS_JSON="$LOG_DIR/created-pages-$TS.json"

CHUNK_SIZE=3
COOLDOWN=10    # seconds between chunks
PAGE_DELAY=2   # seconds between pages

mkdir -p "$DEST_DIR" "$LOG_DIR"

echo "[INFO] Batch CREATE new pages" | tee -a "$LOG_FILE"
echo "[INFO] Source: $SRC_DIR" | tee -a "$LOG_FILE"
echo "[INFO] Database: $DB_ID" | tee -a "$LOG_FILE"
echo "[INFO] Log: $LOG_FILE" | tee -a "$LOG_FILE"

# Collect target files: those created by split script (timestamp suffix)
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$(basename "$f")")
done < <(find "$SRC_DIR" -maxdepth 1 -type f -name "*-2025-11-16T03-57-24.html" -print0 2>/dev/null)

TOTAL=${#FILES[@]}
if [[ $TOTAL -eq 0 ]]; then
  echo "[WARN] No split files found matching pattern *-2025-11-16T03-57-24.html in $SRC_DIR" | tee -a "$LOG_FILE"
  exit 0
fi

echo "[INFO] Total files: $TOTAL" | tee -a "$LOG_FILE"

# Initialize results JSON
printf '{"createdAt":"%s","total":%d,"databaseId":"%s","items":[\n' "$(date -Iseconds)" "$TOTAL" "$DB_ID" > "$RESULTS_JSON"
FIRST_ITEM=1

idx=0
processed=0
created=0
failed=0

for file in "${FILES[@]}"; do
  ((idx++))
  SRC_FILE="$SRC_DIR/$file"

  # Extract metadata (first occurrence within first 50 lines)
  TITLE=$(python3 - "$SRC_FILE" <<'PY'
import sys,re
path=sys.argv[1]
with open(path,'r',encoding='utf-8') as f:
    lines=[next(f,'') for _ in range(50)]
head=''.join(lines)
m=re.search(r'^\s*Page:\s*(.+)$', head, re.M)
print(m.group(1).strip() if m else 'Untitled')
PY
)
  URL=$(python3 - "$SRC_FILE" <<'PY'
import sys,re
path=sys.argv[1]
with open(path,'r',encoding='utf-8') as f:
    lines=[next(f,'') for _ in range(50)]
head=''.join(lines)
m=re.search(r'^\s*URL:\s*(.+)$', head, re.M)
print(m.group(1).strip() if m else '')
PY
)

  # Read and escape HTML content (JSON-escaped for inclusion in POST body)
  HTML_CONTENT=$(python3 - "$SRC_FILE" <<'PY'
import sys, json
path=sys.argv[1]
with open(path,'r',encoding='utf-8') as f:
    data=f.read()
s=json.dumps(data)
print(s[1:-1])  # strip surrounding quotes
PY
)

  echo "[${idx}/${TOTAL}] 🚀 Creating: $TITLE" | tee -a "$LOG_FILE"

  # Create page via POST
  RESP=$(curl -s -X POST "$API_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"title\":\"${TITLE}\",\"databaseId\":\"${DB_ID}\",\"contentHtml\":\"${HTML_CONTENT}\",\"url\":\"${URL}\"}") || true

  # Parse response (page id)
  PAGE_ID=$(echo "$RESP" | python3 - <<'PY'
import sys, json
try:
  data=json.load(sys.stdin)
  # Supported shapes:
  # { success, data: { page: { id } } }
  # { success, data: { pageId } }
  # { id } or { pageId }
  page_id = ''
  if isinstance(data, dict):
    if 'data' in data and isinstance(data['data'], dict):
      d = data['data']
      if isinstance(d.get('page'), dict) and d['page'].get('id'):
        page_id = d['page']['id']
      elif d.get('pageId'):
        page_id = d['pageId']
    if not page_id:
      page_id = data.get('id','') or data.get('pageId','')
  print(page_id or '')
except Exception:
  print('')
PY
)

  if [[ -n "$PAGE_ID" ]]; then
    ((created++))
    echo "   ✅ Created: $PAGE_ID" | tee -a "$LOG_FILE"
    # Append to results JSON
    if [[ $FIRST_ITEM -eq 1 ]]; then FIRST_ITEM=0; else printf ',\n' >> "$RESULTS_JSON"; fi
    printf '  {"title":%s,"file":%s,"url":%s,"pageId":%s}' \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TITLE")" \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$file")" \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$URL")" \
      "$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$PAGE_ID")" >> "$RESULTS_JSON"

    # Move file to updated-pages for bookkeeping
    mv "$SRC_FILE" "$DEST_DIR/" || true
  else
    ((failed++))
    echo "   ❌ Failed to create page for $file" | tee -a "$LOG_FILE"
  fi

  ((processed++))

  # Cooldown and delays
  if (( processed % CHUNK_SIZE == 0 )); then
    echo "   ⏸️  Cooldown ${COOLDOWN}s after chunk" | tee -a "$LOG_FILE"
    sleep "$COOLDOWN"
  else
    sleep "$PAGE_DELAY"
  fi

done

printf '\n]}' >> "$RESULTS_JSON"

echo "\n========================================" | tee -a "$LOG_FILE"
echo "✅ Batch CREATE complete" | tee -a "$LOG_FILE"
echo "Total: $TOTAL | Created: $created | Failed: $failed" | tee -a "$LOG_FILE"
echo "Results: $RESULTS_JSON" | tee -a "$LOG_FILE"
