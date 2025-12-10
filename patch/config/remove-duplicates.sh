#!/usr/bin/env bash

# Script to remove duplicate pages, keeping only the most recent version
# Usage: bash remove-duplicates.sh [--dry-run]

set -euo pipefail

PAGES_DIR="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update"
DRY_RUN="${1:-false}"

cd "$PAGES_DIR"

echo "========================================="
echo "DUPLICATE PAGE REMOVAL UTILITY"
echo "========================================="
echo ""

if [[ "$DRY_RUN" == "true" ]] || [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "🔍 DRY RUN MODE - No files will be deleted"
  echo ""
fi

# Create temp file to store base names with their files
temp_file=$(mktemp)
trap "rm -f $temp_file" EXIT

total_files=0
duplicates_found=0
files_to_delete=0

# Extract base names and timestamps for all files
for file in *.html; do
  [[ ! -f "$file" ]] && continue
  ((total_files++))
  
  # Extract base name (remove date/time stamps and validation suffixes)
  base_name=$(echo "$file" | sed -E 's/-[0-9]{4}-[0-9]{2}-[0-9]{2}[tT][0-9]{2}-[0-9]{2}-[0-9]{2}.*//' | \
    sed 's/-patch-validation-failed.*//' | \
    sed 's/-blank-validation-patch.*//' | \
    sed 's/-content-validation-failed.*//')
  
  # Get file timestamp
  timestamp=$(stat -f "%m" "$file" 2>/dev/null || stat -c "%Y" "$file" 2>/dev/null || echo "0")
  
  # Write to temp file: basename|timestamp|filename
  echo "${base_name}|${timestamp}|${file}" >> "$temp_file"
done

echo "📊 Found $total_files total files"
echo ""

# Process each unique base name
for base_name in $(cut -d'|' -f1 "$temp_file" | sort -u); do
  # Get all files for this base name
  matching_files=$(grep "^${base_name}|" "$temp_file")
  file_count=$(echo "$matching_files" | wc -l | tr -d ' ')
  
  # Skip if only one file
  if [[ "$file_count" -eq 1 ]]; then
    continue
  fi
  
  ((duplicates_found++))
  echo "🔍 Found $file_count versions of: $base_name"
  
  # Sort by timestamp (newest first) and process
  first=true
  echo "$matching_files" | sort -t'|' -k2 -rn | while IFS='|' read -r bn ts filename; do
    file_date=$(date -r "$ts" "+%Y-%m-%d %H:%M:%S" 2>/dev/null || echo "unknown")
    
    if [[ "$first" == "true" ]]; then
      echo "  ✅ KEEP:   $filename ($file_date)"
      first=false
    else
      echo "  ❌ DELETE: $filename ($file_date)"
      ((files_to_delete++))
      
      if [[ "$DRY_RUN" != "true" ]] && [[ "$DRY_RUN" != "--dry-run" ]]; then
        rm -f "$filename"
        echo "           🗑️  Deleted"
      fi
    fi
  done
  echo ""
done

# Count files that would be deleted
files_to_delete=$(awk -F'|' '{print $1}' "$temp_file" | sort | uniq -c | awk '$1 > 1 {sum+=$1-1} END {print sum+0}')

echo "========================================="
echo "SUMMARY"
echo "========================================="
echo "Total files processed: $total_files"
echo "Base names with duplicates: $duplicates_found"
echo "Files to delete: $files_to_delete"
echo "Files to keep: $((total_files - files_to_delete))"
echo ""

if [[ "$DRY_RUN" == "true" ]] || [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "🔍 DRY RUN - No files were actually deleted"
  echo "Run without --dry-run to actually delete files"
else
  echo "✅ Cleanup complete"
fi
echo "========================================="
