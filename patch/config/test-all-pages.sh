#!/usr/bin/env bash
# Test all pages in pages-to-update with dry-run validation

cd "$(dirname "$0")/../.."

echo "Testing all pages in patch/pages-to-update/"
echo "============================================"
echo ""

for file in patch/pages-to-update/*.html; do
  [[ -e "$file" ]] || continue
  filename=$(basename "$file")
  
  echo "📄 $filename"
  
  # Extract expected counts from metadata
  expected_blocks=$(grep "Block Count (expected):" "$file" | sed 's/.*: //')
  
  # Run dry-run validation
  content=$(cat "$file" | jq -Rs .)
  response=$(curl -s -m 60 -X POST http://localhost:3004/api/W2N \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"test\",\"databaseId\":\"282a89fedba5815e91f0db972912ef9f\",\"content\":$content,\"url\":\"https://test.com\",\"dryRun\":true}" 2>&1)
  
  # Parse results
  block_count=$(echo "$response" | jq -r '.data.children | length' 2>/dev/null || echo "ERROR")
  tables=$(echo "$response" | jq -r '[.data.children[] | select(.type == "table")] | length' 2>/dev/null || echo "0")
  callouts=$(echo "$response" | jq -r '[.data.children[] | select(.type == "callout")] | length' 2>/dev/null || echo "0")
  headings=$(echo "$response" | jq -r '[.data.children[] | select(.type | startswith("heading"))] | length' 2>/dev/null || echo "0")
  has_errors=$(echo "$response" | jq -r '.data.validationResult.hasErrors' 2>/dev/null || echo "null")
  
  if [[ "$block_count" == "ERROR" || "$block_count" == "null" ]]; then
    echo "  ❌ Extraction failed or timeout"
    echo "$response" | jq -r '.error.message // .message // "Unknown error"' 2>/dev/null || echo "  Unknown error"
  elif [[ "$has_errors" != "null" && "$has_errors" != "false" ]]; then
    echo "  ❌ Validation errors detected"
    echo "$response" | jq -r '.data.validationResult.errors[]?.message' 2>/dev/null
  else
    echo "  ✅ Blocks: $block_count (expected: $expected_blocks)"
    echo "     Tables: $tables | Callouts: $callouts | Headings: $headings"
  fi
  
  echo ""
done

echo "============================================"
echo "Testing complete"
