# ServiceNow-2-Notion Modular

A modular, ES6-based rewrite of the ServiceNow-2-Notion userscript that extracts content from ServiceNow pages and sends it to Notion.

## 🎯 Overview

This project transforms a large monolithic userscript (18,438 lines across 4 files) into a clean, modular ES6 codebase that can be bundled into a single Tampermonkey userscript using Rollup.

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a complete history of changes and releases.

## 🏗️ Architecture

The modular architecture is organized into logical layers:

### 📁 Project Structure

```
ServiceNow-2-Notion/
├── src/
│   ├── main.js                     # Main entry point and app orchestration
│   ├── config.js                   # Configuration constants and utilities
│   ├── ui/                         # UI Components
│   │   ├── overlay-progress.js     # Progress overlay for operations
│   │   ├── property-mapping-modal.js # Database property mapping UI
│   │   ├── advanced-settings-modal.js # Settings configuration UI
│   │   ├── icon-cover-modal.js     # Image selection UI (icons/covers)
│   │   └── utils.js                # Common UI utilities
│   ├── content/                    # Content Processing
│   │   ├── metadata-extractor.js  # ServiceNow metadata extraction
│   │   ├── content-extractor.js   # HTML content extraction
│   │   └── content-utils.js        # Content analysis utilities
│   └── api/                        # API Communication
│       ├── workflow-api.js         # Universal Workflow Module integration
│       ├── proxy-api.js            # M2N proxy server communication
│       └── database-api.js         # Notion database operations
├── dist/
│   └── ServiceNow-2-Notion.user.js # Generated Tampermonkey userscript
├── package.json
├── rollup.config.js
└── README.md
```

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

- Workflow: `.github/workflows/auto-build-dist.yml`
- What it does: checks out the repo, installs Node dependencies, runs `npm run build`, and commits `dist/ServiceNow-2-Notion.user.js` back to the `main` branch if the generated file changed.

Tampermonkey uses the `@updateURL` directive in the userscript header (pointing to the raw file on GitHub). With this workflow enabled, the raw URL will be updated when the workflow commits the built userscript, allowing Tampermonkey to fetch updates automatically.

Notes:

- The workflow commits using the repository token; ensure branch protections allow the workflow to push if you use protected branches.
- The workflow commits with `[skip ci]` in the message to avoid triggering CI loops.

## 🧩 Module Overview

### Core Configuration (`src/config.js`)

- **Purpose**: Central configuration management
- **Exports**: Constants, default settings, utility functions
- **Key Features**:
  - Provider version and branding
  - Default Notion database configuration
  - Custom CSS selectors for ServiceNow
  - Configuration migration utilities

### UI Components (`src/ui/`)

#### Progress Overlay (`overlay-progress.js`)

- Self-contained progress UI for save operations
- Methods: `start()`, `setMessage()`, `setProgress()`, `done()`

#### Property Mapping Modal (`property-mapping-modal.js`)

- Dynamic database property mapping interface
- Handles database selection and field mapping
- Integrates with Notion API for schema fetching

#### Advanced Settings Modal (`advanced-settings-modal.js`)

- Configuration UI for workflow options
- Checkbox settings with GM storage persistence

#### Icon & Cover Modal (`icon-cover-modal.js`)

- Image selection interface with multiple sources
- Emoji picker, file upload, and Unsplash integration
- Tab-based UI for different image sources

#### UI Utilities (`utils.js`)

- Common UI helper functions
- Toast notifications, modal management
- Element creation and styling utilities

### Content Processing (`src/content/`)

#### Metadata Extractor (`metadata-extractor.js`)

- ServiceNow-specific metadata extraction
- Uses CSS selectors for structured data extraction
- Extracts titles, breadcrumbs, dates, authors, etc.

#### Content Extractor (`content-extractor.js`)

- HTML content extraction with iframe processing
- Multi-strategy content discovery
- Content cleaning and sanitization

#### Content Utils (`content-utils.js`)

- Text processing and analysis utilities
- Content normalization and section splitting
- Plain text extraction and content metrics

### API Communication (`src/api/`)

#### Workflow API (`workflow-api.js`)

- Integration with Universal Workflow Module
- Event-based cross-context communication
- Promise-based method calling interface

#### Proxy API (`proxy-api.js`)

- Direct communication with M2N proxy server
- Database schema fetching and page creation
- Unsplash image search and file uploads
- Health checking and status monitoring

#### Database API (`database-api.js`)

- Notion database operations and caching
- Property mapping application and validation
- Automatic mapping suggestions based on field names

## 🚀 Usage

### Installation

1. **Build the userscript:**

   ```bash
   npm run build
   ```

2. **Install in Tampermonkey:**
   - Open `dist/ServiceNow-2-Notion.user.js`
   - Copy the contents
   - Create new userscript in Tampermonkey
   - Paste and save

### Features

- **Dual Mode Operation**: Works with Universal Workflow Module or direct proxy
- **Dynamic Property Mapping**: Visual interface for mapping ServiceNow fields to Notion properties
- **Content Extraction**: Intelligent extraction of ServiceNow page content including iframes
- **Image Integration**: Support for icons and covers via Unsplash or file upload
- **Progress Tracking**: Real-time progress indication during save operations
- **Configuration Management**: Persistent settings with migration support

### Supported ServiceNow Pages

- Knowledge Base articles
- Incident records
- Change requests
- Service catalog items
- Custom forms and records

## 🔄 Migration from Monolithic Version

This modular version maintains full backward compatibility with the original userscript while providing these benefits:

- **Maintainability**: Clear separation of concerns across modules
- **Testability**: Individual modules can be unit tested
- **Extensibility**: Easy to add new features without affecting existing code
- **Bundle Optimization**: Tree-shaking eliminates unused code in production builds
- **Development Experience**: Better IDE support with proper ES6 modules

## 📦 Build Process

The build process uses Rollup to:

1. **Bundle ES6 modules** into a single file
2. **Add Tampermonkey header** with proper grants and metadata
3. **Optimize code** with tree-shaking in production mode
4. **Preserve debugging** information in development builds

### Rollup Configuration

- **Input**: `src/main.js` (entry point)
- **Output**: `dist/ServiceNow-2-Notion.user.js` (IIFE format)
- **Plugins**: Node resolve, CommonJS, Terser (production only)
- **Header**: Automatic Tampermonkey userscript header injection

## 🐛 Debugging

Enable debug mode by setting `debugMode: true` in the advanced settings modal. This will:

- Show detailed console logging for all operations
- Display extraction progress and API communication
- Provide error details and stack traces
- Log configuration and mapping information

## 📈 Version History

- **v7.1.0**: Modular rewrite with ES6 modules and Rollup bundling
- **Previous versions**: Monolithic userscript architecture

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes to the appropriate modules in `src/`
4. Test with `npm run dev`
5. Build with `npm run build`
6. Submit pull request

## 📄 License

This project maintains the same license as the original ServiceNow-2-Notion userscript.
