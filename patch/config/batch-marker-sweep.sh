#!/usr/bin/env bash
set -euo pipefail

# Batch sweep to remove visible (sn2n:...) markers from Notion pages
# Reads Page IDs from HTML files in pages/updated-pages/ and invokes the manual sweep per page

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UPDATED_DIR="$ROOT_DIR/patch/pages/updated-pages"
LOG_FILE="/tmp/marker-sweep-batch.log"

# Load env for Notion token if present
if [ -f "$ROOT_DIR/server/.env" ]; then
  export $(grep -v '^#' "$ROOT_DIR/server/.env" | xargs)
fi

if [ ! -d "$UPDATED_DIR" ]; then
  echo "Updated-pages directory not found: $UPDATED_DIR" | tee -a "$LOG_FILE"
  exit 1
fi

pages=("$UPDATED_DIR"/*.html)
count_total=0
count_swept=0

start_ts=$(date +%Y-%m-%dT%H:%M:%S)
echo "[INFO] Batch marker sweep started at $start_ts" | tee -a "$LOG_FILE"

echo "[INFO] Scanning ${#pages[@]} files for Page IDs..." | tee -a "$LOG_FILE"

for f in "${pages[@]}"; do
  [ -e "$f" ] || continue
  count_total=$((count_total+1))
  page_id=$(grep -m1 "Page ID:" "$f" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' || true)
  title=$(basename "$f")
  if [ -z "${page_id:-}" ]; then
    echo "[$count_total] ⚠️  $title → No Page ID found, skipping" | tee -a "$LOG_FILE"
    continue
  fi

  echo "[$count_total] 🔍 Sweeping markers on $title (Page ID: $page_id)" | tee -a "$LOG_FILE"
  # Run per-page sweep with a small delay to avoid conflicts
  if bash "$ROOT_DIR/scripts/manual-marker-sweep.sh" "$page_id" | tee -a "$LOG_FILE" | grep -q "Sweep complete:"; then
    count_swept=$((count_swept+1))
  fi
  sleep 0.5

done

end_ts=$(date +%Y-%m-%dT%H:%M:%S)
echo "[INFO] Batch marker sweep complete at $end_ts" | tee -a "$LOG_FILE"
echo "[SUMMARY] Files processed: $count_total | Sweeps attempted: $count_swept" | tee -a "$LOG_FILE"
