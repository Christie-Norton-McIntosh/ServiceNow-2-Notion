#!/usr/bin/env node

/**
 * Post-Build Script (PR Mode)
 * 
 * Automatically creates a branch, commits the build, and pushes to trigger PR creation.
 * GitHub Actions will automatically create and merge the PR.
 * 
 * Usage: Called automatically after npm run build
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, { 
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options 
    });
  } catch (error) {
    if (!options.ignoreError) {
      throw error;
    }
    return '';
  }
}

async function main() {
  log('\n🚀 Post-Build: Committing and creating PR...', 'cyan');

  // Get package.json to read version
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  log(`📦 Version: ${version}`, 'blue');

  // Check if dist file exists
  const distPath = path.join(__dirname, '..', 'dist', 'ServiceNow-2-Notion.user.js');
  if (!fs.existsSync(distPath)) {
    log('❌ Error: dist/ServiceNow-2-Notion.user.js not found!', 'red');
    process.exit(1);
  }

  // Check if there are changes to commit
  const status = exec('git status --porcelain', { silent: true });
  
  if (!status.trim()) {
    log('✅ No changes to commit', 'green');
    return;
  }

  log('📝 Changes detected:', 'yellow');
  console.log(status);

  // Create a branch name with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const branchName = `auto/build-v${version}-${timestamp}`;
  
  log(`\n🌿 Creating branch: ${branchName}`, 'blue');
  
  // Ensure we're on main and up to date
  const currentBranch = exec('git branch --show-current', { silent: true }).trim();
  
  if (currentBranch !== 'main') {
    log(`⚠️  Currently on ${currentBranch}, switching to main first...`, 'yellow');
    exec('git checkout main');
    exec('git pull origin main', { ignoreError: true });
  }
  
  // Create and checkout new branch
  exec(`git checkout -b ${branchName}`);

  // Stage the dist file and package.json
  log('\n📌 Staging files...', 'blue');
  exec('git add dist/ServiceNow-2-Notion.user.js package.json package-lock.json');

  // Check if there are staged changes
  const stagedChanges = exec('git diff --cached --name-only', { silent: true });
  
  if (!stagedChanges.trim()) {
    log('✅ No staged changes to commit', 'green');
    // Clean up branch
    exec('git checkout main');
    exec(`git branch -D ${branchName}`, { ignoreError: true });
    return;
  }

  log('📦 Staged files:', 'blue');
  console.log(stagedChanges);

  // Commit with version number
  const commitMessage = `chore: build v${version} userscript`;
  log(`\n💾 Committing: "${commitMessage}"`, 'blue');
  exec(`git commit -m "${commitMessage}"`);

  // Push to remote (this will trigger GitHub Actions to create PR)
  log('\n🔄 Pushing to remote to trigger PR creation...', 'blue');
  try {
    exec(`git push origin ${branchName}`);
    log(`✅ Successfully pushed to ${branchName}`, 'green');
    log(`\n🎯 GitHub Actions will now:`, 'cyan');
    log(`   1. Create a PR from ${branchName} to main`, 'cyan');
    log(`   2. Auto-merge the PR`, 'cyan');
    log(`   3. Delete the branch`, 'cyan');
    log(`\n📊 Track progress at: https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/actions`, 'blue');
  } catch (error) {
    log('⚠️  Warning: Could not push to remote.', 'yellow');
    log(`   You may need to push manually: git push origin ${branchName}`, 'yellow');
    // Don't exit, let user handle it
  }

  // Return to main branch
  log('\n↩️  Returning to main branch...', 'blue');
  exec('git checkout main');

  log('\n✨ Post-build complete! PR will be auto-created and merged.', 'green');
}

// Run the script
main().catch(error => {
  log(`\n❌ Post-build failed: ${error.message}`, 'red');
  // Try to return to main on error
  try {
    exec('git checkout main', { silent: true });
  } catch {}
  process.exit(1);
});
