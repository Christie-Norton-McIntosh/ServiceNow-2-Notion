#!/usr/bin/env bash
# validate-and-move.sh - Dry-run validation without PATCHing
#
# Usage: Run from patch/config directory
#   cd patch/config && bash validate-and-move.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/../pages-to-update" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
VF_DIR="$SCRIPT_DIR"
UPDATED_DIR="$VF_DIR/updated-pages"
API_URL="http://localhost:3004/api/W2N"
DB_ID="282a89fedba5815e91f0db972912ef9f"

mkdir -p "$UPDATED_DIR"

echo "🔎 Scanning for HTML files in $VF_DIR" >&2
# Collect files list without using mapfile (compat with macOS bash 3.x)
FILES=$(ls -1 "$VF_DIR"/*.html 2>/dev/null || true)

total=0
passed=0
failed=0

if [ -z "$FILES" ]; then
  echo "No HTML files found to validate." >&2
  exit 0
fi

# Count files
for _ in $FILES; do total=$((total+1)); done

echo "Found $total file(s). Validating with dryRun..." >&2

for f in $FILES; do
  name=$(basename "$f")
  title=$(echo "$name" | sed 's/-[0-9T:]*\.html$//' | sed 's/-/ /g' | sed 's/\b\([a-z]\)/\U\1/g')

  # Build JSON payload via Python for safe escaping
  python3 - "$f" "$title" "$DB_ID" <<'PY'
import sys, json
from pathlib import Path
file, title, db = sys.argv[1:]
html = Path(file).read_text(encoding='utf-8')
payload = {"title": title, "databaseId": db, "contentHtml": html, "dryRun": True}
Path('/tmp/sn2n-validate.json').write_text(json.dumps(payload), encoding='utf-8')
PY

  # Call API
  resp=$(curl -s -X POST "$API_URL" -H "Content-Type: application/json" -d @/tmp/sn2n-validate.json || true)
  success=$(python3 -c 'import sys,json; j=json.loads(sys.stdin.read()); print("true" if j.get("success") else "false")' <<<"$resp" 2>/dev/null || echo false)

  if [ "$success" = "true" ]; then
    echo "✅ PASS: $name" >&2
    mv "$f" "$UPDATED_DIR/" \
      && echo "  ↳ moved to updated-successfully/" >&2
    passed=$((passed+1))
  else
    err=$(python3 -c 'import sys,json; j=json.loads(sys.stdin.read()); print(j.get("error","UNKNOWN"))' <<<"$resp" 2>/dev/null || echo UNKNOWN)
    msg=$(python3 -c 'import sys,json; j=json.loads(sys.stdin.read()); print(j.get("message",""))' <<<"$resp" 2>/dev/null || echo "")
    echo "❌ FAIL: $name" >&2
    echo "   Error: $err" >&2
    [ -n "$msg" ] && echo "   Message: $msg" >&2
    failed=$((failed+1))
  fi

done

echo "" >&2
echo "Summary: $passed passed, $failed failed, $total total" >&2
if [ "$failed" -eq 0 ]; then
  echo "🎉 All failed pages have been fixed and moved." >&2
fi
