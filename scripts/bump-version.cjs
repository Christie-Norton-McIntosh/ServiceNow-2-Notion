#!/usr/bin/env node

/**
 * Automatically increment patch version (0.0.1) before build
 * Usage: node scripts/bump-version.js
 */

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Parse current version
const versionParts = pkg.version.split('.').map(Number);
const [major, minor, patch] = versionParts;

// Increment patch version
const newVersion = `${major}.${minor}.${patch + 1}`;

// Update package.json
pkg.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

console.log(`✅ Version bumped: ${pkg.version.replace(newVersion, `${major}.${minor}.${patch}`)} → ${newVersion}`);
