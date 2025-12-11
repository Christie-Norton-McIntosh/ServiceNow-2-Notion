# ServiceNow-2-Notion — Modular Project Overview, Cleanup & Changelog

## ✅ Latest Release

__Current release: 11.0.0 (2025-11-09)__

**Major Release**: Intelligent navigation retry system, comprehensive rate limit protection, and 5 critical validation fixes. Production-ready with complete content extraction and enhanced error handling.

**Key Features**:
- 🔄 Auto-retry navigation failures (up to 2 attempts)
- 🚦 Rate limit protection with exponential backoff
- 📄 Complete content extraction (images, tables, callouts in lists)
- ✅ 5 validation fixes for edge cases
- 💾 Failed pages tracking and reporting

See [RELEASE_NOTES_11.0.0.md](./RELEASE_NOTES_11.0.0.md) for full details.

## 📁 Current Clean Project Structure

```
ServiceNow-2-Notion/
├── dist/                          # Built userscript
├── docs/                          # Project documentation
├── scripts/                       # Build and release scripts
├── src/                           # Frontend userscript source
├── server/                        # Backend proxy server
│   ├── config/                    # Configuration modules
│   ├── converters/                # Content conversion utilities
│   ├── orchestration/             # Block processing orchestration
│   ├── routes/                    # Express route handlers
│   ├── services/                  # Core business logic services
│   ├── utils/                     # Shared utility functions
│   ├── logs/                      # Recent debug logs (cleaned)
│   ├── martian-helper.cjs         # Markdown/HTML conversion
│   └── sn2n-proxy.cjs             # Main server entry point
├── tests/                         # Test scripts & fixture system
│   └── fixtures/                  # HTML fixtures (manual + auto-captured failures)
├── archived/                      # Archived historical & cleanup artifacts
│   └── cleanup-YYYY-MM-DD/        # Date-based cleanup snapshots
├── backups/                       # Versioned full project backups
└── [standard project files]       # package.json, README.md, etc.
```

## 🗂️ Archival & Cleanup

Recent cleanup (2025-11-09) moved obsolete & transient artifacts into `archived/cleanup-2025-11-09/` to reduce root clutter while preserving history.

### Latest Cleanup Snapshot (`archived/cleanup-2025-11-09/`)
- `docs/`: Historical point-in-time docs (older changelog slice, release notes, maintenance summary)
- `logs/`: One-off debug and server logs (`debug-richtext.log`, `debug-url-extract.log`, dated log folders, etc.)
- `workspace/`: Temporary working folders (`Smoke Test/`, `tmp/`) superseded by fixture/test system

Older modularization cleanup remains in `backups/modularization-cleanup-20251013/` for full recovery.

### Active vs Archived
- Active development now favors `tests/fixtures/` over `Smoke Test/` for reproducible conversion validation.
- Transient logs are no longer kept at root—prefer `server/logs/` and rotate or archive if large.

### Adding Future Archives
Create a new dated folder under `archived/` (e.g., `cleanup-2025-12-01/`) rather than modifying prior snapshots.

See `archived/cleanup-2025-11-09/ARCHIVE_INDEX.md` for detailed manifest and rationale.

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
- **🧠 Pattern Learning System** (v11.0.113+): Automatic capture of failing HTML patterns with auto-remediation, creating a self-learning feedback loop for continuous improvement
- **🧩 Text Completeness Comparator** (v11.0.205+): Validates that ServiceNow content is fully captured in Notion using canonicalization + LCS/Jaccard algorithms (see [docs/COMPLETENESS-COMPARATOR.md](docs/COMPLETENESS-COMPARATOR.md))

## 🧠 Smart Learning & Auto-Remediation (v11.0.113+)

The system now includes an intelligent pattern learning system that captures failing extraction patterns:

- **Auto-Remediation**: When AUDIT validation fails, automatically diagnoses the problem
- **Pattern Capture**: Stores failing HTML patterns as test fixtures for future comparison
- **Organized by Type**: Patterns stored by gap type (missing lists, missing tables, etc.)
- **Self-Learning**: Each failure becomes a test case for validating improvements
- **Management Tools**: View, analyze, and manage captured patterns with CLI tools

```bash
# View all captured patterns
node tools/manage-patterns.cjs

# Show statistics
node tools/manage-patterns.cjs --stats

# Clean old patterns (keep last 5)
node tools/manage-patterns.cjs --clean
```

See [docs/PATTERN-LEARNING.md](docs/PATTERN-LEARNING.md) for detailed documentation.

## 🧩 Text Completeness Comparator (v11.0.205+)

Validates that ServiceNow content is fully captured in Notion pages using advanced text comparison:

- **Canonicalization**: Normalizes text (Unicode NFKC, punctuation, whitespace) for consistent comparison
- **LCS Algorithm**: Computes exact coverage with missing text spans using dynamic programming
- **Jaccard Fallback**: Scalable order-insensitive comparison for very large content
- **Notion Integration**: Fetches page content, updates database properties, optional toggle append
- **REST API**: Three endpoints for different comparison scenarios

### Quick Start

```bash
# Start the server (includes comparator)
npm start

# Check comparator health
curl http://localhost:3004/api/compare/health

# Compare two text sections
curl -X POST http://localhost:3004/api/compare/section \
  -H "Content-Type: application/json" \
  -d '{
    "srcText": "Your ServiceNow content here",
    "dstText": "Your Notion content here"
  }'
```

### API Endpoints

- `GET /api/compare/health` - Health check with version info
- `POST /api/compare/section` - Compare two arbitrary text strings
- `POST /api/compare/notion-page` - Fetch and compare Notion page content
- `POST /api/compare/notion-db-row` - Compare and update database properties

### Configuration

Add to your `.env` file:

```bash
# Comparator thresholds
MAX_CELLS=50000000      # LCS DP guardrail: (n+1)*(m+1)
MIN_SPAN=40             # Min tokens to report a missing span
APPEND_TOGGLE=false     # Append missing spans toggle to page

# Optional: Bearer token for API authentication
# AUTH_TOKEN=your-secret-token
```

### Documentation

- **[Quick Start Guide](docs/COMPARATOR-QUICK-START.md)** - 5-minute setup and common use cases ⭐
- [Main Documentation](docs/COMPLETENESS-COMPARATOR.md) - Overview and features
- [API Reference](docs/API-COMPARATOR.md) - Endpoint details and examples
- [Architecture](docs/ARCHITECTURE-COMPARATOR.md) - Technical details and algorithms
- [Deployment Guide](docs/DEPLOYMENT-COMPARATOR.md) - Installation and configuration

## 📦 Installation

### Install from GitHub (Recommended - Auto-updates)

The easiest way to install and receive automatic updates:

1. **Install Tampermonkey** extension in your browser if you haven't already
2. **Click this link to install**: [ServiceNow-2-Notion.user.js](https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js)
3. Tampermonkey will prompt you to install the script - click **Install**
4. **Automatic Updates**: Tampermonkey will automatically check for and install updates from GitHub based on your Tampermonkey settings

### Manual Installation (Development)

If you're developing or testing local changes:

1. Clone this repository
2. Run `npm install` and `npm run build` to generate the userscript
3. In Tampermonkey, click the **+** button to create a new script
4. Copy the contents of `dist/ServiceNow-2-Notion.user.js` and paste it into the editor
5. Save the script

**Note**: With manual installation, you'll need to manually re-upload the userscript after each rebuild when you make changes.

## �📝 Changelog

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
