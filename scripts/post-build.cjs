#!/usr/bin/env node

/**
 * Post-Build Script
 * 
 * Automatically commits and syncs the new userscript build to Git.
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
  log('\n🚀 Post-Build: Committing and syncing userscript...', 'cyan');

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

  // Stage the dist file and package.json
  log('\n📌 Staging files...', 'blue');
  exec('git add dist/ServiceNow-2-Notion.user.js package.json package-lock.json');

  // Check if there are staged changes
  const stagedChanges = exec('git diff --cached --name-only', { silent: true });
  
  if (!stagedChanges.trim()) {
    log('✅ No staged changes to commit', 'green');
    return;
  }

  log('📦 Staged files:', 'blue');
  console.log(stagedChanges);

  // Commit with version number
  const commitMessage = `chore: build v${version} userscript`;
  log(`\n💾 Committing: "${commitMessage}"`, 'blue');
  exec(`git commit -m "${commitMessage}"`);

  // Push to remote
  log('\n🔄 Pushing to remote...', 'blue');
  try {
    const currentBranch = exec('git branch --show-current', { silent: true }).trim();
    exec(`git push origin ${currentBranch}`);
    log(`✅ Successfully pushed to ${currentBranch}`, 'green');
  } catch (error) {
    log('⚠️  Warning: Could not push to remote. You may need to push manually.', 'yellow');
    log('   Run: git push', 'yellow');
  }

  log('\n✨ Post-build complete!', 'green');
}

// Run the script
main().catch(error => {
  log(`\n❌ Post-build failed: ${error.message}`, 'red');
  process.exit(1);
});
