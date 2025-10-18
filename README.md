# ServiceNow-2-Notion — Modular Project Overview, Cleanup & Changelog

## ✅ Cleanup Completed - October 13, 2025

__Current release: 9.2.1 (2025-10-18)__

The ServiceNow-2-Notion project has been successfully cleaned up after the modularization refactoring.

## 📁 Current Clean Project Structure

```
ServiceNow-2-Notion/
├── dist/                          # Built userscript
├── docs/                          # Project documentation
├── scripts/                       # Build and release scripts
├── src/                          # Frontend userscript source
├── server/                       # Backend proxy server
│   ├── config/                   # Configuration modules
│   ├── converters/               # Content conversion utilities
│   ├── orchestration/            # Block processing orchestration
│   ├── routes/                   # Express route handlers
│   ├── services/                 # Core business logic services
│   ├── utils/                    # Shared utility functions
│   ├── logs/                     # Recent debug logs (cleaned)
│   ├── martian-helper.cjs        # Markdown/HTML conversion
│   └── sn2n-proxy.cjs           # Main server entry point
├── backups/                      # Version and cleanup archives
└── [standard project files]     # package.json, README.md, etc.
```

## 🗂️ Files Archived

All obsolete files have been moved to `backups/modularization-cleanup-20251013/`:

### Obsolete Development Files:
- **Server backup files**: `sn2n-proxy.cjs.*backup*`
- **Debug tools**: `snippet-test.cjs`, `debug-structure.cjs`, `create-minimal-test.cjs`
- **Test utilities**: `dump-blocks.cjs`, `run-orchestrator.cjs`
- **Sample data**: `sample*.html`, `sample.json`, `test-*.html`
- **Old logs**: Various server and debug logs
- **Debug artifacts**: orchestrator-result.json, parsed-blocks.json, etc.

### Log Cleanup:
- Moved logs older than 24 hours to archive
- Kept recent debug logs for active development
- Reduced `server/logs/` from 200+ files to ~90 recent files

## ✨ Benefits of Cleanup

1. **Cleaner Structure**: Removed 50+ obsolete files from active workspace
2. **Better Navigation**: Clear separation between production code and archives
3. **Reduced Clutter**: Easier to find and work with current files
4. **Preserved History**: All cleaned files archived with documentation for recovery
5. **Improved Performance**: Faster file searches and reduced IDE overhead

## 🔄 Recovery Process

If any archived files are needed, they can be restored from:
- `backups/modularization-cleanup-20251013/`
- See the README.md in that directory for detailed file manifest

## 📋 Production-Ready Structure

The project now has a clean, maintainable structure optimized for:
- ✅ Modular architecture with clear separation of concerns
- ✅ Comprehensive JSDoc documentation
- ✅ Clean development workspace
- ✅ Archived obsolete files for safety
- ✅ Optimized for production deployment and future development

---

# ServiceNow-2-Notion Modular — Overview

A modular, ES6-based rewrite of the ServiceNow-2-Notion userscript that extracts content from ServiceNow pages and sends it to Notion.

## 🎯 Overview

This project transforms a large monolithic userscript (18,438 lines across 4 files) into a clean, modular ES6 codebase that can be bundled into a single Tampermonkey userscript using Rollup.

## ✨ Key Features

- **ServiceNow Content Extraction**: Automatically extracts documentation content from ServiceNow pages
- **Property Mapping**: Maps ServiceNow metadata to Notion database properties
- **Rich Content Support**: 
  - Tables with proper formatting
  - Code blocks with syntax highlighting
  - Videos (YouTube, Vimeo) embedded as video blocks
  - Images with captions
  - Callout boxes with proper styling
  - Definition terms and lists
- **Table Image Extraction** (v9.1.0+): Automatically extracts images from table cells and places them as separate blocks with placeholder text in cells (see [docs/table-image-extraction.md](docs/table-image-extraction.md))
- **Local Proxy Server**: Node.js server handles HTML-to-Notion conversion with full Cheerio DOM manipulation
- **Modular Architecture**: Clean ES6 modules bundled with Rollup for easy maintenance

## 📝 Changelog

See below for a complete history of changes and releases.

## 🏗️ Architecture

The modular architecture is organized into logical layers:

### 📁 Project Structure

...existing code...

## 🔧 Development

### Prerequisites
- Node.js (v16 or later)
- npm

### Setup
1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Development build:**
   ```bash
   npm run build
   ```
3. **Watch mode for development:**
   ```bash
   npm run dev
   ```
4. **Production build (minified):**
   ```bash
   npm run build:prod
   ```

### Available Scripts
- `npm run build` - Build development version
- `npm run build:prod` - Build production version (minified)
- `npm run dev` - Watch mode for development
- `npm run watch` - Alias for dev mode
- `npm run clean` - Remove dist directory

## 🔁 Auto-update (GitHub Actions)

This repository includes a GitHub Actions workflow that automatically builds the userscript and updates the `dist/ServiceNow-2-Notion.user.js` file on pushes to `main`.

...existing code...

## 🧩 Module Overview

...existing code...

## 🚀 Usage

...existing code...

## 🔄 Migration from Monolithic Version

...existing code...

## 📦 Build Process

...existing code...

## 🐛 Debugging

...existing code...

## 📈 Version History & Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.2.1] - 2025-10-18

### Added
- Repository housekeeping: bumped version to 9.2.1, created versioned backup archive, updated docs and test matrix.

### Fixed
- Prevented deduplication of list items so identical list entries are preserved across different lists.
- Structural fix to nest HTML list elements under paragraph blocks so Notion restarts numbered lists without dividers.


## [9.0.0] - 2025-10-13

### Changed
- **Dynamic Version Management**: Rollup build system now reads the version directly from `package.json` and injects it into the userscript header, runtime constant, and window.BUILD_VERSION for robust version tracking.
- **PROVIDER_VERSION Fallback**: The userscript now uses a runtime-injected `window.BUILD_VERSION` with a fallback to the build version string, ensuring all modules reference the correct version.
- **Comprehensive Version Sync**: All production files, including `package.json`, `server/package.json`, `src/config.js`, and the generated userscript, now reference version 9.0.0.
- **Backup System Updated**: Created a new backup archive for 9.0.0 in `backups/backup-9.0.0-20251013-171551/` with all updated files.
- **Build Process Improvements**: Fixed template string interpolation in Rollup config and userscript header to ensure future version bumps are automatic and error-free.
- **Documentation Updated**: Project structure and changelog now reflect the modularization and version management improvements.

### Fixed
- Userscript header and runtime constants previously showed outdated versions due to static string references and build system issues. Now all version references are dynamically injected and correct.
- Eliminated manual version update steps—future releases only require bumping `package.json` and rebuilding.

### Notes
- If you see an outdated version in Tampermonkey, clear your browser cache or reload the userscript to ensure the latest build is loaded.
- All version management logic is now centralized in `rollup.config.js` and `src/config.js` for maintainability.
- The backup system ensures recovery of any previous version in case of build or deployment issues.

## [8.2.0] - 2025-10-07
...existing code...
## [8.1.0] - 2025-10-05
...existing code...
## [8.0.0] - 2025-10-03
...existing code...

## 🤝 Contributing

...existing code...

## 📄 License

...existing code...
