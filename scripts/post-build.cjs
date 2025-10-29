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

  // Create branch, push, and create auto-merge PR
  log('\n🔄 Creating automated PR...', 'blue');
  try {
    const branchName = `build-v${version}`;
    const currentBranch = exec('git branch --show-current', { silent: true }).trim();
    
    // Check if we're already on a build branch
    if (currentBranch === branchName) {
      log(`✅ Already on branch ${branchName}`, 'blue');
    } else if (currentBranch !== 'main') {
      // If on another branch, just push normally
      log(`📍 On branch ${currentBranch}, pushing directly...`, 'yellow');
      exec(`git push origin ${currentBranch}`);
      log(`✅ Successfully pushed to ${currentBranch}`, 'green');
      log('\n✨ Post-build complete!', 'green');
      return;
    } else {
      // Create and checkout new branch from main
      log(`🌿 Creating branch: ${branchName}`, 'blue');
      exec(`git checkout -b ${branchName}`);
    }
    
    // Push branch to remote
    log(`📤 Pushing branch to remote...`, 'blue');
    exec(`git push -u origin ${branchName}`);
    
      // Create PR using GitHub CLI (gh) if available
      log(`🔀 Creating pull request...`, 'blue');
      try {
        const prTitle = `Build v${version} userscript`;
        const prBody = `Automated build for version ${version}\n\n**Changes:**\n- Updated dist/ServiceNow-2-Notion.user.js\n- Bumped version to ${version}\n\n---\n*This PR was created automatically by post-build script*`;
        
        // Create PR and capture full output
        const prOutput = exec(`gh pr create --base main --head ${branchName} --title "${prTitle}" --body "${prBody}" --assignee "@me"`, { silent: true });
        
        // Parse PR URL to get number
        const prUrlMatch = prOutput.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/(\d+)/);
        const prNumber = prUrlMatch ? prUrlMatch[1] : null;
        
        if (prNumber) {
          log(`✅ PR #${prNumber} created successfully`, 'green');
          
          // Create an issue for this build (for tracking/documentation)
          log(`📋 Creating tracking issue...`, 'blue');
          try {
            // Get recent commits for this version
            const recentCommits = exec('git log --oneline -5', { silent: true });
            const commitLines = recentCommits.trim().split('\n').slice(0, 5);
            const commitList = commitLines.map(line => `- ${line}`).join('\n');
            
            const issueTitle = `Build v${version} - Release Tracking`;
            const issueBody = `## Build v${version}\n\n**Release Date:** ${new Date().toISOString().split('T')[0]}\n**PR:** #${prNumber}\n\n### Recent Changes\n${commitList}\n\n### Files Modified\n- dist/ServiceNow-2-Notion.user.js\n- package.json\n\n---\n*This issue was created automatically by the build system for tracking purposes.*`;
            
            const issueOutput = exec(`gh issue create --title "${issueTitle}" --body "${issueBody}" --label "build,automated" --assignee "@me"`, { silent: true });
            const issueMatch = issueOutput.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/(\d+)/);
            const issueNumber = issueMatch ? issueMatch[1] : null;
            
            if (issueNumber) {
              log(`✅ Issue #${issueNumber} created for build tracking`, 'green');
              
              // Link the PR to the issue by commenting
              exec(`gh pr comment ${prNumber} --body "Tracked in issue #${issueNumber}"`, { silent: true, ignoreError: true });
              
              // Auto-close the issue since this is just for tracking
              exec(`gh issue close ${issueNumber} --comment "Build completed and merged successfully."`, { silent: true, ignoreError: true });
              log(`✅ Issue #${issueNumber} closed (build successful)`, 'green');
            }
          } catch (issueError) {
            log(`⚠️  Could not create tracking issue: ${issueError.message}`, 'yellow');
          }
          
          // Auto-merge the PR
          log(`🤖 Auto-merging PR #${prNumber}...`, 'blue');
          exec(`gh pr merge ${prNumber} --auto --squash --delete-branch`);
          log(`✅ PR #${prNumber} merged and branch deleted`, 'green');
          
          // Switch back to main and sync
          log(`🔙 Switching back to main...`, 'blue');
          exec('git checkout main');
          
          // Pull with rebase to handle squashed commit
          log(`🔄 Syncing with remote main...`, 'blue');
          exec('git pull --rebase origin main', { ignoreError: true });
          log(`✅ Synced with remote main`, 'green');
        } else {
          log(`⚠️  Could not determine PR number from output:`, 'yellow');
          log(prOutput.trim(), 'yellow');
        }
      } catch (ghError) {
        log(`⚠️  GitHub CLI not available or PR creation failed`, 'yellow');
        log(`   Install: brew install gh`, 'yellow');
        log(`   Or manually create PR from: ${branchName}`, 'yellow');
        log(`   Then run: git checkout main`, 'yellow');
      }  } catch (error) {
    log('⚠️  Warning: Could not create automated PR.', 'yellow');
    log(`   ${error.message}`, 'yellow');
  }

  log('\n✨ Post-build complete!', 'green');
}

// Run the script
main().catch(error => {
  log(`\n❌ Post-build failed: ${error.message}`, 'red');
  process.exit(1);
});
