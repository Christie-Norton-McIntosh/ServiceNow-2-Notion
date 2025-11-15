#!/usr/bin/env bash
set -euo pipefail

# Batch PATCH validated pages from pages-to-update to Notion
# Only PATCH pages that pass validation
# Move to updated-pages after successful PATCH with clean validation

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/patch/pages-to-update"
DST_DIR="$SRC_DIR/updated-pages"
PROBLEMATIC_DIR="$SRC_DIR/problematic-files"
LOG_DIR="$SRC_DIR/log"
mkdir -p "$LOG_DIR" "$DST_DIR" "$PROBLEMATIC_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/batch-patch-$TS.log"

API_URL="http://localhost:3004/api/W2N"

echo "[INFO] Batch PATCH with validation" | tee -a "$LOG_FILE"
echo "[INFO] Source: $SRC_DIR" | tee -a "$LOG_FILE"
echo "[INFO] Destination: $DST_DIR" | tee -a "$LOG_FILE"
echo "[INFO] Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

total=0
patched=0
failed_validation=0
failed_patch=0
skipped=0
timeouts=0

shopt -s nullglob

for html_file in "$SRC_DIR"/*.html; do
  [[ -e "$html_file" ]] || continue
  filename=$(basename "$html_file")
  total=$((total+1))

  echo "[$total] 🔍 Processing: $filename" | tee -a "$LOG_FILE"

  # Extract Page ID
  page_id=$(grep -m1 "Page ID:" "$html_file" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' || echo "")
  
  if [[ -z "$page_id" ]]; then
    echo "  ⚠️  No Page ID - skipping" | tee -a "$LOG_FILE"
    skipped=$((skipped+1))
    continue
  fi

  echo "  Page ID: $page_id" | tee -a "$LOG_FILE"

  # Read HTML content
  content=$(cat "$html_file")
  title="${filename%.html}"

  # Create JSON payload (contentHtml is the key the PATCH endpoint expects)
  json_payload=$(jq -n \
    --arg title "$title" \
    --arg content "$content" \
    --arg url "https://docs.servicenow.com" \
    '{
      title: $title,
      contentHtml: $content,
      url: $url
    }')

  # STEP 1: Dry-run validation
  echo "  1️⃣  Validating..." | tee -a "$LOG_FILE"
  # Timing start for validation
  validate_start_epoch=$(date +%s)
  validate_start_human=$(date +"%Y-%m-%d %H:%M:%S")
  echo "  🕒 Validation start: $validate_start_human (epoch $validate_start_epoch)" | tee -a "$LOG_FILE"
  dry_response=$(curl -s -m 60 -w "\n%{http_code}" -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"test\",\"databaseId\":\"178f8dc43e2780d09be1c568a04d7bf3\",\"content\":$(echo "$content" | jq -Rs .),\"url\":\"https://test.com\",\"dryRun\":true}" \
    2>&1)

  dry_http_code=$(echo "$dry_response" | tail -n1)
  dry_body=$(echo "$dry_response" | sed '$d')

  if [[ "$dry_http_code" != "200" ]]; then
    echo "  ❌ Validation HTTP error: $dry_http_code" | tee -a "$LOG_FILE"
    failed_validation=$((failed_validation+1))
    continue
  fi

  has_errors=$(echo "$dry_body" | jq -r '.validationResult.hasErrors // false')
  
  if [[ "$has_errors" != "false" ]]; then
    echo "  ❌ Validation failed" | tee -a "$LOG_FILE"
    error_count=$(echo "$dry_body" | jq -r '.validationResult.errors | length')
    echo "     Errors: $error_count" | tee -a "$LOG_FILE"
    # Show first error
    first_error=$(echo "$dry_body" | jq -r '.validationResult.errors[0].message // "Unknown"')
    echo "     First: $first_error" | tee -a "$LOG_FILE"
    failed_validation=$((failed_validation+1))
    continue
  fi

  echo "  ✅ Validation passed" | tee -a "$LOG_FILE"
  # Validation timing end
  validate_end_epoch=$(date +%s)
  validate_end_human=$(date +"%Y-%m-%d %H:%M:%S")
  validate_duration=$((validate_end_epoch - validate_start_epoch))
  echo "  🕒 Validation end:   $validate_end_human (duration ${validate_duration}s)" | tee -a "$LOG_FILE"
  if (( validate_duration > 45 )); then
    echo "  ⚠️  Validation duration exceeded 45s (may indicate slowdown)" | tee -a "$LOG_FILE"
  fi

  # STEP 2: Execute PATCH
  echo "  2️⃣  PATCHing page..." | tee -a "$LOG_FILE"
  # Timing start for PATCH
  patch_start_epoch=$(date +%s)
  patch_start_human=$(date +"%Y-%m-%d %H:%M:%S")
  echo "  🕒 PATCH start: $patch_start_human (epoch $patch_start_epoch)" | tee -a "$LOG_FILE"
  
  # Run PATCH with timeout detection using background job + kill
  # Start curl in background and capture PID
  (
    curl -s -m 120 -w "\n%{http_code}" -X PATCH "$API_URL/$page_id" \
      -H "Content-Type: application/json" \
      -d "$json_payload" \
      2>&1
  ) > /tmp/patch_response_$$.txt &
  curl_pid=$!
  
  # Wait for curl with manual timeout (130s to give curl's 120s timeout a chance)
  timeout_seconds=130
  elapsed=0
  while kill -0 $curl_pid 2>/dev/null && (( elapsed < timeout_seconds )); do
    sleep 1
    elapsed=$((elapsed + 1))
    if (( elapsed % 30 == 0 )); then
      echo "  ⏳ PATCH still running... ${elapsed}s elapsed" | tee -a "$LOG_FILE"
    fi
  done
  
  # Check if process is still running (timeout occurred)
  if kill -0 $curl_pid 2>/dev/null; then
    echo "  ⏱️  PATCH TIMEOUT (${timeout_seconds}s) - killing curl and moving to problematic-files/" | tee -a "$LOG_FILE"
    kill -9 $curl_pid 2>/dev/null
    wait $curl_pid 2>/dev/null
    rm -f /tmp/patch_response_$$.txt
    mv "$html_file" "$PROBLEMATIC_DIR/"
    timeouts=$((timeouts+1))
    echo "  📦 File quarantined for investigation" | tee -a "$LOG_FILE"
    continue
  fi
  
  # Process completed, read response
  wait $curl_pid
  curl_exit_code=$?
  patch_response=$(cat /tmp/patch_response_$$.txt)
  rm -f /tmp/patch_response_$$.txt

  patch_http_code=$(echo "$patch_response" | tail -n1)
  patch_body=$(echo "$patch_response" | sed '$d')

  # Check for timeout (curl exit code 28) or other curl errors
  if [[ $curl_exit_code -eq 28 ]]; then
    echo "  ⏱️  PATCH TIMEOUT (120s) - moving to problematic-files/" | tee -a "$LOG_FILE"
    mv "$html_file" "$PROBLEMATIC_DIR/"
    timeouts=$((timeouts+1))
    echo "  📦 File quarantined for investigation" | tee -a "$LOG_FILE"
    continue
  fi

  if [[ $curl_exit_code -ne 0 ]]; then
    echo "  ❌ PATCH curl error: exit code $curl_exit_code" | tee -a "$LOG_FILE"
    # Also move curl errors to problematic-files
    mv "$html_file" "$PROBLEMATIC_DIR/"
    timeouts=$((timeouts+1))
    echo "  📦 File quarantined due to curl error" | tee -a "$LOG_FILE"
    continue
  fi

  if [[ "$patch_http_code" != "200" ]]; then
    echo "  ❌ PATCH failed: HTTP $patch_http_code" | tee -a "$LOG_FILE"
    # Check if it's a timeout-related HTTP error
    if [[ "$patch_http_code" == "000" || "$patch_http_code" == "" ]]; then
      echo "  ⏱️  Empty HTTP code suggests timeout - moving to problematic-files/" | tee -a "$LOG_FILE"
      mv "$html_file" "$PROBLEMATIC_DIR/"
      timeouts=$((timeouts+1))
      continue
    fi
    failed_patch=$((failed_patch+1))
    continue
  fi

  # PATCH timing end (only reachable if curl returned)
  patch_end_epoch=$(date +%s)
  patch_end_human=$(date +"%Y-%m-%d %H:%M:%S")
  patch_duration=$((patch_end_epoch - patch_start_epoch))
  echo "  🕒 PATCH end:   $patch_end_human (duration ${patch_duration}s)" | tee -a "$LOG_FILE"
  if (( patch_duration > 90 )); then
    echo "  ⚠️  PATCH duration exceeded 90s (near timeout threshold)" | tee -a "$LOG_FILE"
  fi

  # Check PATCH validation result
  patch_has_errors=$(echo "$patch_body" | jq -r '.validationResult.hasErrors // false')
  
  if [[ "$patch_has_errors" != "false" ]]; then
    echo "  ⚠️  PATCH succeeded but validation errors detected - file stays in pages-to-update" | tee -a "$LOG_FILE"
    failed_validation=$((failed_validation+1))
    continue
  fi

  echo "  ✅ PATCH successful with clean validation" | tee -a "$LOG_FILE"

  # STEP 3: Move to updated-pages
  mv "$html_file" "$DST_DIR/"
  patched=$((patched+1))
  echo "  📦 Moved to updated-pages/" | tee -a "$LOG_FILE"

  # STEP 4: Per-page Notion property refresh (update Validation/Stats/Error)
  clean_page_id=$(echo "$page_id" | tr -d '-')
  echo "  🔄 Refresh properties for page: $clean_page_id" | tee -a "$LOG_FILE"
  refresh_resp=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3004/api/validate" \
    -H "Content-Type: application/json" \
    -d "{\"pageIds\":[\"$clean_page_id\"]}" 2>&1 || echo -e "\n000")
  refresh_http=$(echo "$refresh_resp" | tail -n1)
  refresh_body=$(echo "$refresh_resp" | sed '$d')
  if [[ "$refresh_http" == "200" ]]; then
    updated=$(echo "$refresh_body" | jq -r '.data.summary.updated // 0' 2>/dev/null || echo 0)
    cleared=$(echo "$refresh_body" | jq -r '.data.summary.errorsCleared // 0' 2>/dev/null || echo 0)
    failed_prop=$(echo "$refresh_body" | jq -r '.data.summary.failed // 0' 2>/dev/null || echo 0)
    echo "     ↳ Property refresh: updated=$updated errorsCleared=$cleared failed=$failed_prop" | tee -a "$LOG_FILE"
  else
    echo "     ↳ [WARN] Property refresh HTTP $refresh_http" | tee -a "$LOG_FILE"
  fi

  # Progress indicator
  if (( total % 10 == 0 )); then
    echo "" | tee -a "$LOG_FILE"
    echo "[PROGRESS] Processed: $total | Patched: $patched | Failed: $((failed_validation + failed_patch))" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "BATCH PATCH COMPLETE" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "Total processed:        $total" | tee -a "$LOG_FILE"
echo "✅ Patched successfully: $patched" | tee -a "$LOG_FILE"
echo "❌ Failed validation:    $failed_validation" | tee -a "$LOG_FILE"
echo "❌ Failed PATCH:         $failed_patch" | tee -a "$LOG_FILE"
echo "⏱️  Timeouts/quarantined: $timeouts" | tee -a "$LOG_FILE"
echo "⚠️  Skipped (no ID):     $skipped" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
if (( timeouts > 0 )); then
  echo "⚠️  $timeouts file(s) quarantined in problematic-files/ for investigation" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
fi
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"

exit 0
