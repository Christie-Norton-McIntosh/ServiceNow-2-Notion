# Release Notes - Version 11.0.0

**Release Date**: November 9, 2025  
**Version**: 11.0.0  
**Branch**: build-v10.0.29  
**Type**: Major Release

---

## 🎉 Major Version Milestone

Version 11.0.0 represents a significant milestone in the ServiceNow-2-Notion project, consolidating all fixes and improvements from the v10.x series into a stable, production-ready release.

## 🚀 What's New in v11.0.0

### Major Features

#### 1. **Intelligent Navigation Retry System** 🔄
- **Auto-retry failed navigation** up to 2 times before stopping
- **Smart duplicate detection** distinguishes navigation failures from true duplicates
- **End-of-book confirmation** prevents premature stops
- **Detailed feedback** with progress indicators and status messages

**Benefits**:
- ✅ No more premature AutoExtract stops on temporary navigation issues
- ✅ Handles transient ServiceNow page load delays gracefully
- ✅ Maintains sequential page order during retries
- ✅ Better user control with confirmation dialogs

#### 2. **Comprehensive Rate Limit Protection** 🚦
- **Server-side exponential backoff** (5 retry attempts, up to 60s wait)
- **Client-side pause and retry** (60s cooldown with automatic retry)
- **Failed pages tracking** with persistent storage
- **Detailed completion summary** showing success/failure breakdown

**Benefits**:
- ✅ No content loss during Notion API rate limiting
- ✅ Automatic recovery without manual intervention
- ✅ Failed pages can be manually retried later
- ✅ Transparent reporting of rate limit hits

#### 3. **Enhanced Content Extraction** 📄
Five critical validation fixes ensure complete content capture:

**Issue #1: Standalone Images** 🖼️
- Fixed standalone `<img>` tags not being extracted
- Added external URL fallback for test environments
- Comprehensive diagnostic logging

**Issue #2: Table Duplication** 📊
- Added diagnostics to detect and prevent table duplication
- Enhanced table processing tracking
- Single table now correctly converts to single block

**Issue #3: Deeply Nested Tables** 🔗
- Recursive block detection in nested lists (3+ levels)
- Tables in `<ul>` and `<ol>` structures now extracted correctly
- Wrapper div processing enhanced

**Issue #4: DataTables Wrapper Nesting** 📦
- Multi-pass unwrapping handles complex nested wrappers
- Supports `dataTables_wrapper`, `zDocsFilterTableDiv`, etc.
- Up to 10 passes to unwrap deeply nested structures

**Issue #5: Callouts in Lists** 💡
- Block-level children (`<div class='note'>`) in `<li>` now processed
- Recursive search inside wrapper divs
- Maintains proper callout formatting and color

### Technical Improvements

#### Code Quality
- **Modular architecture** with clear separation of concerns
- **Comprehensive error handling** at all levels
- **Detailed debug logging** with bracketed keywords for filtering
- **Type-safe globals** with proper fallbacks

#### Performance
- **Optimized Cheerio parsing** with multiple unwrapping passes
- **Efficient DOM iteration** using `Array.from()` to prevent skipped nodes
- **Placeholder marker system** preserves newlines during normalization
- **Batch processing** respects Notion's 100-block limit

#### Documentation
- **RATE_LIMIT_PROTECTION.md** - Comprehensive rate limit guide
- **Copilot instructions** updated with latest patterns
- **Backup system** with versioned snapshots
- **Detailed commit messages** following conventional commits

---

## 📋 Complete Feature List

### AutoExtract
- ✅ Multi-page sequential extraction
- ✅ Navigation retry with failure detection
- ✅ Duplicate URL detection (smart vs simple)
- ✅ Content hash comparison to detect identical pages
- ✅ Rate limit handling with automatic retry
- ✅ Failed pages tracking and reporting
- ✅ End-of-book confirmation dialog
- ✅ Progress indicators and status messages
- ✅ State persistence across page reloads

### Content Extraction
- ✅ Headings (H1-H6)
- ✅ Paragraphs with rich text formatting
- ✅ Tables with thead/tbody structure
- ✅ Nested lists (bulleted and numbered, 2+ levels)
- ✅ Code blocks with syntax detection
- ✅ Images (inline, figures, standalone)
- ✅ Callouts/notes with color mapping
- ✅ Video iframe detection
- ✅ Technical identifiers (UIControl, keyword, parmname, codeph)

### Notion Integration
- ✅ Property mapping with type conversion
- ✅ Database selection and search
- ✅ Icon and cover image support
- ✅ Deep nesting via marker orchestration
- ✅ Block deduplication
- ✅ Image upload to Notion file storage
- ✅ URL normalization for ServiceNow links
- ✅ Validation and error reporting

### User Interface
- ✅ Draggable floating panel
- ✅ Database selector with search
- ✅ Property mapping modal
- ✅ Icon & cover image modal
- ✅ Advanced settings panel
- ✅ Toast notifications
- ✅ Progress overlays
- ✅ Status indicators on buttons

---

## 🔧 Breaking Changes

**None** - Version 11.0.0 is fully backward compatible with v10.x configurations.

### Migration Notes
- **No action required** - All v10.x features work identically in v11.0.0
- **Configuration preserved** - GM storage values maintained
- **Property mappings** - All saved mappings carry over
- **Database selections** - Previously selected databases remain

---

## 🐛 Bug Fixes

### Critical Fixes
1. **Navigation failures** no longer stop AutoExtract prematurely
2. **Rate limiting** doesn't cause content loss
3. **Standalone images** now extracted correctly
4. **Deeply nested tables** no longer lost
5. **Callouts in lists** extracted properly

### Minor Fixes
- Fixed placeholder stripping in rich text
- Enhanced HTML entity decoding
- Improved whitespace normalization
- Better error messages for API failures
- Corrected navigation verification logic

---

## 📊 Performance Improvements

- **Faster table processing** with optimized Cheerio unwrapping
- **Reduced API calls** through better batching
- **Lower memory usage** with streaming approach
- **Improved responsiveness** during AutoExtract

---

## 🧪 Testing

### Manual Testing Completed
- ✅ Single page extraction
- ✅ Multi-page AutoExtract (50+ pages)
- ✅ Navigation retry scenarios
- ✅ Rate limit handling
- ✅ Failed page recovery
- ✅ All validation fixes verified

### Test Coverage
- Unit tests for deduplication logic
- Smoke tests for proxy server
- Integration tests for HTML conversion
- Manual validation with real ServiceNow docs

---

## 📦 Installation

### New Installation

1. **Install Tampermonkey** extension in your browser
2. **Install userscript**: Click [here](https://raw.githubusercontent.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/main/dist/ServiceNow-2-Notion.user.js)
3. **Set up proxy server**:
   ```bash
   git clone https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion.git
   cd ServiceNow-2-Notion/server
   npm install
   # Create .env file with NOTION_TOKEN
   npm start
   ```

### Upgrade from v10.x

1. **Update userscript** in Tampermonkey (auto-updates enabled by default)
2. **Pull latest code**:
   ```bash
   git pull origin main
   cd server && npm install
   ```
3. **Restart proxy server**: `npm start`

---

## 🔮 What's Next

### Planned for v11.1
- [ ] Batch API calls for better performance
- [ ] Progress bar for AutoExtract
- [ ] Custom property mapping templates
- [ ] Export/import configuration

### Under Consideration
- [ ] Direct Notion API (no proxy needed)
- [ ] Chrome extension version
- [ ] Support for other documentation platforms
- [ ] Automated testing framework

---

## 🙏 Acknowledgments

Thank you to everyone who reported issues, tested features, and provided feedback during the v10.x development cycle. Your input has been invaluable in making v11.0.0 a solid, production-ready release.

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/issues)
- **Documentation**: See `/docs` folder
- **Discussions**: [GitHub Discussions](https://github.com/Christie-Norton-McIntosh/ServiceNow-2-Notion/discussions)

---

## 📝 Changelog Summary

For detailed commit history, see [CHANGELOG.md](./CHANGELOG.md).

### v11.0.0 Commits
- `e3105a6` - Navigation retry logic
- `0b50c7a` - Build v10.0.38 userscript
- `e8fcf5d` - Rate limit protection and validation fixes
- Previous v10.x commits consolidated

---

**Version**: 11.0.0  
**Release Date**: November 9, 2025  
**License**: MIT  
**Author**: Christie Norton-McIntosh
