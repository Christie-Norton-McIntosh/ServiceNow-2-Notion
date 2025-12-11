#!/usr/bin/env bash
set -euo pipefail

# Batch PATCH with Text Completeness Comparator validation
# 
# This script enhances the standard PATCH workflow by adding completeness
# validation using the Text Completeness Comparator API.
#
# Workflow:
# 1. Run standard PATCH operation (existing validation)
# 2. Run completeness comparison (new comparator)
# 3. Update Notion properties with both validation results
# 4. Move files based on combined validation status
#
# Prerequisites:
# - Server running with SN2N_VALIDATE_OUTPUT=1
# - Comparator API available at /api/compare
# - Notion database with comparator properties:
#   Coverage, MissingCount, Method, LastChecked, MissingSpans, RunId, Status

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_DIR="$ROOT_DIR/patch/pages"
SRC_DIR="$BASE_DIR/pages-to-update"
DST_DIR="$BASE_DIR/updated-pages"
PROBLEMATIC_DIR="$BASE_DIR/problematic-files"
LOG_DIR="$BASE_DIR/log"
FAILED_VALIDATION_DIR="$BASE_DIR/failed-validation"
INCOMPLETE_DIR="$BASE_DIR/incomplete-content"

mkdir -p "$LOG_DIR" "$DST_DIR" "$PROBLEMATIC_DIR" "$FAILED_VALIDATION_DIR" "$INCOMPLETE_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/batch-patch-comparator-$TS.log"

API_URL="http://localhost:3004/api/W2N"
COMPARATOR_URL="http://localhost:3004/api/compare"
HEALTH_URL="http://localhost:3004/api/health"

# Comparator thresholds (override with environment variables)
COVERAGE_THRESHOLD="${COVERAGE_THRESHOLD:-0.97}"  # 97% coverage required
MAX_MISSING_SPANS="${MAX_MISSING_SPANS:-0}"       # No missing spans allowed

# Cooldown settings
PAGES_PER_CHUNK=3
COOLDOWN_AFTER_CHUNK=10
PAGE_DELAY=2

echo "========================================" | tee -a "$LOG_FILE"
echo "Batch PATCH with Completeness Comparator" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Check server health
echo "[SERVER] Checking server availability..." | tee -a "$LOG_FILE"
if ! curl -sf -m2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[ERROR] Server not responding at $HEALTH_URL" | tee -a "$LOG_FILE"
  echo "[ERROR] Please start the server with: npm start" | tee -a "$LOG_FILE"
  echo "[ERROR] Or with validation: SN2N_VALIDATE_OUTPUT=1 npm start" | tee -a "$LOG_FILE"
  exit 1
fi
echo "[SERVER] ✅ Server is healthy" | tee -a "$LOG_FILE"

# Check comparator availability
echo "[COMPARATOR] Checking comparator API..." | tee -a "$LOG_FILE"
comparator_health=$(curl -s "$COMPARATOR_URL/health" 2>/dev/null || echo "{}")
comparator_status=$(echo "$comparator_health" | jq -r '.status // "unknown"')
if [[ "$comparator_status" != "ok" ]]; then
  echo "[WARNING] Comparator API not available - will skip completeness validation" | tee -a "$LOG_FILE"
  SKIP_COMPARATOR=1
else
  echo "[COMPARATOR] ✅ Comparator API available" | tee -a "$LOG_FILE"
  comparator_version=$(echo "$comparator_health" | jq -r '.version.canon // "unknown"')
  echo "[COMPARATOR] Version: $comparator_version" | tee -a "$LOG_FILE"
  SKIP_COMPARATOR=0
fi
echo "" | tee -a "$LOG_FILE"

# Check for files to process
if [ ! -d "$SRC_DIR" ] || [ -z "$(ls -A "$SRC_DIR" 2>/dev/null)" ]; then
  echo "[INFO] No files found in $SRC_DIR" | tee -a "$LOG_FILE"
  echo "[INFO] Directory is empty or doesn't exist." | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo "To populate with failed validation pages:" | tee -a "$LOG_FILE"
  echo "  1. Enable validation: export SN2N_VALIDATE_OUTPUT=1" | tee -a "$LOG_FILE"
  echo "  2. Run AutoExtract on ServiceNow pages" | tee -a "$LOG_FILE"
  echo "  3. Pages with validation failures will auto-save to pages-to-update/" | tee -a "$LOG_FILE"
  exit 0
fi

# Count files
file_count=$(find "$SRC_DIR" -maxdepth 1 -name "*.html" | wc -l)
echo "[PROCESSING] Found $file_count HTML files to process" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Statistics
processed=0
successful=0
failed_patch=0
failed_validation=0
failed_completeness=0
incomplete_content=0

# Process each file
chunk_count=0
for html_file in "$SRC_DIR"/*.html; do
  [ -e "$html_file" ] || continue
  
  processed=$((processed + 1))
  filename=$(basename "$html_file")
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  echo "[$processed/$file_count] Processing: $filename" | tee -a "$LOG_FILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$LOG_FILE"
  
  # Extract Page ID from metadata
  page_id=$(grep -m1 "Page ID:" "$html_file" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' | tr -d '\r' || echo "")
  
  if [[ -z "$page_id" || "$page_id" == "null" ]]; then
    echo "  ❌ No Page ID found in metadata" | tee -a "$LOG_FILE"
    failed_patch=$((failed_patch + 1))
    continue
  fi
  
  echo "  📄 Page ID: $page_id" | tee -a "$LOG_FILE"
  
  # Extract URL and content
  page_url=$(grep -m1 "URL:" "$html_file" | sed -E 's/.*URL: ([^[:space:]]+).*/\1/' | tr -d '\r' || echo "")
  content=$(cat "$html_file")
  title="${filename%.html}"
  
  # Extract source text (remove HTML metadata comments at the top)
  source_text=$(echo "$content" | sed '/^<!--/,/-->$/d' | sed 's/<[^>]*>//g' | sed 's/&nbsp;/ /g' | tr -s ' ' | sed '/^[[:space:]]*$/d')
  
  # STEP 1: PATCH the page
  echo "  1️⃣  Running PATCH operation..." | tee -a "$LOG_FILE"
  patch_temp=$(mktemp)
  patch_http_code=$(curl -s -m 180 -w "%{http_code}" -X PATCH "$API_URL/$page_id" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\",\"contentHtml\":$(echo "$content" | jq -Rs .),\"url\":\"$page_url\"}" \
    -o "$patch_temp" 2>/dev/null)
  patch_body=$(cat "$patch_temp")
  rm -f "$patch_temp"
  
  if [[ "$patch_http_code" != "200" ]]; then
    echo "  ❌ PATCH failed: HTTP $patch_http_code" | tee -a "$LOG_FILE"
    echo "$patch_body" > "$FAILED_VALIDATION_DIR/${filename%.html}-patch-failed.json" || true
    failed_patch=$((failed_patch + 1))
    continue
  fi
  
  echo "  ✅ PATCH successful" | tee -a "$LOG_FILE"
  
  # Check standard validation
  validation_passed=$(echo "$patch_body" | jq -r '.data.validation.passed // .validation.passed // false')
  if [[ "$validation_passed" != "true" ]]; then
    echo "  ⚠️  Standard validation failed" | tee -a "$LOG_FILE"
    failed_validation=$((failed_validation + 1))
    # Continue to comparator anyway - might give additional insights
  else
    echo "  ✅ Standard validation passed" | tee -a "$LOG_FILE"
  fi
  
  # STEP 2: Run completeness comparison
  if [[ "$SKIP_COMPARATOR" == "0" ]]; then
    echo "  2️⃣  Running completeness comparison..." | tee -a "$LOG_FILE"
    
    # Use /notion-db-row endpoint to compare and update properties
    compare_temp=$(mktemp)
    compare_http_code=$(curl -s -m 60 -w "%{http_code}" -X POST "$COMPARATOR_URL/notion-db-row" \
      -H "Content-Type: application/json" \
      -d "{\"pageId\":\"$page_id\",\"srcText\":$(echo "$source_text" | jq -Rs .)}" \
      -o "$compare_temp" 2>/dev/null)
    compare_body=$(cat "$compare_temp")
    rm -f "$compare_temp"
    
    if [[ "$compare_http_code" != "200" ]]; then
      echo "  ⚠️  Comparator failed: HTTP $compare_http_code" | tee -a "$LOG_FILE"
      echo "     (Continuing with standard validation only)" | tee -a "$LOG_FILE"
    else
      coverage=$(echo "$compare_body" | jq -r '.coverage // 0')
      missing_count=$(echo "$compare_body" | jq -r '.missingCount // 0')
      method=$(echo "$compare_body" | jq -r '.method // "unknown"')
      
      echo "  📊 Coverage: ${coverage} (threshold: $COVERAGE_THRESHOLD)" | tee -a "$LOG_FILE"
      echo "  📊 Missing spans: ${missing_count} (max allowed: $MAX_MISSING_SPANS)" | tee -a "$LOG_FILE"
      echo "  📊 Method: ${method}" | tee -a "$LOG_FILE"
      
      # Check completeness thresholds
      coverage_ok=$(echo "$coverage >= $COVERAGE_THRESHOLD" | bc -l)
      missing_ok=$([[ "$missing_count" -le "$MAX_MISSING_SPANS" ]] && echo "1" || echo "0")
      
      if [[ "$coverage_ok" == "1" && "$missing_ok" == "1" ]]; then
        echo "  ✅ Completeness validation passed" | tee -a "$LOG_FILE"
      else
        echo "  ❌ Completeness validation failed" | tee -a "$LOG_FILE"
        if [[ "$coverage_ok" == "0" ]]; then
          echo "     Coverage ${coverage} below threshold ${COVERAGE_THRESHOLD}" | tee -a "$LOG_FILE"
        fi
        if [[ "$missing_ok" == "0" ]]; then
          echo "     Missing spans ${missing_count} exceeds max ${MAX_MISSING_SPANS}" | tee -a "$LOG_FILE"
        fi
        failed_completeness=$((failed_completeness + 1))
        
        # Save to incomplete-content directory for review
        cp "$html_file" "$INCOMPLETE_DIR/"
        incomplete_content=$((incomplete_content + 1))
      fi
    fi
  else
    echo "  ⏭️  Skipping completeness comparison (comparator unavailable)" | tee -a "$LOG_FILE"
  fi
  
  # STEP 3: Determine final status
  echo "" | tee -a "$LOG_FILE"
  if [[ "$validation_passed" == "true" && "$SKIP_COMPARATOR" == "1" ]]; then
    # Standard validation passed, comparator skipped
    echo "  ✅ Moving to updated-pages/ (standard validation passed)" | tee -a "$LOG_FILE"
    mv "$html_file" "$DST_DIR/"
    successful=$((successful + 1))
  elif [[ "$validation_passed" == "true" && "$coverage_ok" == "1" && "$missing_ok" == "1" ]]; then
    # Both validations passed
    echo "  ✅ Moving to updated-pages/ (all validations passed)" | tee -a "$LOG_FILE"
    mv "$html_file" "$DST_DIR/"
    successful=$((successful + 1))
  else
    # At least one validation failed
    echo "  ⚠️  Keeping in pages-to-update/ (validation issues)" | tee -a "$LOG_FILE"
  fi
  
  echo "" | tee -a "$LOG_FILE"
  
  # Cooldown logic
  chunk_count=$((chunk_count + 1))
  if [[ $chunk_count -ge $PAGES_PER_CHUNK ]]; then
    echo "[COOLDOWN] Processed $PAGES_PER_CHUNK pages, waiting ${COOLDOWN_AFTER_CHUNK}s..." | tee -a "$LOG_FILE"
    sleep $COOLDOWN_AFTER_CHUNK
    chunk_count=0
  else
    sleep $PAGE_DELAY
  fi
done

# Final summary
echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Batch Processing Complete" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Processed: $processed" | tee -a "$LOG_FILE"
echo "Successful: $successful" | tee -a "$LOG_FILE"
echo "Failed PATCH: $failed_patch" | tee -a "$LOG_FILE"
echo "Failed Standard Validation: $failed_validation" | tee -a "$LOG_FILE"
echo "Failed Completeness: $failed_completeness" | tee -a "$LOG_FILE"
echo "Incomplete Content: $incomplete_content (see $INCOMPLETE_DIR/)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

if [[ $successful -eq $processed ]]; then
  exit 0
else
  exit 1
fi
