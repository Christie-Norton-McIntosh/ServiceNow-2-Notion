#!/usr/bin/env bash
set -euo pipefail

# Move specific updated pages back to pages-to-update based on a list of titles
# Usage: bash patch/config/move-back-from-updated-pages.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_DIR="$ROOT_DIR/patch/pages-to-update/updated-pages"
DST_DIR="$ROOT_DIR/patch/pages-to-update"
LOG_DIR="$DST_DIR/log"
mkdir -p "$LOG_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/move-back-$TS.log"

echo "[INFO] Source dir: $SRC_DIR" | tee -a "$LOG_FILE"
echo "[INFO] Dest dir:   $DST_DIR" | tee -a "$LOG_FILE"
echo "[INFO] Log file:   $LOG_FILE" | tee -a "$LOG_FILE"

slugify() {
  # Lowercase, remove apostrophes, replace non-alnum with hyphens, trim hyphens
  local s
  s=$(printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E "s/[’']//g" \
    | tr -d '`' \
    | sed -E "s/[^a-z0-9]+/-/g; s/^-+|-+$//g")
  printf '%s' "$s"
}

titles=(
"use the servicenow devops extension for azure devops and azu"
"Enable users to subscribe to the On-Call calendar"
"Analyze sentiments in Now Assist for IT Service Management (ITSM)"
"Ask questions about an incident by using the Now Assist panel"
"Generate a knowledge article from the Service Operations Workspace for ITSM and classic environment by using Now Assist"
"Explain the risk of a change request by using Now Assist for IT Service Management (ITSM)"
"Summarize a change request by using Now Assist for IT Service Management (ITSM)"
"IT Service Management AI agent collection Manage Microsoft 365 group members agentic workflow"
"IT Service Management AI agent collection Wrap-up and resolve incident agentic workflow"
"Customize a Now Assist for IT Service Management (ITSM) skill"
"Configure Now Assist for IT Service Management (ITSM)"
"Legacy: Incident SLA Management dashboard"
"Create an incident"
"Integrate Coaching With Learning with third-party learning management systems"
"Monitor schedule adherence of your agents"
"Analyze your staff alignment using Demand Forecast"
"Enable your teams to sign up for work shifts"
"Admin Console in Workforce Optimization for ITSM"
"Join a queue at the Walk-up Experience Tech Lounge"
"Configure daily schedules for Walk-up Experience appointment booking"
"Enabling AI Search in Issue Auto Resolution"
"Reusable ITSM Virtual Agent pre-built topic blocks"
"Digital Portfolio Management views"
"Work with Needs attention panels in Digital Portfolio Management"
"Check your device's health using Employee Center"
"Using Digital End-user Experience Self-service"
"DEX Score metrics calculation"
"View notifications"
"DEX Alerts"
"Install Agent Client Collector for DEX on macOS using a one-line installer"
"Release Quality dashboard"
"Investigate an alert that involves a change to config data"
"Compare two snapshots of a deployable"
"Compare snapshots from the same or different applications"
"Publish or unpublish a snapshot"
"Request to include a component to a component library"
"View the execution record for a policy run"
"View the results of snapshot validation"
"Compare changesets from the same or different CDM applications"
"Compare config data of two CDM applications"
"Map policies to a deployable"
"Preparing an application for config data upload"
"Uploading your config data"
"Create and update a deployable"
"Create a CDM application that is based on an existing service in the CMDB"
"Tool throttling"
"Create a DevOps tool integration"
"Configure user-created security tool"
"Add test results to change requests using test API"
"Onboard Veracode to DevOps Change Velocity - Service Catalog"
"Configure Azure DevOps for JFrog"
"Set up OAuth 2.0 Authorization Code for Bitbucket Cloud"
"Configure webhooks for Rally manually"
"Onboard Rally to DevOps Change Velocity — Classic"
"Onboard Rally to DevOps Change Velocity — Workspace"
"Onboard Jira to DevOps Change Velocity — Workspace"
"Argo CD integration with DevOps Change Velocity"
"Model an Azure pipeline in DevOps"
"Install DevOps Change Velocity"
"Improvement integration with other applications"
"Domain separation and Change Management"
"Change Management integration with ITOM Visibility"
"Define risk assessments"
"Add or modify risk and impact conditions"
"Applying CSDM guidelines to Change Management"
"Add a new change request type"
)

total=0
moved=0
not_found=0
skipped=0

shopt -s nullglob

for title in "${titles[@]}"; do
  [[ -z "$title" ]] && continue
  total=$((total+1))

  # Special-case: some titles contain prefixes like "Legacy:" — keep them in slug
  slug=$(slugify "$title")

  # Try several prefix lengths to handle filename truncation before timestamp
  found_matches=()
  for len in 60 55 50 45 40 35 30 25; do
    pref=${slug:0:$len}
    # Anchor on start of filename with the prefix and ensure .html extension
    for f in "$SRC_DIR"/"$pref"*.html; do
      [[ -e "$f" ]] || continue
      found_matches+=("$f")
    done
    [[ ${#found_matches[@]} -gt 0 ]] && break
  done

  # Fallback: loose substring search if no prefix matches
  if [[ ${#found_matches[@]} -eq 0 ]]; then
    slug_pattern="${slug//-/[-_]}"
    for f in "$SRC_DIR"/*.html; do
      base=$(basename "$f")
      if [[ "$base" == *"$slug_pattern"* ]]; then
        found_matches+=("$f")
      fi
    done
  fi

  if [[ ${#found_matches[@]} -eq 0 ]]; then
    echo "[MISS] No match for: $title (slug: $slug)" | tee -a "$LOG_FILE"
    not_found=$((not_found+1))
    continue
  fi

  # Move each matched file back
  for src in "${found_matches[@]}"; do
    base=$(basename "$src")
    dst="$DST_DIR/$base"
    if [[ -e "$dst" ]]; then
      echo "[SKIP] Already in destination: $base" | tee -a "$LOG_FILE"
      skipped=$((skipped+1))
      continue
    fi
    echo "[MOVE] $base -> pages-to-update/" | tee -a "$LOG_FILE"
    mv "$src" "$dst"
    moved=$((moved+1))
  done
done

echo "---" | tee -a "$LOG_FILE"
echo "[RESULT] Titles processed: $total" | tee -a "$LOG_FILE"
echo "[RESULT] Files moved:     $moved" | tee -a "$LOG_FILE"
echo "[RESULT] Not found:       $not_found" | tee -a "$LOG_FILE"
echo "[RESULT] Skipped (exists): $skipped" | tee -a "$LOG_FILE"
echo "[INFO] Log: $LOG_FILE"

exit 0
