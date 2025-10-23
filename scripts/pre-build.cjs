#!/usr/bin/env node

/**
 * Pre-Build Script
 * 
 * Removes the old dist file before building to ensure clean state.
 * This prevents issues with cached/stale builds in VS Code.
 * 
 * Usage: Called automatically before npm run build
 */

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

function main() {
  log('\n🧹 Pre-Build: Cleaning dist directory...', 'cyan');

  const distPath = path.join(__dirname, '..', 'dist', 'ServiceNow-2-Notion.user.js');
  
  if (fs.existsSync(distPath)) {
    try {
      fs.unlinkSync(distPath);
      log('✅ Removed old userscript', 'green');
    } catch (error) {
      log(`⚠️  Warning: Could not remove old file: ${error.message}`, 'yellow');
    }
  } else {
    log('ℹ️  No existing userscript to remove', 'blue');
  }

  log('✨ Pre-build complete!\n', 'green');
}

// Run the script
main();
