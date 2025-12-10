#!/usr/bin/env bash
set -euo pipefail

# Deduplicate pages-to-update directory to keep only the most recent version of each page
# Pages have filenames like: page-name-failure-YYYY-MM-DDTHH-MM-SS.html
# For each unique page-name, keep only the version with the latest timestamp

DIR="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/pages-to-update"
ARCHIVE_DIR="$DIR/archived-duplicates"

if [[ ! -d "$DIR" ]]; then
  echo "❌ Error: Directory not found: $DIR"
  exit 1
fi

# Create archive directory for old versions
mkdir -p "$ARCHIVE_DIR"

# Use temp file to track latest versions (compatible with bash and zsh)
TEMP_FILE="/tmp/dedupe-latest-$$.txt"
> "$TEMP_FILE"

cd "$DIR"

# First pass: collect all files with their base names and timestamps
for file in *.html; do
  # Extract page name by removing -failure-YYYY-MM-DDTHH-MM-SS.html suffix
  page_name=$(echo "$file" | sed -E 's/-failure-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}\.html$//')
  
  # Extract timestamp from filename (YYYY-MM-DDTHH-MM-SS format)
  timestamp=$(echo "$file" | sed -E 's/.*-failure-([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2})\.html$/\1/')
  
  # Convert timestamp to epoch for comparison
  # Format: YYYY-MM-DDTHH-MM-SS -> need to handle with date command
  # Use a sortable format: replace T with space and colons with nothing for comparison
  timestamp_sortable=$(echo "$timestamp" | sed 's/T/-/g' | sed 's/-/\t/g')
  
  echo "$timestamp_sortable|$page_name|$file" >> "$TEMP_FILE"
done

# Sort by page name and timestamp (reverse) to group by page and keep newest
sort -t'|' -k2,2 -k1,1r "$TEMP_FILE" | awk -F'|' '
  BEGIN { last_page = "" }
  {
    page = $2
    file = $3
    
    if (page != last_page) {
      # First occurrence of this page (newest due to reverse sort)
      keep_file = file
      print "KEEP|" keep_file
      last_page = page
    } else {
      # Subsequent occurrences are older
      print "ARCHIVE|" file
    }
  }
' > "${TEMP_FILE}.keep"

# Execute the moves based on the sorted list
while IFS='|' read -r action file; do
  [[ -z "$action" || -z "$file" ]] && continue
  
  if [[ "$action" == "KEEP" ]]; then
    # Keep this file - do nothing
    :
  elif [[ "$action" == "ARCHIVE" ]]; then
    # Move older version to archive
    if [[ -f "$file" ]]; then
      echo "📦 Archiving older version: $file"
      mv "$file" "$ARCHIVE_DIR/" || true
    fi
  fi
done < "${TEMP_FILE}.keep"

# Cleanup temp files
rm -f "$TEMP_FILE" "${TEMP_FILE}.keep"

echo ""
echo "=========================================="
echo "✅ Deduplication Complete"
echo "=========================================="
echo "Kept: $(ls -1 "$DIR"/*.html 2>/dev/null | wc -l) most recent versions"
echo "Archived: $(ls -1 "$ARCHIVE_DIR"/*.html 2>/dev/null | wc -l) older duplicates"
echo ""
echo "Archive location: $ARCHIVE_DIR"
echo ""
echo "To restore archived files:"
echo "  mv $ARCHIVE_DIR/*.html $DIR/"
