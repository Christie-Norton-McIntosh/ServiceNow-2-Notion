#!/usr/bin/env bash
set -euo pipefail

# Batch PATCH with cooldown periods to avoid rate limits
# Process in chunks with delays between pages

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/patch/pages-to-update"
DST_DIR="$SRC_DIR/updated-pages"
PROBLEMATIC_DIR="$SRC_DIR/problematic-files"
LOG_DIR="$SRC_DIR/log"
FAILED_VALIDATION_DIR="$SRC_DIR/failed-validation"
mkdir -p "$LOG_DIR" "$DST_DIR" "$PROBLEMATIC_DIR"
mkdir -p "$FAILED_VALIDATION_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/batch-patch-cooldown-$TS.log"

API_URL="http://localhost:3004/api/W2N"
HEALTH_URL_PRIMARY="http://localhost:3004/api/health"
HEALTH_URL_ALT="http://localhost:3004/health" # legacy fallback when modular routes missing

# Cooldown settings
PAGES_PER_CHUNK=3        # Process 3 pages
COOLDOWN_AFTER_CHUNK=10  # Then wait 10 seconds
PAGE_DELAY=2             # 2 second delay between individual pages

echo "[SERVER] Checking ServiceNow-2-Notion proxy availability (/api/health preferred)..." | tee -a "$LOG_FILE"

# If health check fails, start the server locally (verbose + validation flags) and wait until it's healthy.
health_ok=0
if curl -sf -m2 "$HEALTH_URL_PRIMARY" >/dev/null 2>&1; then
  health_ok=1
elif curl -sf -m2 "$HEALTH_URL_ALT" >/dev/null 2>&1; then
  health_ok=1
fi

if [[ $health_ok -ne 1 ]]; then
  echo "[SERVER] Not responding — starting server..." | tee -a "$LOG_FILE"
  (
    cd "$ROOT_DIR/server" && \
    SN2N_VERBOSE=1 SN2N_VALIDATE_OUTPUT=1 SN2N_ORPHAN_LIST_REPAIR=1 node sn2n-proxy.cjs
  ) &
  SERVER_PID=$!
  echo "[SERVER] Launch PID: $SERVER_PID" | tee -a "$LOG_FILE"
  server_ready=0
  for i in $(seq 1 30); do
    if curl -sf -m2 "$HEALTH_URL_PRIMARY" >/dev/null 2>&1 || curl -sf -m2 "$HEALTH_URL_ALT" >/dev/null 2>&1; then
      echo "[SERVER] Healthy after ${i}s (PID $SERVER_PID)" | tee -a "$LOG_FILE"
      server_ready=1
      break
    fi
    if [[ $((i % 5)) -eq 0 ]]; then
      echo "[SERVER] Waiting for health... ${i}s elapsed" | tee -a "$LOG_FILE"
    fi
    sleep 1
  done
  if [[ "$server_ready" -ne 1 ]]; then
    echo "[ERROR] Server failed to become healthy within 30s. Aborting batch." | tee -a "$LOG_FILE"
    exit 1
  fi
else
  echo "[SERVER] Already healthy — reusing existing instance" | tee -a "$LOG_FILE"
fi

echo "[INFO] Batch PATCH with cooldown" | tee -a "$LOG_FILE"
echo "[INFO] Chunk size: $PAGES_PER_CHUNK pages" | tee -a "$LOG_FILE"
echo "[INFO] Cooldown: ${COOLDOWN_AFTER_CHUNK}s after each chunk" | tee -a "$LOG_FILE"
echo "[INFO] Page delay: ${PAGE_DELAY}s between pages" | tee -a "$LOG_FILE"
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
chunk_count=0

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

  # STEP 1: Dry-run validation
  echo "  1️⃣  Validating..." | tee -a "$LOG_FILE"
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
    # Capture body if present
    if [[ -n "$dry_body" ]]; then
      echo "$dry_body" > "$FAILED_VALIDATION_DIR/${filename%.html}-validation.json" || true
    fi
    # Optional single retry if VALIDATION_RETRY=1
    if [[ "${VALIDATION_RETRY:-0}" == "1" ]]; then
      echo "  ↻ Retry validation (VALIDATION_RETRY=1)" | tee -a "$LOG_FILE"
      sleep 2
      retry_response=$(curl -s -m 60 -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"test\",\"databaseId\":\"178f8dc43e2780d09be1c568a04d7bf3\",\"content\":$(echo "$content" | jq -Rs .),\"url\":\"https://test.com\",\"dryRun\":true}" 2>&1)
      retry_http_code=$(echo "$retry_response" | tail -n1)
      retry_body=$(echo "$retry_response" | sed '$d')
      echo "    ↳ Retry HTTP: $retry_http_code" | tee -a "$LOG_FILE"
      if [[ "$retry_http_code" == "200" ]]; then
        retry_has_errors=$(echo "$retry_body" | jq -r '.validationResult.hasErrors // false')
        if [[ "$retry_has_errors" == "false" ]]; then
          echo "    ✅ Retry validation passed; continuing to PATCH" | tee -a "$LOG_FILE"
          dry_http_code=200
          dry_body="$retry_body"
        else
          echo "    ❌ Retry still failing" | tee -a "$LOG_FILE"
        fi
      fi
    fi
    if [[ "$dry_http_code" != "200" ]]; then
    continue
  fi
  fi

  has_errors=$(echo "$dry_body" | jq -r '.validationResult.hasErrors // false')
  
  if [[ "$has_errors" != "false" ]]; then
    echo "  ❌ Validation failed" | tee -a "$LOG_FILE"
    error_count=$(echo "$dry_body" | jq -r '.validationResult.errors | length')
    echo "     Errors: $error_count" | tee -a "$LOG_FILE"
    first_error=$(echo "$dry_body" | jq -r '.validationResult.errors[0].message // "Unknown"')
    echo "     First: $first_error" | tee -a "$LOG_FILE"
    echo "$dry_body" > "$FAILED_VALIDATION_DIR/${filename%.html}-validation.json" || true
    # Optional retry
    if [[ "${VALIDATION_RETRY:-0}" == "1" ]]; then
      echo "  ↻ Retry validation (VALIDATION_RETRY=1)" | tee -a "$LOG_FILE"
      sleep 2
      retry_response=$(curl -s -m 60 -w "\n%{http_code}" -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"test\",\"databaseId\":\"178f8dc43e2780d09be1c568a04d7bf3\",\"content\":$(echo "$content" | jq -Rs .),\"url\":\"https://test.com\",\"dryRun\":true}" 2>&1)
      retry_http_code=$(echo "$retry_response" | tail -n1)
      retry_body=$(echo "$retry_response" | sed '$d')
      echo "    ↳ Retry HTTP: $retry_http_code" | tee -a "$LOG_FILE"
      if [[ "$retry_http_code" == "200" ]]; then
        retry_has_errors=$(echo "$retry_body" | jq -r '.validationResult.hasErrors // false')
        if [[ "$retry_has_errors" == "false" ]]; then
          echo "    ✅ Retry validation passed; continuing to PATCH" | tee -a "$LOG_FILE"
          dry_body="$retry_body"
          has_errors=false
        else
          echo "    ❌ Retry still failing" | tee -a "$LOG_FILE"
        fi
      fi
    fi
    if [[ "$has_errors" != "false" ]]; then
    failed_validation=$((failed_validation+1))
    continue
    fi
  fi

  echo "  ✅ Validation passed" | tee -a "$LOG_FILE"
  validate_end_epoch=$(date +%s)
  validate_duration=$((validate_end_epoch - validate_start_epoch))
  validate_end_human=$(date +"%Y-%m-%d %H:%M:%S")
  echo "  🕒 Validation end:   $validate_end_human (duration ${validate_duration}s)" | tee -a "$LOG_FILE"

  # STEP 2: Execute PATCH with adaptive timeout based on complexity
  echo "  2️⃣  PATCHing page..." | tee -a "$LOG_FILE"
  
  # Estimate complexity from dry-run response
  block_count=$(echo "$dry_body" | jq -r '.data.children | length' 2>/dev/null || echo 0)
  table_count=$(echo "$dry_body" | jq -r '[.data.children[] | select(.type == "table")] | length' 2>/dev/null || echo 0)
  
  echo "  📊 Complexity: $block_count blocks, $table_count tables" | tee -a "$LOG_FILE"
  
  # Adaptive timeout selection
  if [[ $block_count -gt 500 || $table_count -gt 50 ]]; then
    manual_timeout=480  # 8 minutes for very complex pages (80+ tables)
    echo "  ⚡ Using extended timeout: ${manual_timeout}s (high complexity)" | tee -a "$LOG_FILE"
  elif [[ $block_count -gt 300 || $table_count -gt 30 ]]; then
    manual_timeout=300  # 5 minutes for complex pages (30-80 tables)
    echo "  ⚡ Using extended timeout: ${manual_timeout}s (medium complexity)" | tee -a "$LOG_FILE"
  else
    manual_timeout=180  # 3 minutes for normal pages
    echo "  ⚡ Using standard timeout: ${manual_timeout}s" | tee -a "$LOG_FILE"
  fi
  
  patch_start_epoch=$(date +%s)
  patch_start_human=$(date +"%Y-%m-%d %H:%M:%S")
  echo "  🕒 PATCH start: $patch_start_human (epoch $patch_start_epoch)" | tee -a "$LOG_FILE"

  # Start PATCH in background and monitor
  temp_response="/tmp/patch-response-$$-$total.txt"
  
  curl -s -m "$manual_timeout" -w "\n%{http_code}" -X PATCH "$API_URL/$page_id" \
    -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\",\"contentHtml\":$(echo "$content" | jq -Rs .),\"url\":\"https://docs.servicenow.com\"}" \
    > "$temp_response" 2>&1 &
  
  curl_pid=$!
  elapsed=0
  
  while kill -0 "$curl_pid" 2>/dev/null; do
    sleep 10
    elapsed=$((elapsed + 10))
    
    if [[ $elapsed -ge $manual_timeout ]]; then
      echo "  ⏱️  Manual timeout at ${manual_timeout}s - terminating" | tee -a "$LOG_FILE"
      kill "$curl_pid" 2>/dev/null || true
      wait "$curl_pid" 2>/dev/null || true
      rm -f "$temp_response"
      
      # Move to problematic-files
      mv "$html_file" "$PROBLEMATIC_DIR/"
      echo "  🚫 Moved to problematic-files/ due to timeout" | tee -a "$LOG_FILE"
      timeouts=$((timeouts+1))
      break
    fi
    
    if [[ $((elapsed % 30)) -eq 0 ]]; then
      echo "  ⏳ PATCH still running... ${elapsed}s elapsed" | tee -a "$LOG_FILE"
    fi
  done
  
  # Check if process was terminated by timeout
  if ! kill -0 "$curl_pid" 2>/dev/null && [[ $elapsed -lt $manual_timeout ]]; then
    # Process completed naturally
    wait "$curl_pid" 2>/dev/null || true
    
    patch_end_epoch=$(date +%s)
    patch_duration=$((patch_end_epoch - patch_start_epoch))
    patch_end_human=$(date +"%Y-%m-%d %H:%M:%S")
    echo "  🕒 PATCH end:   $patch_end_human (duration ${patch_duration}s)" | tee -a "$LOG_FILE"
    
    if [[ -f "$temp_response" ]]; then
      patch_http_code=$(tail -n1 "$temp_response")
      patch_body=$(sed '$d' "$temp_response")
      
      if [[ "$patch_http_code" == "200" ]]; then
        # Verify validation passed
        validation_result=$(echo "$patch_body" | jq -r '.validationResult // {}')
        has_errors=$(echo "$validation_result" | jq -r '.hasErrors // false')
        
        if [[ "$has_errors" != "false" ]]; then
          echo "  ❌ PATCH completed but validation failed" | tee -a "$LOG_FILE"
          failed_patch=$((failed_patch+1))
        else
          echo "  ✅ PATCH successful with clean validation" | tee -a "$LOG_FILE"
          mv "$html_file" "$DST_DIR/"
          echo "  📦 Moved to updated-pages/" | tee -a "$LOG_FILE"
          patched=$((patched+1))

          # Per-page Notion property refresh
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
        fi
      else
        echo "  ❌ PATCH HTTP error: $patch_http_code" | tee -a "$LOG_FILE"
        failed_patch=$((failed_patch+1))
      fi
      
      rm -f "$temp_response"
    else
      echo "  ❌ PATCH response file missing" | tee -a "$LOG_FILE"
      failed_patch=$((failed_patch+1))
    fi
  elif [[ $elapsed -ge $manual_timeout ]]; then
    # Already handled timeout above
    :
  fi

  # Cooldown logic
  chunk_count=$((chunk_count + 1))
  
  if [[ $((chunk_count % PAGES_PER_CHUNK)) -eq 0 ]]; then
    echo "" | tee -a "$LOG_FILE"
    echo "[PROGRESS] Processed: $total | Patched: $patched | Failed: $((failed_validation + failed_patch)) | Timeouts: $timeouts" | tee -a "$LOG_FILE"
    echo "⏸️  Cooldown: ${COOLDOWN_AFTER_CHUNK}s to avoid rate limits..." | tee -a "$LOG_FILE"
    sleep $COOLDOWN_AFTER_CHUNK
    echo "" | tee -a "$LOG_FILE"
  else
    # Small delay between individual pages
    sleep $PAGE_DELAY
  fi

done

echo "" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "BATCH PATCH COMPLETE" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
echo "Total processed: $total" | tee -a "$LOG_FILE"
echo "Successfully patched: $patched" | tee -a "$LOG_FILE"
echo "Failed validation: $failed_validation" | tee -a "$LOG_FILE"
echo "Failed PATCH: $failed_patch" | tee -a "$LOG_FILE"
echo "Timeouts: $timeouts" | tee -a "$LOG_FILE"
echo "Skipped: $skipped" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Failure artifact summary (validation failures captured earlier)
failed_validation_artifacts=$(ls -1 "$FAILED_VALIDATION_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
echo "" | tee -a "$LOG_FILE"
echo "[SUMMARY] Validation failure artifacts: $failed_validation_artifacts" | tee -a "$LOG_FILE"
if [[ "$failed_validation_artifacts" -gt 0 ]]; then
  echo "[SUMMARY] Listing failed validation files:" | tee -a "$LOG_FILE"
  for vf in "$FAILED_VALIDATION_DIR"/*.json; do
    [[ -e "$vf" ]] || continue
    basevf=$(basename "$vf")
    # Extract first error message if present
    first_msg=$(jq -r '.validationResult.errors[0].message // empty' "$vf" 2>/dev/null || echo "")
    if [[ -n "$first_msg" ]]; then
      echo "  • $basevf → $first_msg" | tee -a "$LOG_FILE"
    else
      echo "  • $basevf" | tee -a "$LOG_FILE"
    fi
  done
else
  echo "[SUMMARY] No validation failure artifacts generated." | tee -a "$LOG_FILE"
fi

# Post-process: trigger property refresh to update Notion DB properties
echo "" | tee -a "$LOG_FILE"
echo "[POST] Triggering Notion property refresh (revalidate-updated-pages.sh)" | tee -a "$LOG_FILE"
REVALIDATE_SCRIPT="$ROOT_DIR/patch/config/revalidate-updated-pages.sh"
if [[ -f "$REVALIDATE_SCRIPT" ]]; then
  # Run the revalidation + property refresh; don't fail the whole batch if it encounters issues
  bash "$REVALIDATE_SCRIPT" 2>&1 | tee -a "$LOG_FILE" || echo "[WARN] Property refresh encountered issues (see log above)" | tee -a "$LOG_FILE"
else
  echo "[WARN] revalidate-updated-pages.sh not found at $REVALIDATE_SCRIPT" | tee -a "$LOG_FILE"
fi

