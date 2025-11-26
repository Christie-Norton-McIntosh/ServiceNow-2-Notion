#!/bin/bash
set -e

# Unarchive all pages in pages-to-update/ that are archived in Notion
# This fixes the HTTP 500 errors when attempting PATCH operations

NOTION_TOKEN=$(grep NOTION_TOKEN ../../server/.env | cut -d= -f2)
NOTION_VERSION="2022-06-28"

echo "🔄 Unarchiving pages in Notion..."
echo ""

success_count=0
fail_count=0

for file in *.html; do
  # Skip if no HTML files
  if [ ! -f "$file" ]; then
    echo "No HTML files found"
    exit 0
  fi
  
  # Extract page ID from HTML comment
  page_id=$(grep "Page ID:" "$file" | head -1 | sed 's/.*Page ID: //' | sed 's/-->.*//' | tr -d '-' | tr -d ' ')
  filename=$(basename "$file")
  
  # Skip if no page ID found
  if [ -z "$page_id" ]; then
    echo "⚠️  SKIPPED: $filename (no page ID found)"
    echo ""
    continue
  fi
  
  echo "📤 Unarchiving: $filename"
  echo "   Page ID: $page_id"
  
  # Make PATCH request to unarchive
  response=$(curl -s -w "\n%{http_code}" -X PATCH \
    "https://api.notion.com/v1/pages/$page_id" \
    -H "Authorization: Bearer $NOTION_TOKEN" \
    -H "Notion-Version: $NOTION_VERSION" \
    -H "Content-Type: application/json" \
    -d '{"archived": false}')
  
  # Extract HTTP status code
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  
  # Check result
  if [ "$http_code" = "200" ]; then
    echo "   ✅ Unarchived successfully"
    success_count=$((success_count + 1))
  else
    echo "   ❌ Failed (HTTP $http_code)"
    echo "   Response: $body"
    fail_count=$((fail_count + 1))
  fi
  
  echo ""
  sleep 0.5  # Rate limit protection (Notion allows 3 requests/second)
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary:"
echo "   ✅ Successfully unarchived: $success_count"
echo "   ❌ Failed: $fail_count"
echo ""

if [ $success_count -gt 0 ]; then
  echo "✅ All pages processed! You can now run:"
  echo "   cd ../config && bash batch-patch-with-cooldown.sh"
else
  echo "⚠️  No pages were unarchived. Check the errors above."
  exit 1
fi
