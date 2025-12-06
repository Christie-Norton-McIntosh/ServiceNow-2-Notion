#!/bin/bash

################################################################################
# remove-blank-pages.sh
# 
# Removes HTML files from pages-to-update that are:
# 1. ERROR 403 pages (access denied)
# 2. Empty pages (0 expected blocks)
# 3. Pages with no actual content to extract
#
# Usage: bash remove-blank-pages.sh [--dry-run]
################################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGES_DIR="${SCRIPT_DIR}/../pages/pages-to-update"
FAILED_VALIDATION_DIR="${SCRIPT_DIR}/../pages/failed-validation"
ARCHIVE_DIR="${SCRIPT_DIR}/../pages/blank-pages-archive"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "🔍 DRY RUN MODE - No files will be moved"
  echo ""
fi

# Create archive directory if it doesn't exist
if [[ "$DRY_RUN" == false ]]; then
  mkdir -p "$ARCHIVE_DIR"
fi

# Counters
total_files=0
error_403_count=0
empty_page_count=0
zero_block_count=0
removed_count=0

echo "=================================="
echo "  🧹 Remove Blank Pages"
echo "=================================="
echo "Source: $PAGES_DIR"
echo "Archive: $ARCHIVE_DIR"
echo ""

# Check if pages directory exists
if [[ ! -d "$PAGES_DIR" ]]; then
  echo "❌ Directory not found: $PAGES_DIR"
  exit 1
fi

# Process each HTML file
for html_file in "$PAGES_DIR"/*.html; do
  # Skip if no files found
  [[ -e "$html_file" ]] || continue
  
  total_files=$((total_files + 1))
  filename=$(basename "$html_file")
  should_remove=false
  reason=""
  
  # Check 1: ERROR 403 pages (access denied)
  if grep -q "ERROR 403" "$html_file" 2>/dev/null; then
    should_remove=true
    reason="ERROR 403 - Access Denied"
    error_403_count=$((error_403_count + 1))
  fi
  
  # Check 2: Access denied message
  if grep -q "Access to this content is limited to authorized users" "$html_file" 2>/dev/null; then
    should_remove=true
    reason="Access Limited to Authorized Users"
    error_403_count=$((error_403_count + 1))
  fi
  
  # Check 3: Empty page marker
  if grep -q "empty-page" "$filename" 2>/dev/null; then
    should_remove=true
    reason="Empty Page (filename marker)"
    empty_page_count=$((empty_page_count + 1))
  fi
  
  # Check 4: Block Count (expected): 0
  if grep -q "Block Count (expected): 0" "$html_file" 2>/dev/null; then
    should_remove=true
    reason="0 Expected Blocks"
    zero_block_count=$((zero_block_count + 1))
  fi
  
  # Check 5: Page creation succeeded but no blocks were uploaded
  if grep -q "no blocks were uploaded" "$html_file" 2>/dev/null; then
    should_remove=true
    reason="No Blocks Uploaded"
    zero_block_count=$((zero_block_count + 1))
  fi
  
  # Check 6: Associated dry-run JSON shows 0 blocks extracted
  # Look in both pages-to-update and failed-validation directories
  json_file1="${html_file%.html}-dryrun-failed.json"
  json_file2="$FAILED_VALIDATION_DIR/$(basename "${html_file%.html}")-dryrun-failed.json"
  
  for json_file in "$json_file1" "$json_file2"; do
    if [[ -f "$json_file" ]]; then
      blocks_extracted=$(jq -r '.data.blocksExtracted // 0' "$json_file" 2>/dev/null || echo "0")
      if [[ "$blocks_extracted" == "0" ]]; then
        should_remove=true
        reason="Dry-run extracted 0 blocks (from $(basename "$json_file"))"
        zero_block_count=$((zero_block_count + 1))
        break
      fi
    fi
  done
  
  # Remove the file if it matches any criteria
  if [[ "$should_remove" == true ]]; then
    removed_count=$((removed_count + 1))
    
    if [[ "$DRY_RUN" == true ]]; then
      echo "🔍 Would remove: $filename"
      echo "   Reason: $reason"
    else
      mv "$html_file" "$ARCHIVE_DIR/"
      echo "✅ Removed: $filename"
      echo "   Reason: $reason"
    fi
  fi
done

echo ""
echo "=================================="
echo "  📊 Summary"
echo "=================================="
echo "Total files processed: $total_files"
echo ""
echo "Files to remove:"
echo "  • ERROR 403 pages:     $error_403_count"
echo "  • Empty pages:         $empty_page_count"
echo "  • Zero-block pages:    $zero_block_count"
echo "  • Total removed:       $removed_count"
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "✅ Dry run complete - No files were moved"
  echo "   Run without --dry-run to actually remove files"
else
  echo "✅ Moved $removed_count blank page(s) to: $ARCHIVE_DIR"
  
  # Show remaining file count
  remaining=$(find "$PAGES_DIR" -name "*.html" 2>/dev/null | wc -l | tr -d ' ')
  echo "📋 Remaining files in pages-to-update: $remaining"
fi

echo "=================================="
