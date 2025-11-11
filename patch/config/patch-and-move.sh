#!/usr/bin/env bash
# patch-and-move.sh - PATCH update existing Notion pages with fresh HTML content
# Only moves files when PATCH succeeds AND validation passes (no errors)
# 
# Usage: Run from patch/config directory
#   cd patch/config && bash patch-and-move.sh

# Note: NOT using set -e because we want to continue processing files even if some fail

# === Configuration ===
API_URL="http://localhost:3004/api/W2N"
DB_ID="282a89fedba5815e91f0db972912ef9f"
SCRIPT_DIR="$(cd "$(dirname "$0")/../pages-to-update" && pwd)"
UPDATED_DIR="$SCRIPT_DIR/updated-pages"
DELAY=0.5  # 500ms between requests (rate limit protection)

# === Color codes ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# === Counters ===
total=0
patched=0
failed=0
skipped=0

# === Create output directory ===
mkdir -p "$UPDATED_DIR"

echo ""
echo "=================================================="
echo "  🔄 PATCH and Move Script"
echo "=================================================="
echo ""
echo "API URL: $API_URL"
echo "Database ID: $DB_ID"
echo "Source Dir: pages-to-update/"
echo "Target Dir: updated-pages/"
echo "Delay: ${DELAY}s between requests"
echo ""
echo "=================================================="
echo ""

# === Helper function to extract page ID from HTML file ===
extract_page_id() {
  local file="$1"
  # Extract page ID from HTML comment at top of file
  # Format: <!-- Page ID: 2a8a89fe-dba5-81e0-9cde-f486068bdd3d -->
  local page_id=$(grep -m 1 "Page ID:" "$file" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/')
  
  # Remove hyphens to match Notion's format (they use IDs without hyphens in API)
  page_id=$(echo "$page_id" | tr -d '-')
  
  if [ -n "$page_id" ]; then
    echo "$page_id"
    return 0
  else
    return 1
  fi
}

echo "📋 Page IDs will be extracted from HTML file metadata"
echo ""

# === Process each HTML file ===
for f in "$SCRIPT_DIR"/*.html; do
  [ ! -f "$f" ] && continue
  
  total=$((total + 1))
  filename=$(basename "$f")
  
  # Extract title (remove timestamp suffix and .html)
  title=$(echo "$filename" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}\.html$//' | tr '-' ' ' | sed 's/\b\(.\)/\u\1/g')
  
  # Extract page ID from HTML file metadata
  page_id=$(extract_page_id "$f")
  
  # Skip files without page IDs
  if [ -z "$page_id" ]; then
    echo -e "${YELLOW}⏩ SKIP${NC} $filename"
    echo "  ↳ No page ID found in file metadata"
    skipped=$((skipped + 1))
    echo ""
    continue
  fi
  
  echo -e "${BLUE}🔄 PATCH${NC} $filename"
  echo "  ↳ Title: $title"
  echo "  ↳ Page ID: $page_id"
  
  # Build JSON payload via Python (handles special chars safely)
  python3 - "$f" "$title" "$DB_ID" <<'PY'
import sys, json
from pathlib import Path

file, title, db = sys.argv[1:]
html = Path(file).read_text(encoding='utf-8')

# Build PATCH payload (no dryRun flag = real update)
payload = {
  "title": title,
  "databaseId": db,
  "contentHtml": html
}

Path('/tmp/sn2n-patch.json').write_text(json.dumps(payload), encoding='utf-8')
PY
  
  # Execute PATCH request
  resp=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/$page_id" \
    -H "Content-Type: application/json" \
    -d @/tmp/sn2n-patch.json 2>&1 || echo -e "\n000")
  
  # Extract HTTP status code (last line) and body (all but last line)
  http_code=$(echo "$resp" | tail -1)
  body=$(echo "$resp" | sed '$d')
  
  # Check success via JSON response
  success=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  print("true" if j.get("success") else "false")
except:
  print("false")
' <<<"$body" 2>/dev/null || echo "false")
  
  if [ "$success" = "true" ]; then
    # PATCH succeeded - now check validation results
    has_validation_errors=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  validation = j.get("validation", {})
  print("true" if validation.get("hasErrors") else "false")
except:
  print("false")
' <<<"$body" 2>/dev/null || echo "false")
    
    # Extract block counts from response
    deleted=$(python3 -c 'import sys,json; j=json.loads(sys.stdin.read()); print(j.get("blocksDeleted", j.get("validation", {}).get("deletedBlocks", 0)))' <<<"$body" 2>/dev/null || echo "?")
    added=$(python3 -c 'import sys,json; j=json.loads(sys.stdin.read()); print(j.get("blocksAdded", len(j.get("children", []))))' <<<"$body" 2>/dev/null || echo "?")
    
    if [ "$has_validation_errors" = "true" ]; then
      # PATCH succeeded but validation found errors
      echo -e "  ↳ ${YELLOW}⚠️ PATCHED WITH ERRORS${NC} (HTTP $http_code)"
      echo "  ↳ Blocks: $deleted deleted → $added added"
      
      # Extract validation error summary
      validation_summary=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  validation = j.get("validation", {})
  issues = validation.get("issues", [])
  if issues:
    print(f"{len(issues)} validation error(s): {issues[0][:100]}" if issues else "Validation errors detected")
  else:
    print("Validation errors detected (no details)")
except:
  print("Unknown validation errors")
' <<<"$body" 2>/dev/null || echo "Unknown validation errors")
      
      echo "  ↳ Errors: $validation_summary"
      echo "  ↳ File remains in pages-to-update/ (needs review)"
      failed=$((failed + 1))
    else
      # PATCH succeeded AND validation passed
      echo -e "  ↳ ${GREEN}✅ SUCCESS${NC} (HTTP $http_code)"
      echo "  ↳ Blocks: $deleted deleted → $added added"
      echo "  ↳ Validation: Passed"
      
      # Move file to updated-pages
      mv "$f" "$UPDATED_DIR/" && echo -e "  ↳ ${GREEN}Moved to updated-pages/${NC}"
      patched=$((patched + 1))
    fi
  else
    echo -e "  ↳ ${RED}❌ FAILED${NC} (HTTP $http_code)"
    
    # Extract error message
    error=$(python3 -c '
import sys, json
try:
  j = json.loads(sys.stdin.read())
  msg = j.get("error", {}).get("message", "Unknown error")
  print(msg[:200])  # First 200 chars
except:
  print("Parse error")
' <<<"$body" 2>/dev/null || echo "Response parse error")
    
    echo "  ↳ Error: $error"
    echo "  ↳ File remains in pages-to-update/"
    failed=$((failed + 1))
  fi
  
  echo ""
  
  # Rate limit protection delay
  sleep "$DELAY"
done

# === Summary ===
echo ""
echo "=================================================="
echo "  📊 PATCH Results Summary"
echo "=================================================="
echo ""
echo -e "${BLUE}Total Files:${NC}      $total"
echo -e "${GREEN}✅ Patched:${NC}        $patched (moved to updated-pages/)"
echo -e "${RED}❌ Failed:${NC}         $failed (remain in pages-to-update/)"
echo -e "${YELLOW}⏩ Skipped:${NC}        $skipped (no page ID mapping)"
echo ""
echo "=================================================="
echo ""

if [ $skipped -gt 0 ]; then
  echo -e "${YELLOW}ℹ️  Note:${NC} $skipped files were skipped because they don't have page ID mappings."
  echo "   These files may be new or not yet created in Notion."
  echo ""
fi

if [ $failed -gt 0 ]; then
  echo -e "${RED}⚠️  Warning:${NC} $failed files remain in pages-to-update/"
  echo "   Reasons:"
  echo "   • PATCH API call failed (network/server errors)"
  echo "   • PATCH succeeded but validation detected errors"
  echo "   Check messages above to distinguish between these cases."
  echo ""
fi

if [ $patched -gt 0 ]; then
  echo -e "${GREEN}✅ Success:${NC} $patched files were successfully PATCHed with clean validation."
  echo "   These files have been moved to updated-pages/"
  echo ""
fi

# Cleanup temp file
rm -f /tmp/sn2n-patch.json

exit 0
