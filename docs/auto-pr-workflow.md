# Auto PR Workflow

This project uses an automated PR workflow to track all changes while maintaining a clean, automated development process.

## How It Works

### 1. Automated Branches
When builds or automated changes occur, they're committed to branches following the pattern:
```
auto/build-v{version}-{timestamp}
auto/docs-{description}-{timestamp}
auto/{feature}-{timestamp}
```

### 2. GitHub Actions Auto-PR
When a branch matching `auto/**` is pushed:
1. GitHub Actions automatically creates a PR to `main`
2. The PR is labeled with `automated` and `auto-merge`
3. The PR is immediately auto-merged (squash merge)
4. The branch is automatically deleted

### 3. Benefits
- **Change tracking**: Every change has a PR with full diff visibility
- **History preservation**: PRs provide a clear audit trail
- **No manual intervention**: Everything is automatic
- **Clean repo**: Branches are auto-deleted after merge

## Usage

### For Build Scripts
The `post-build-pr.cjs` script automatically:
1. Creates a branch like `auto/build-v9.2.25-2025-10-25T12-30-00`
2. Commits the build artifacts
3. Pushes to trigger PR creation
4. Returns to `main` branch

To use PR mode for builds:
```bash
# Option 1: Use the PR-enabled script directly
node scripts/post-build-pr.cjs

# Option 2: Update package.json to use PR mode by default
"build": "node scripts/bump-version.cjs && rollup -c && node scripts/post-build-pr.cjs"
```

### For Manual Commits
Instead of committing directly to `main`, create an `auto/*` branch:

```bash
# Create branch
git checkout -b auto/docs-module-guide-$(date +%Y%m%d-%H%M%S)

# Make your changes and commit
git add docs/module-guide.md
git commit -m "docs: add consolidated module guide"

# Push to trigger PR
git push origin HEAD

# Return to main
git checkout main
```

GitHub Actions will:
- ✅ Create PR automatically
- ✅ Auto-merge immediately
- ✅ Delete the branch
- ✅ Track in PR history

### Helper Script (Optional)
Create a helper for quick auto-PR commits:

```bash
# scripts/auto-commit.sh
#!/bin/bash
BRANCH="auto/$(basename $(pwd))-$(date +%Y%m%d-%H%M%S)"
git checkout -b "$BRANCH"
git add .
git commit -m "${1:-chore: automated commit}"
git push origin "$BRANCH"
git checkout main
```

Usage:
```bash
chmod +x scripts/auto-commit.sh
./scripts/auto-commit.sh "docs: add new guide"
```

## Configuration

### GitHub Actions Workflow
Location: `.github/workflows/auto-pr-merge.yml`

Key settings:
- Trigger: `push` to `auto/**` branches
- Permissions: `contents: write`, `pull-requests: write`
- Merge strategy: Squash merge
- Branch deletion: Automatic

### Updating Scripts
To make all builds use PR mode by default:

```json
// package.json
{
  "scripts": {
    "build": "node scripts/bump-version.cjs && rollup -c && node scripts/post-build-pr.cjs",
    "build:prod": "node scripts/bump-version.cjs && NODE_ENV=production rollup -c && node scripts/post-build-pr.cjs"
  }
}
```

Keep the old direct-push script for emergencies:
```json
{
  "scripts": {
    "build:direct": "node scripts/bump-version.cjs && rollup -c && node scripts/post-build.cjs"
  }
}
```

## Monitoring

Track PR creation and merges:
- GitHub Actions: https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/actions
- Pull Requests: https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/pulls?q=is%3Apr+label%3Aautomated
- Closed PRs (history): https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/pulls?q=is%3Apr+is%3Aclosed+label%3Aautomated

## Troubleshooting

### PR Not Auto-Merging
If a PR doesn't auto-merge, check:
1. Branch protection rules (should allow auto-merge)
2. GitHub Actions permissions in repo settings
3. Workflow logs for errors

### Manual Merge Needed
If auto-merge fails, the workflow attempts a manual merge as fallback. If both fail, merge manually:
```bash
gh pr merge <PR_NUMBER> --squash --delete-branch
```

### Revert to Direct Push
To disable PR workflow temporarily:
```bash
# Use the original post-build script
npm run build:direct

# Or modify package.json back to:
"build": "... && node scripts/post-build.cjs"
```

## Branch Protection (Optional)

For additional safety, configure branch protection on `main`:
1. Go to Settings → Branches → Add rule
2. Branch name pattern: `main`
3. Enable:
   - ✅ Require pull request before merging
   - ✅ Allow auto-merge
   - ❌ Don't require approvals (or set to 0)
4. Save changes

This ensures all changes go through PRs while still allowing auto-merge.
