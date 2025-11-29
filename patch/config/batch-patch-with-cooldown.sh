#!/usr/bin/env bash
set -euo pipefail

# Batch PATCH with cooldown periods to avoid rate limits
# Process in chunks with delays between pages

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Unified page state hub (see docs):
# - INPUT:  $BASE_DIR/pages-to-update/
# - OUTPUT: $BASE_DIR/updated-pages/
# - LOGS:   $BASE_DIR/log/
# - FAILED: $BASE_DIR/failed-validation/
# - PROB:   $BASE_DIR/problematic-files/
BASE_DIR="$ROOT_DIR/patch/pages"
SRC_DIR="$BASE_DIR/pages-to-update"
DST_DIR="$BASE_DIR/updated-pages"
PROBLEMATIC_DIR="$BASE_DIR/problematic-files"
LOG_DIR="$BASE_DIR/log"
FAILED_VALIDATION_DIR="$BASE_DIR/failed-validation"
UNSUCCESSFUL_DIR="$BASE_DIR/patch-unsuccessful"
PAGE_NOT_FOUND_DIR="$BASE_DIR/page-not-found"
UPDATED_ARCHIVE_DIR="$BASE_DIR/updated-archive"
mkdir -p "$LOG_DIR" "$DST_DIR" "$PROBLEMATIC_DIR" "$UNSUCCESSFUL_DIR" "$PAGE_NOT_FOUND_DIR" "$UPDATED_ARCHIVE_DIR"
mkdir -p "$FAILED_VALIDATION_DIR"

# Automatic retry settings for transient generic HTTP failures (5xx, 429, network timeouts)
# Override with environment variable MAX_GENERIC_RETRIES
MAX_GENERIC_RETRIES="${MAX_GENERIC_RETRIES:-2}"  # Total additional attempts AFTER the initial try
GENERIC_RETRY_BASE_DELAY="${GENERIC_RETRY_BASE_DELAY:-5}" # seconds

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/batch-patch-cooldown-$TS.log"

API_URL="http://localhost:3004/api/W2N"
HEALTH_URL_PRIMARY="http://localhost:3004/api/health"
HEALTH_URL_ALT="http://localhost:3004/health" # legacy fallback when modular routes missing

# Optional: Database used for auto-lookup by title when Page ID is missing
# Set via environment variable LOOKUP_DATABASE_ID or pass inline before the command.
# Example:
#   LOOKUP_DATABASE_ID=2b7a89fe-dba5-806f-b665-fced0638c708 bash batch-patch-with-cooldown.sh
LOOKUP_DATABASE_ID="${LOOKUP_DATABASE_ID:-}"

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
    SN2N_VERBOSE=1 SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1 SN2N_ORPHAN_LIST_REPAIR=1 node sn2n-proxy.cjs
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
  # Ensure newest validation modes are enabled; if not, restart with flags
  status_json=$(curl -s "http://localhost:3004/api/status" || true)
  validate_output_enabled=$(echo "$status_json" | jq -r '.data.env.SN2N_VALIDATE_OUTPUT // "0"')
  content_validation_enabled=$(echo "$status_json" | jq -r '.data.env.SN2N_CONTENT_VALIDATION // "0"')
  if [[ "$validate_output_enabled" != "1" || "$content_validation_enabled" != "1" ]]; then
    echo "[SERVER] Validation flags not enabled (SN2N_VALIDATE_OUTPUT=$validate_output_enabled, SN2N_CONTENT_VALIDATION=$content_validation_enabled) — restarting with newest validation" | tee -a "$LOG_FILE"
    pkill -f sn2n-proxy.cjs 2>/dev/null || killall node 2>/dev/null || true
    sleep 2
    (
      cd "$ROOT_DIR/server" && \
      SN2N_VERBOSE=1 SN2N_VALIDATE_OUTPUT=1 SN2N_CONTENT_VALIDATION=1 SN2N_ORPHAN_LIST_REPAIR=1 node sn2n-proxy.cjs
    ) &
    SERVER_PID=$!
    echo "[SERVER] Relaunch PID: $SERVER_PID" | tee -a "$LOG_FILE"
    for i in $(seq 1 30); do
      if curl -sf -m2 "$HEALTH_URL_PRIMARY" >/dev/null 2>&1 || curl -sf -m2 "$HEALTH_URL_ALT" >/dev/null 2>&1; then
        echo "[SERVER] Healthy after ${i}s (PID $SERVER_PID)" | tee -a "$LOG_FILE"
        break
      fi
      if [[ $((i % 5)) -eq 0 ]]; then
        echo "[SERVER] Waiting for health... ${i}s elapsed" | tee -a "$LOG_FILE"
      fi
      sleep 1
    done
  else
    echo "[SERVER] Validation flags already enabled — proceeding" | tee -a "$LOG_FILE"
  fi
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
unsuccessful_moved=0
page_not_found=0
skipped=0
timeouts=0
chunk_count=0
retried_generic=0
successful_after_retry=0

shopt -s nullglob

for html_file in "$SRC_DIR"/*.html; do
  [[ -e "$html_file" ]] || continue
  filename=$(basename "$html_file")
  total=$((total+1))

  echo "[$total] 🔍 Processing: $filename" | tee -a "$LOG_FILE"

  # Extract Page ID
  page_id=$(grep -m1 "Page ID:" "$html_file" | sed -E 's/.*Page ID: ([a-f0-9-]+).*/\1/' || echo "")
  
  if [[ -z "$page_id" ]]; then
    echo "  ⚠️  No Page ID found in file — attempting auto-lookup by title" | tee -a "$LOG_FILE"

    # Derive title guess from filename: strip timestamp suffix and replace dashes with spaces
    base_no_ext="${filename%.html}"
    # Remove trailing timestamp like -2025-11-22T20-58-17
    base_cleaned=$(echo "$base_no_ext" | sed -E 's/-20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}$//')
    title_guess=$(echo "$base_cleaned" | tr '-' ' ')

    if [[ -z "$LOOKUP_DATABASE_ID" ]]; then
      echo "  ℹ️  LOOKUP_DATABASE_ID not set; cannot auto-lookup. Skipping file." | tee -a "$LOG_FILE"
      skipped=$((skipped+1))
      continue
    fi

    # Fetch database schema to find the title property name
    db_schema=$(curl -s "http://localhost:3004/api/databases/$LOOKUP_DATABASE_ID" || true)
    title_prop=$(echo "$db_schema" | jq -r '.data.properties | to_entries[] | select(.value.type=="title") | .key' | head -n 1)

    if [[ -z "$title_prop" || "$title_prop" == "null" ]]; then
      echo "  ⚠️  Could not determine title property for database $LOOKUP_DATABASE_ID — skipping" | tee -a "$LOG_FILE"
      skipped=$((skipped+1))
      continue
    fi

    # Query the database for pages where title contains the guess
    query_json=$(jq -nc --arg prop "$title_prop" --arg guess "$title_guess" '{page_size:100, filter:{property:$prop, title:{contains:$guess}}}')
    search_resp=$(curl -s -X POST "http://localhost:3004/api/databases/$LOOKUP_DATABASE_ID/query" -H 'Content-Type: application/json' -d "$query_json" || true)

    # Prefer exact (case-insensitive) match on the joined title text; else take first result
    match_id=$(echo "$search_resp" | jq -r --arg tp "$title_prop" --arg guess "$title_guess" '
      (.results // [])
      | map({id: .id, title: ((.properties[$tp].title // []) | map(.plain_text) | join(""))})
      | .[]
      | select((.title | ascii_downcase) == ($guess | ascii_downcase))
      | .id' | head -n 1)

    if [[ -z "$match_id" || "$match_id" == "null" ]]; then
      match_id=$(echo "$search_resp" | jq -r '.results[0].id // empty' | head -n 1)
    fi

    if [[ -n "$match_id" ]]; then
      page_id="$match_id"
      echo "  🔎 Auto-lookup resolved Page ID: $page_id (title guess: '$title_guess')" | tee -a "$LOG_FILE"
    else
      echo "  ⚠️  Auto-lookup failed for title guess: '$title_guess' — skipping" | tee -a "$LOG_FILE"
      skipped=$((skipped+1))
      continue
    fi
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
          # Move failing page to patch-unsuccessful for later investigation
          mv "$html_file" "$UNSUCCESSFUL_DIR/" 2>/dev/null || true
          echo "  🚫 Moved to patch-unsuccessful/ (post-PATCH validation failed)" | tee -a "$LOG_FILE"
          unsuccessful_moved=$((unsuccessful_moved+1))
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
        # Capture body details for diagnostics
        if [[ -n "$patch_body" ]]; then
          echo "     ↳ Response snippet:" | tee -a "$LOG_FILE"
          echo "$patch_body" | head -n 20 | sed 's/^/        /' | tee -a "$LOG_FILE"
        fi

        # Detect 'page not found' / deleted page scenarios
        body_lower=$(echo "$patch_body" | tr 'A-Z' 'a-z')
        if [[ "$patch_http_code" == "404" ]] || \
           echo "$body_lower" | grep -qi 'object_not_found' || \
           echo "$body_lower" | grep -qi 'could not find block' || \
           echo "$body_lower" | grep -qi 'page not found'; then
          echo "     ↳ Classification: page-not-found / deleted / integration access revoked" | tee -a "$LOG_FILE"
          echo "     ↳ Common causes:" | tee -a "$LOG_FILE"
          echo "        • Page manually deleted in Notion UI" | tee -a "$LOG_FILE"
          echo "        • Page moved to another workspace or database not shared with integration" | tee -a "$LOG_FILE"
          echo "        • Integration lost access (sharing or token permissions changed)" | tee -a "$LOG_FILE"
          echo "        • Stale ID: file references old page ID after recreation" | tee -a "$LOG_FILE"
          echo "        • Hyphen-stripped vs hyphenated ID mismatch (ensure canonical 32-char UUID)" | tee -a "$LOG_FILE"
          mv "$html_file" "$PAGE_NOT_FOUND_DIR/" 2>/dev/null || true
          echo "  🚫 Moved to page-not-found/ (irrecoverable for PATCH)" | tee -a "$LOG_FILE"
          page_not_found=$((page_not_found+1))
        else
          echo "     ↳ Classification: generic HTTP failure" | tee -a "$LOG_FILE"
          echo "     ↳ Common causes:" | tee -a "$LOG_FILE"
          echo "        • Network interruption or proxy server restart mid-request" | tee -a "$LOG_FILE"
          echo "        • Notion API transient outage / 5xx response" | tee -a "$LOG_FILE"
          echo "        • Rate limit spike beyond retry logic (429)" | tee -a "$LOG_FILE"
          echo "        • Oversized payload hitting internal timeout" | tee -a "$LOG_FILE"
          echo "        • Content mutation edge-case causing validation to abort early" | tee -a "$LOG_FILE"
          echo "        • Unexpected schema issue (properties removed or renamed)" | tee -a "$LOG_FILE"
          # Attempt automatic retry for transient generic HTTP failures
          # Criteria: HTTP 5xx, 429, or body contains common transient signals (timeout, ECONNRESET)
          body_lower=$(echo "$patch_body" | tr 'A-Z' 'a-z')
          is_transient=0
          if [[ "$patch_http_code" =~ ^5 ]] || [[ "$patch_http_code" == "429" ]] || \
             echo "$body_lower" | grep -qi 'timeout' || \
             echo "$body_lower" | grep -qi 'econnreset' || \
             echo "$body_lower" | grep -qi 'temporarily unavailable' || \
             echo "$body_lower" | grep -qi 'server error'; then
             is_transient=1
          fi

          if [[ $is_transient -eq 1 && $MAX_GENERIC_RETRIES -gt 0 ]]; then
            generic_attempt=1
            while [[ $generic_attempt -le $MAX_GENERIC_RETRIES ]]; do
              retried_generic=$((retried_generic+1))
              retry_delay=$(( GENERIC_RETRY_BASE_DELAY * 2 ** (generic_attempt - 1) ))
              echo "     ↳ [RETRY] Transient failure detected (HTTP $patch_http_code). Attempt $generic_attempt/$MAX_GENERIC_RETRIES after ${retry_delay}s" | tee -a "$LOG_FILE"
              sleep $retry_delay
              # Re-run PATCH synchronously (simplified; no progress loop)
              retry_temp="/tmp/patch-retry-response-$$-$total-attempt-$generic_attempt.txt"
              curl -s -m "$manual_timeout" -w "\n%{http_code}" -X PATCH "$API_URL/$page_id" \
                -H "Content-Type: application/json" \
                -d "{\"title\":\"$title\",\"contentHtml\":$(echo "$content" | jq -Rs .),\"url\":\"https://docs.servicenow.com\"}" > "$retry_temp" 2>&1
              retry_http_code=$(tail -n1 "$retry_temp")
              retry_body=$(sed '$d' "$retry_temp")
              rm -f "$retry_temp"
              echo "        ↳ Retry HTTP: $retry_http_code" | tee -a "$LOG_FILE"
              if [[ "$retry_http_code" == "200" ]]; then
                retry_has_errors=$(echo "$retry_body" | jq -r '.validationResult.hasErrors // false')
                if [[ "$retry_has_errors" == "false" ]]; then
                  echo "        ✅ Retry succeeded (attempt $generic_attempt)." | tee -a "$LOG_FILE"
                  mv "$html_file" "$DST_DIR/"
                  echo "        📦 Moved to updated-pages/ (success after retry)" | tee -a "$LOG_FILE"
                  patched=$((patched+1))
                  successful_after_retry=$((successful_after_retry+1))
                  # Property refresh after retry success
                  clean_page_id=$(echo "$page_id" | tr -d '-')
                  echo "        🔄 Refresh properties for page: $clean_page_id" | tee -a "$LOG_FILE"
                  refresh_resp=$(curl -s -w "\n%{http_code}" -X POST "http://localhost:3004/api/validate" \
                    -H "Content-Type: application/json" \
                    -d "{\"pageIds\":[\"$clean_page_id\"]}" 2>&1 || echo -e "\n000")
                  refresh_http=$(echo "$refresh_resp" | tail -n1)
                  refresh_body=$(echo "$refresh_resp" | sed '$d')
                  if [[ "$refresh_http" == "200" ]]; then
                    updated=$(echo "$refresh_body" | jq -r '.data.summary.updated // 0' 2>/dev/null || echo 0)
                    cleared=$(echo "$refresh_body" | jq -r '.data.summary.errorsCleared // 0' 2>/dev/null || echo 0)
                    failed_prop=$(echo "$refresh_body" | jq -r '.data.summary.failed // 0' 2>/dev/null || echo 0)
                    echo "           ↳ Property refresh: updated=$updated errorsCleared=$cleared failed=$failed_prop" | tee -a "$LOG_FILE"
                  else
                    echo "           ↳ [WARN] Property refresh HTTP $refresh_http" | tee -a "$LOG_FILE"
                  fi
                  # Mark retry loop as completed successfully
                  is_transient=0
                  break
                else
                  echo "        ❌ Retry attempt $generic_attempt validation failed (HTTP 200)." | tee -a "$LOG_FILE"
                fi
              else
                echo "        ❌ Retry attempt $generic_attempt HTTP $retry_http_code" | tee -a "$LOG_FILE"
              fi
              generic_attempt=$((generic_attempt+1))
            done
          fi

          if [[ $is_transient -eq 1 ]]; then
            # All retries exhausted or not transient → classify unsuccessful
            failed_patch=$((failed_patch+1))
            mv "$html_file" "$UNSUCCESSFUL_DIR/" 2>/dev/null || true
            echo "  🚫 Moved to patch-unsuccessful/ (PATCH HTTP error after retries)" | tee -a "$LOG_FILE"
            unsuccessful_moved=$((unsuccessful_moved+1))
          elif [[ $is_transient -eq 0 && "$patch_http_code" != "200" ]]; then
            # Already handled success-after-retry; no further action needed if success
            :
          fi
        fi
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
echo "Moved to patch-unsuccessful: $unsuccessful_moved" | tee -a "$LOG_FILE"
echo "Moved to page-not-found: $page_not_found" | tee -a "$LOG_FILE"
echo "Timeouts: $timeouts" | tee -a "$LOG_FILE"
echo "Generic retries attempted: $retried_generic" | tee -a "$LOG_FILE"
echo "Successful after retry: $successful_after_retry" | tee -a "$LOG_FILE"
echo "Skipped: $skipped" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Post-batch archival of updated pages older than ARCHIVE_DAYS (default 3)
ARCHIVE_DAYS="${ARCHIVE_DAYS:-3}"
ARCHIVED_COUNT=0
ARCHIVE_THRESHOLD_SECONDS=$(( ARCHIVE_DAYS * 86400 ))
NOW_EPOCH=$(date +%s)

if [[ -d "$DST_DIR" ]]; then
  echo "" | tee -a "$LOG_FILE"
  echo "[ARCHIVE] Scanning $DST_DIR for files older than $ARCHIVE_DAYS day(s)" | tee -a "$LOG_FILE"
  for f in "$DST_DIR"/*.html; do
    [[ -e "$f" ]] || continue
    # Portable mtime retrieval (macOS vs Linux)
    if stat -f %m "$f" >/dev/null 2>&1; then
      MTIME=$(stat -f %m "$f")
    else
      MTIME=$(stat -c %Y "$f")
    fi
    AGE=$(( NOW_EPOCH - MTIME ))
    if (( AGE > ARCHIVE_THRESHOLD_SECONDS )); then
      mv "$f" "$UPDATED_ARCHIVE_DIR/" 2>/dev/null || true
      ARCHIVED_COUNT=$(( ARCHIVED_COUNT + 1 ))
      echo "  ↳ Archived $(basename "$f") (age ${AGE}s)" | tee -a "$LOG_FILE"
    fi
  done
  if (( ARCHIVED_COUNT > 0 )); then
    echo "[ARCHIVE] Moved $ARCHIVED_COUNT file(s) to updated-archive" | tee -a "$LOG_FILE"
  else
    echo "[ARCHIVE] No files older than $ARCHIVE_DAYS day(s) to archive" | tee -a "$LOG_FILE"
  fi
fi


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

