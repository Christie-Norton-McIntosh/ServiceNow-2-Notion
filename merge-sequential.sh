#!/usr/bin/env bash
set -euo pipefail

REPO_REMOTE="origin"
BRANCHES=(
  "auto/setup-pr-workflow-20251025-135558"
  "build-v9.2.62"
  "build-v9.2.64"
  "build-v10.0.11"
  "build-v10.0.16"
  "build-v10.0.29"
  "build-v11.0.5"
  "build-v11.0.86"
  "copilot/add-text-completeness-comparator"
)

echo "Fetching from ${REPO_REMOTE}..."
git fetch "${REPO_REMOTE}" --prune

echo "Checking out main and resetting to ${REPO_REMOTE}/main..."
git checkout main
git reset --hard "${REPO_REMOTE}/main"

for br in "${BRANCHES[@]}"; do
  echo
  echo "----"
  echo "Merging branch: ${br} -> main"
  # Attempt a merge using remote branch as the merge source
  if git merge --no-ff --no-edit "${REPO_REMOTE}/${br}"; then
    echo "Merge succeeded for ${br}. Pushing main to ${REPO_REMOTE}..."
    git push "${REPO_REMOTE}" main
    echo "Pushed merge commit for ${br}."
  else
    echo "Conflict detected while merging ${br}."
    echo "Aborting merge and leaving local/main as before."
    git merge --abort || true
    echo "No changes were pushed to ${REPO_REMOTE}/main for ${br}."
    echo ""
    echo "To reproduce and resolve the conflict locally (do not abort):"
    echo "  git fetch ${REPO_REMOTE}"
    echo "  git checkout main"
    echo "  git reset --hard ${REPO_REMOTE}/main"
    echo "  git merge ${REPO_REMOTE}/${br}"
    echo "Resolve conflicts, then run:"
    echo "  git add <file(s)>"
    echo "  git commit"
    echo "  git push ${REPO_REMOTE} main"
    exit 2
  fi
done

echo
echo "All branches merged successfully."