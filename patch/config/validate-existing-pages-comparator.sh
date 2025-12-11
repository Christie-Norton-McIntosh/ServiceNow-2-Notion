#!/bin/bash
# validate-existing-pages-comparator.sh
# Standalone script to run completeness comparator validation on already-patched Notion pages
# This script is useful for validating pages that were created/updated before the comparator was available

set -e

# Configuration
SERVER_URL="${SERVER_URL:-http://localhost:3004}"
COVERAGE_THRESHOLD="${COVERAGE_THRESHOLD:-0.97}"
MAX_MISSING_SPANS="${MAX_MISSING_SPANS:-0}"
PAGES_LIST="${PAGES_LIST:-patch/pages/updated-pages}"
INCOMPLETE_DIR="patch/pages/incomplete-content"
COMPLETE_DIR="patch/pages/validated-complete"
LOG_DIR="patch/log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create directories if they don't exist
mkdir -p "$INCOMPLETE_DIR"
mkdir -p "$COMPLETE_DIR"
mkdir -p "$LOG_DIR"

# Log file
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_DIR/validate-existing-pages-$TIMESTAMP.log"

log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

log "${BLUE}========================================${NC}"
log "${BLUE}Completeness Comparator - Validation Only${NC}"
log "${BLUE}Validating Existing Pages${NC}"
log "${BLUE}========================================${NC}"
log ""
log "Configuration:"
log "  Server: $SERVER_URL"
log "  Coverage threshold: $(echo "$COVERAGE_THRESHOLD * 100" | bc)%"
log "  Max missing spans: $MAX_MISSING_SPANS"
log "  Pages directory: $PAGES_LIST"
log "  Log file: $LOG_FILE"
log ""

# Check if server is running
log "Checking server availability..."
if ! curl -s "${SERVER_URL}/api/compare/health" > /dev/null; then
    log "${RED}ERROR: Server not responding at ${SERVER_URL}${NC}"
    log "Please start the server with: npm start"
    exit 1
fi
log "${GREEN}✓ Server is running${NC}"
log ""

# Count HTML files
if [ ! -d "$PAGES_LIST" ]; then
    log "${RED}ERROR: Pages directory not found: $PAGES_LIST${NC}"
    exit 1
fi

TOTAL_FILES=$(find "$PAGES_LIST" -name "*.html" -type f | wc -l)
if [ "$TOTAL_FILES" -eq 0 ]; then
    log "${YELLOW}No HTML files found in $PAGES_LIST${NC}"
    exit 0
fi

log "Found $TOTAL_FILES HTML file(s) to validate"
log ""

# Counters
VALIDATED=0
COMPLETE=0
INCOMPLETE=0
FAILED=0

# Process each HTML file
find "$PAGES_LIST" -name "*.html" -type f | while read -r HTML_FILE; do
    FILENAME=$(basename "$HTML_FILE")
    VALIDATED=$((VALIDATED + 1))
    
    log "${BLUE}[$VALIDATED/$TOTAL_FILES] Processing: $FILENAME${NC}"
    
    # Extract Page ID from HTML comment
    PAGE_ID=$(grep -oP 'Page ID: \K[a-f0-9]{32}' "$HTML_FILE" | head -1)
    
    if [ -z "$PAGE_ID" ]; then
        log "${YELLOW}  ⚠ No Page ID found in file, skipping${NC}"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Remove hyphens from Page ID if present
    PAGE_ID=$(echo "$PAGE_ID" | tr -d '-')
    
    log "  Page ID: $PAGE_ID"
    
    # Extract source HTML content (everything after metadata comment block)
    SOURCE_HTML=$(sed -n '/^-->/,$ p' "$HTML_FILE" | tail -n +2)
    
    if [ -z "$SOURCE_HTML" ]; then
        log "${YELLOW}  ⚠ No content found in file, skipping${NC}"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Escape JSON for API call
    SOURCE_JSON=$(echo "$SOURCE_HTML" | jq -Rs .)
    
    # Run completeness comparison
    log "  Running completeness comparison..."
    
    RESPONSE=$(curl -s -X POST "${SERVER_URL}/api/compare/notion-page" \
        -H "Content-Type: application/json" \
        -d "{\"pageId\":\"$PAGE_ID\",\"srcText\":$SOURCE_JSON,\"options\":{\"minMissingSpanTokens\":40}}" \
        2>&1)
    
    if [ $? -ne 0 ]; then
        log "${RED}  ✗ API call failed${NC}"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Parse response
    COVERAGE=$(echo "$RESPONSE" | jq -r '.coverage // 0')
    MISSING_COUNT=$(echo "$RESPONSE" | jq -r '.missingSpans | length // 0')
    METHOD=$(echo "$RESPONSE" | jq -r '.method // "unknown"')
    
    if [ "$COVERAGE" = "null" ] || [ -z "$COVERAGE" ]; then
        log "${RED}  ✗ Failed to parse response${NC}"
        log "  Response: $RESPONSE"
        FAILED=$((FAILED + 1))
        continue
    fi
    
    # Convert coverage to percentage for display
    COVERAGE_PCT=$(echo "$COVERAGE * 100" | bc | cut -d. -f1)
    
    log "  Coverage: ${COVERAGE_PCT}% (method: $METHOD)"
    log "  Missing spans: $MISSING_COUNT"
    
    # Check thresholds
    IS_COMPLETE=$(echo "$COVERAGE >= $COVERAGE_THRESHOLD" | bc)
    HAS_TOO_MANY_MISSING=$(echo "$MISSING_COUNT > $MAX_MISSING_SPANS" | bc)
    
    if [ "$IS_COMPLETE" -eq 1 ] && [ "$HAS_TOO_MANY_MISSING" -eq 0 ]; then
        log "${GREEN}  ✓ COMPLETE - Content validation passed${NC}"
        COMPLETE=$((COMPLETE + 1))
        
        # Move to complete directory
        if [ ! -f "$COMPLETE_DIR/$FILENAME" ]; then
            cp "$HTML_FILE" "$COMPLETE_DIR/$FILENAME"
            log "  → Copied to $COMPLETE_DIR"
        fi
    else
        log "${YELLOW}  ⚠ INCOMPLETE - Missing content detected${NC}"
        INCOMPLETE=$((INCOMPLETE + 1))
        
        # Move to incomplete directory
        if [ ! -f "$INCOMPLETE_DIR/$FILENAME" ]; then
            cp "$HTML_FILE" "$INCOMPLETE_DIR/$FILENAME"
            log "  → Copied to $INCOMPLETE_DIR"
        fi
        
        # Get missing spans for logging
        MISSING_SPANS=$(echo "$RESPONSE" | jq -r '.missingSpans[]?.text' | head -3)
        if [ -n "$MISSING_SPANS" ]; then
            log "  Missing content (top 3):"
            echo "$MISSING_SPANS" | while read -r SPAN; do
                TRUNCATED=$(echo "$SPAN" | cut -c1-80)
                log "    - $TRUNCATED..."
            done
        fi
    fi
    
    # Now update Notion page properties
    log "  Updating Notion page properties..."
    
    UPDATE_RESPONSE=$(curl -s -X POST "${SERVER_URL}/api/compare/notion-db-row" \
        -H "Content-Type: application/json" \
        -d "{\"pageId\":\"$PAGE_ID\",\"srcText\":$SOURCE_JSON,\"options\":{\"minMissingSpanTokens\":40}}" \
        2>&1)
    
    if [ $? -eq 0 ] && echo "$UPDATE_RESPONSE" | jq -e '.updated' > /dev/null 2>&1; then
        log "${GREEN}  ✓ Properties updated in Notion${NC}"
    else
        log "${YELLOW}  ⚠ Failed to update properties${NC}"
    fi
    
    log ""
    
    # Rate limiting - wait 1 second between pages
    sleep 1
done

# Final summary
log "${BLUE}========================================${NC}"
log "${BLUE}Validation Complete${NC}"
log "${BLUE}========================================${NC}"
log ""
log "Results:"
log "  ${GREEN}Complete: $COMPLETE${NC}"
log "  ${YELLOW}Incomplete: $INCOMPLETE${NC}"
log "  ${RED}Failed: $FAILED${NC}"
log "  Total validated: $VALIDATED"
log ""
log "Files categorized:"
log "  Complete → $COMPLETE_DIR"
log "  Incomplete → $INCOMPLETE_DIR"
log ""
log "Log saved to: $LOG_FILE"
