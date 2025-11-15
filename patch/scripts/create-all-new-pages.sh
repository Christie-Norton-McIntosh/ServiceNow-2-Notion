#!/bin/bash
#
# Create all new pages in Notion with validation
#

set -e

PAGES_DIR="/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages-to-update"
SERVER_URL="http://localhost:3004"
DATABASE_ID="282a89fedba5815e91f0db972912ef9f"
CREATED_DIR="$PAGES_DIR/created-pages"
FAILED_DIR="$PAGES_DIR/failed-pages"

# Create directories if they don't exist
mkdir -p "$CREATED_DIR"
mkdir -p "$FAILED_DIR"

# Counters
SUCCESS_COUNT=0
FAIL_COUNT=0

echo "🚀 Creating new pages in Notion"
echo "================================"
echo ""

# Get all HTML files
for htmlfile in "$PAGES_DIR"/*.html; do
  [ -f "$htmlfile" ] || continue
  
  filename=$(basename "$htmlfile")
  title=$(echo "$filename" | sed 's/-2025.*\.html$//' | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2));}1')
  
  echo "📄 Creating: $title"
  
  # Read HTML content
  HTML_CONTENT=$(cat "$htmlfile")
  
  # Create JSON payload
  PAYLOAD=$(jq -n \
    --arg title "$title" \
    --arg databaseId "$DATABASE_ID" \
    --arg contentHtml "$HTML_CONTENT" \
    --arg url "https://example.servicenow.com/$filename" \
    '{
      title: $title,
      databaseId: $databaseId,
      contentHtml: $contentHtml,
      url: $url
    }')
  
  # POST to create page
  RESPONSE=$(curl -s -X POST "$SERVER_URL/api/W2N" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")
  
  # Check if successful
  SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
  PAGE_ID=$(echo "$RESPONSE" | jq -r '.pageId // "none"')
  HAS_ERRORS=$(echo "$RESPONSE" | jq -r '.validation.hasErrors // "unknown"')
  
  if [ "$SUCCESS" = "true" ] && [ "$HAS_ERRORS" = "false" ]; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "   ✅ Created successfully"
    echo "   Page ID: $PAGE_ID"
    echo "   Validation: PASSED"
    
    # Move to created directory
    mv "$htmlfile" "$CREATED_DIR/"
    
    # Save page info
    echo "$RESPONSE" | jq '.' > "$CREATED_DIR/${filename%.html}-page-info.json"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message // .error // "Unknown error"')
    echo "   ❌ Failed"
    echo "   Error: $ERROR_MSG"
    
    # Check validation details if available
    if [ "$HAS_ERRORS" = "true" ]; then
      echo "   Validation errors:"
      echo "$RESPONSE" | jq -r '.validation.errors[]? // empty' | sed 's/^/      - /'
    fi
    
    # Move to failed directory
    mv "$htmlfile" "$FAILED_DIR/"
    
    # Save error info
    echo "$RESPONSE" | jq '.' > "$FAILED_DIR/${filename%.html}-error.json"
  fi
  
  echo ""
  
  # Small delay to avoid rate limiting
  sleep 1
done

echo "================================"
echo "📊 Summary"
echo "================================"
echo "✅ Successful: $SUCCESS_COUNT"
echo "❌ Failed: $FAIL_COUNT"
echo ""

if [ $SUCCESS_COUNT -gt 0 ]; then
  echo "Created pages moved to: $CREATED_DIR"
fi

if [ $FAIL_COUNT -gt 0 ]; then
  echo "Failed pages moved to: $FAILED_DIR"
  echo ""
  echo "Review error details:"
  ls -1 "$FAILED_DIR"/*.json 2>/dev/null || echo "  (no error files)"
fi

exit 0
