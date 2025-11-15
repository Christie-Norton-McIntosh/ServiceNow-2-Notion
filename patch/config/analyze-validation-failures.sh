#!/usr/bin/env bash
set -euo pipefail

# Analyze validation failures with detailed error categorization
# Usage: bash patch/config/analyze-validation-failures.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/patch/pages-to-update"
LOG_DIR="$SRC_DIR/log"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
ANALYSIS_LOG="$LOG_DIR/validation-analysis-$TS.log"
ERROR_SUMMARY="$LOG_DIR/error-summary-$TS.json"

API_URL="http://localhost:3004/api/W2N"
DATABASE_ID="178f8dc43e2780d09be1c568a04d7bf3"

echo "[INFO] Starting validation analysis" | tee -a "$ANALYSIS_LOG"
echo "[INFO] Source dir: $SRC_DIR" | tee -a "$ANALYSIS_LOG"
echo "[INFO] Analysis log: $ANALYSIS_LOG" | tee -a "$ANALYSIS_LOG"

# Initialize error tracking (simple counters)
total=0
validated=0
failed=0
marker_leakage=0
image_count_mismatch=0
invalid_block_type=0
rich_text_error=0
nesting_depth=0
missing_required=0
unknown_error=0
http_error=0

shopt -s nullglob

# Start JSON output
echo "{" > "$ERROR_SUMMARY"
echo "  \"timestamp\": \"$TS\"," >> "$ERROR_SUMMARY"
echo "  \"total_files\": 0," >> "$ERROR_SUMMARY"
echo "  \"validated\": 0," >> "$ERROR_SUMMARY"
echo "  \"failed\": 0," >> "$ERROR_SUMMARY"
echo "  \"errors\": [" >> "$ERROR_SUMMARY"

first_error=true

for html_file in "$SRC_DIR"/*.html; do
  [[ -e "$html_file" ]] || continue
  filename=$(basename "$html_file")
  total=$((total+1))

  echo "" | tee -a "$ANALYSIS_LOG"
  echo "[$total] 🔍 Analyzing: $filename" | tee -a "$ANALYSIS_LOG"

  # Extract Page ID from HTML metadata (within multi-line comment)
  page_id=$(grep -m1 "Page ID:" "$html_file" 2>/dev/null | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' || echo "")
  
  if [[ -z "$page_id" ]]; then
    echo "  ⚠️  No Page ID found - skipping" | tee -a "$ANALYSIS_LOG"
    continue
  fi

  echo "  Page ID: $page_id" | tee -a "$ANALYSIS_LOG"

  # Read HTML content
  content=$(cat "$html_file")
  title="${filename%.html}"

  # Create JSON payload for dry-run validation
  json_payload=$(jq -n \
    --arg title "$title" \
    --arg dbid "$DATABASE_ID" \
    --arg content "$content" \
    --arg url "https://docs.servicenow.com" \
    --argjson dryRun true \
    '{
      title: $title,
      databaseId: $dbid,
      content: $content,
      url: $url,
      dryRun: $dryRun
    }')

  # Execute dry-run validation
  response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$json_payload" 2>&1)

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" == "200" ]]; then
    # Check for validation errors in response body
    has_validation_errors=$(echo "$body" | jq -r '.validationResult.hasErrors // false')
    
    if [[ "$has_validation_errors" == "false" ]]; then
      echo "  ✅ VALIDATION PASSED" | tee -a "$ANALYSIS_LOG"
      validated=$((validated+1))
    else
      echo "  ❌ VALIDATION FAILED" | tee -a "$ANALYSIS_LOG"
      failed=$((failed+1))
      
      # Extract detailed error information
      error_count=$(echo "$body" | jq -r '.validationResult.errors | length')
      echo "  Error count: $error_count" | tee -a "$ANALYSIS_LOG"
      
      # Categorize errors
      for ((i=0; i<error_count; i++)); do
        error_msg=$(echo "$body" | jq -r ".validationResult.errors[$i].message // \"Unknown error\"")
        error_path=$(echo "$body" | jq -r ".validationResult.errors[$i].path // \"Unknown path\"")
        
        echo "    Error $((i+1)): $error_msg" | tee -a "$ANALYSIS_LOG"
        echo "    Path: $error_path" | tee -a "$ANALYSIS_LOG"
        
        # Categorize error type
        error_category="unknown"
        if [[ "$error_msg" =~ "sn2n:marker" ]] || [[ "$error_msg" =~ "marker" ]]; then
          error_category="marker_leakage"
          marker_leakage=$((marker_leakage+1))
        elif [[ "$error_msg" =~ "image" ]] && [[ "$error_msg" =~ "count" ]]; then
          error_category="image_count_mismatch"
          image_count_mismatch=$((image_count_mismatch+1))
        elif [[ "$error_msg" =~ "block type" ]] || [[ "$error_msg" =~ "invalid type" ]]; then
          error_category="invalid_block_type"
          invalid_block_type=$((invalid_block_type+1))
        elif [[ "$error_msg" =~ "rich_text" ]] || [[ "$error_msg" =~ "annotation" ]]; then
          error_category="rich_text_error"
          rich_text_error=$((rich_text_error+1))
        elif [[ "$error_msg" =~ "nesting" ]] || [[ "$error_msg" =~ "depth" ]]; then
          error_category="nesting_depth"
          nesting_depth=$((nesting_depth+1))
        elif [[ "$error_msg" =~ "empty" ]] || [[ "$error_msg" =~ "required" ]]; then
          error_category="missing_required"
          missing_required=$((missing_required+1))
        else
          unknown_error=$((unknown_error+1))
        fi
        
        # Add to JSON summary
        if [[ "$first_error" == "true" ]]; then
          first_error=false
        else
          echo "," >> "$ERROR_SUMMARY"
        fi
        
        echo "    {" >> "$ERROR_SUMMARY"
        echo "      \"file\": \"$filename\"," >> "$ERROR_SUMMARY"
        echo "      \"page_id\": \"$page_id\"," >> "$ERROR_SUMMARY"
        echo "      \"category\": \"$error_category\"," >> "$ERROR_SUMMARY"
        echo "      \"message\": $(echo "$error_msg" | jq -Rs .)," >> "$ERROR_SUMMARY"
        echo "      \"path\": $(echo "$error_path" | jq -Rs .)" >> "$ERROR_SUMMARY"
        echo -n "    }" >> "$ERROR_SUMMARY"
      done
    fi
  else
    echo "  ❌ HTTP ERROR: $http_code" | tee -a "$ANALYSIS_LOG"
    failed=$((failed+1))
    http_error=$((http_error+1))
    
    # Add HTTP error to summary
    if [[ "$first_error" == "true" ]]; then
      first_error=false
    else
      echo "," >> "$ERROR_SUMMARY"
    fi
    
    echo "    {" >> "$ERROR_SUMMARY"
    echo "      \"file\": \"$filename\"," >> "$ERROR_SUMMARY"
    echo "      \"page_id\": \"$page_id\"," >> "$ERROR_SUMMARY"
    echo "      \"category\": \"http_error\"," >> "$ERROR_SUMMARY"
    echo "      \"message\": \"HTTP $http_code\"," >> "$ERROR_SUMMARY"
    echo "      \"path\": \"N/A\"" >> "$ERROR_SUMMARY"
    echo -n "    }" >> "$ERROR_SUMMARY"
  fi

  # Progress indicator
  if (( total % 10 == 0 )); then
    echo "" | tee -a "$ANALYSIS_LOG"
    echo "[PROGRESS] Analyzed: $total | Passed: $validated | Failed: $failed" | tee -a "$ANALYSIS_LOG"
  fi
done

# Finalize JSON
echo "" >> "$ERROR_SUMMARY"
echo "  ]," >> "$ERROR_SUMMARY"
echo "  \"total_files\": $total," >> "$ERROR_SUMMARY"
echo "  \"validated\": $validated," >> "$ERROR_SUMMARY"
echo "  \"failed\": $failed," >> "$ERROR_SUMMARY"
echo "  \"error_categories\": {" >> "$ERROR_SUMMARY"
echo "    \"marker_leakage\": $marker_leakage," >> "$ERROR_SUMMARY"
echo "    \"image_count_mismatch\": $image_count_mismatch," >> "$ERROR_SUMMARY"
echo "    \"invalid_block_type\": $invalid_block_type," >> "$ERROR_SUMMARY"
echo "    \"rich_text_error\": $rich_text_error," >> "$ERROR_SUMMARY"
echo "    \"nesting_depth\": $nesting_depth," >> "$ERROR_SUMMARY"
echo "    \"missing_required\": $missing_required," >> "$ERROR_SUMMARY"
echo "    \"unknown_error\": $unknown_error," >> "$ERROR_SUMMARY"
echo "    \"http_error\": $http_error" >> "$ERROR_SUMMARY"
echo "  }" >> "$ERROR_SUMMARY"
echo "}" >> "$ERROR_SUMMARY"

# Print final summary
echo "" | tee -a "$ANALYSIS_LOG"
echo "═══════════════════════════════════════════════════════════" | tee -a "$ANALYSIS_LOG"
echo "VALIDATION ANALYSIS COMPLETE" | tee -a "$ANALYSIS_LOG"
echo "═══════════════════════════════════════════════════════════" | tee -a "$ANALYSIS_LOG"
echo "Total files analyzed:  $total" | tee -a "$ANALYSIS_LOG"
echo "Validation passed:     $validated" | tee -a "$ANALYSIS_LOG"
echo "Validation failed:     $failed" | tee -a "$ANALYSIS_LOG"
echo "" | tee -a "$ANALYSIS_LOG"
echo "ERROR CATEGORIES:" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "marker_leakage:" "$marker_leakage" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "image_count_mismatch:" "$image_count_mismatch" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "invalid_block_type:" "$invalid_block_type" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "rich_text_error:" "$rich_text_error" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "nesting_depth:" "$nesting_depth" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "missing_required:" "$missing_required" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "unknown_error:" "$unknown_error" | tee -a "$ANALYSIS_LOG"
printf "  %-25s %d\n" "http_error:" "$http_error" | tee -a "$ANALYSIS_LOG"
echo "" | tee -a "$ANALYSIS_LOG"
echo "Detailed log: $ANALYSIS_LOG" | tee -a "$ANALYSIS_LOG"
echo "JSON summary: $ERROR_SUMMARY" | tee -a "$ANALYSIS_LOG"

exit 0
