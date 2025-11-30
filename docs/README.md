# ServiceNow-2-Notion Documentation Index

**Project**: ServiceNow-2-Notion  
**Current Version**: 9.2.1  
**Last Updated**: October 18, 2025

---

## 📚 Quick Navigation

| Category | Documents | Purpose |
|----------|-----------|---------|
| 🧪 [Testing](#testing-documentation) | 2 docs | Test scenarios and procedures |
| 📖 [Technical Reference](#technical-reference) | 3 docs | Implementation details and API reference |
| 🔧 [Fix History](#fix-history) | 2 docs | Bug fixes and solutions |
| 📦 [Archived](#archived-documentation) | 18 docs | Historical and superseded documentation |

---

## 🧪 Testing Documentation

### TESTING_SCENARIOS.md
**Purpose**: Comprehensive testing matrix for all features  
**Use When**: 
- Testing after code changes
- Verifying bug fixes
- Adding new features
- Pre-release validation

**Contains**:
- 10 core testing scenarios with URLs
- Test variations and edge cases
- Expected behavior descriptions
- Server log examples
- Status tracking (tested & working vs. needs work)

**Quick Start**: Use the test URL quick reference table at the bottom

---

### testing-table-images.md
**Purpose**: Detailed testing procedures for table image extraction  
**Use When**:
- Testing table-related changes
- Debugging image extraction issues
- Verifying placeholder logic

**Contains**:
- Step-by-step testing procedures
- Sample ServiceNow pages with tables
- Expected Notion output examples
- Troubleshooting tips

**Related**: `table-image-extraction.md` (technical implementation)

---

### FIXTURES_IMPLEMENTATION_SUMMARY.md
**Purpose**: Automated capture and regression testing with HTML fixtures
**Use When**:
- Investigating validation failures
- Reproducing conversion issues from saved HTML
- Running dryRun verification on historical pages

**Contains**:
- Auto-capture flow and metadata format
- Fixture runner usage (`tests/test-fixture.cjs`)
- Environment variables (`SN2N_SAVE_VALIDATION_FAILURES`, `SN2N_FIXTURES_DIR`)

**Related**: `server/utils/VALIDATION_README.md` (post-creation validation utility)

---

## 📖 Technical Reference

### patch-workflow.md
**Purpose**: Complete guide for PATCH operations and batch processing  
**Use When**:
- Updating existing Notion pages with corrected content
- Re-processing pages that failed validation
- Batch updating multiple pages

**Contains**:
- PATCH API endpoint documentation
- Batch processing script workflow
- Timeout configuration and troubleshooting
- Validation integration
- Known issues and solutions

**Audience**: Developers and operations performing page updates

---

### notion-blocks-reference.md
**Purpose**: Complete reference for Notion block types and API  
**Use When**:
- Implementing new block types
- Debugging block creation issues
- Understanding Notion API constraints

**Contains**:
- All Notion block types with examples
- Rich text formatting reference
- API limitations and workarounds
- Code examples for each block type

**Audience**: Developers working on server-side conversion

---

### table-image-extraction.md
**Purpose**: Technical documentation for table image handling  
**Use When**:
- Understanding table conversion logic
- Debugging table-related issues
- Implementing table enhancements

**Contains**:
- Why table image extraction is needed
- Implementation approach
- Code walkthrough
- Placeholder logic
- Edge cases and limitations

**Related**: `testing-table-images.md` (testing procedures)

---

### FIX_TABLE_FORMATTING_9.2.1.md
**Purpose**: Detailed technical documentation for v9.2.1 table fixes  
**Use When**:
- Understanding v9.2.1 changes
- Debugging table formatting
- Learning marker-based formatting system

**Contains**:
- 3 bug descriptions with root causes
- Technical solutions with code examples
- Marker system explanation
- ServiceNow class conventions
- Whitespace regex patterns
- Testing procedures
- Validation results

**Related**: `VERSION_9.2_FIXES.md` (comprehensive v9.2.x overview)

---

### Validation Utility (external reference)
**File**: `server/utils/VALIDATION_README.md`
**Purpose**: Post-creation Notion page validation (marker leaks, block counts, headings)
**Quick Start**: Add `Error` (Checkbox) + `Validation` (Text) properties; set `SN2N_VALIDATE_OUTPUT=1` and restart server.
**When to Use**: While modifying conversion, deep nesting, or marker orchestration logic.

---

## 🔧 Fix History

### VERSION_9.2_FIXES.md
**Purpose**: Consolidated documentation for all v9.2.x fixes  
**Use When**:
- Understanding what changed in v9.2.x
- Migrating from v9.1.x
- Troubleshooting v9.2.x issues

**Contains**:
- **v9.2.1 Fixes** (Oct 18, 2025):
  1. Conditional image placeholders
  2. Bullet line breaks in table cells
  3. UIControl formatting & newline preservation
  
- **v9.2.0 Fixes** (Oct 16-17, 2025):
  1. Access-limited page handling (AutoExtract)
  2. Duplicate image blocks
  3. Icon & cover image URLs
  4. TypeError: className.toLowerCase
  5. Rich text 100-element limit
  6. HTML tags in paragraphs
  7. Table image extraction
  8. Content order with Cheerio

**Quick Reference**:
- ServiceNow class formatting table
- Image placeholder logic
- Whitespace preservation patterns
- Performance impact analysis

**Related**: Individual fix docs archived in `archive/fixes/v9.2/`

---

### FIX_TABLE_FORMATTING_9.2.1.md
**Purpose**: Deep dive into v9.2.1 table formatting fixes  
**Status**: Current release documentation  
**See**: Technical Reference section above

---

## 📦 Archived Documentation

Historical and superseded documentation moved to `docs/archive/` for reference.

### Features (archive/features/)

#### access-limited/ (5 documents)
Documentation for the access-limited page handling feature (v9.2.0).

**Why Archived**: Feature is complete and fully documented in CHANGELOG.md and VERSION_9.2_FIXES.md. These detailed implementation docs are retained for reference but not needed for day-to-day use.

**Documents**:
- `CHANGELOG_ACCESS_LIMITED.md` — Detailed changelog
- `FINAL_SUMMARY_ACCESS_LIMITED.md` — Executive summary
- `FLOW_DIAGRAMS_ACCESS_LIMITED.md` — Visual flow diagrams
- `IMPLEMENTATION_SKIP_ACCESS_LIMITED.md` — Technical implementation
- `QUICK_REFERENCE_SKIP_LOGIC.md` — User quick reference

**When to Use**: Reference these if you need deep technical details about the access-limited feature implementation, flow diagrams, or original design decisions.

---

### Fixes (archive/fixes/v9.2/)

Individual fix documentation for v9.2.0 release (8 documents).

**Why Archived**: All fixes consolidated into `VERSION_9.2_FIXES.md` for easier reference. Original detailed docs retained for historical context.

**Documents**:
- `FIX_CLASSNAME_TOLOWERCASE_ERROR.md` — SVG className bug
- `FIX_DUPLICATE_IMAGE_IMAGES.md` — Image duplication issue
- `FIX_HTML_TAGS_IN_PARAGRAPHS.md` — HTML tag text bug
- `FIX_ICON_COVER_URLS.md` — Icon/cover URL corrections
- `FIX_ICON_COVER_VISIBILITY.md` — Icon/cover visibility
- `TEST_CASES_DUPLICATE_IMAGE_FIX.md` — Duplicate image test cases
- `fix-content-order-cheerio.md` — Content order fix
- `fix-rich-text-100-element-limit.md` — Rich text splitting

**When to Use**: Reference these if you need the original detailed analysis and implementation notes for specific v9.2.0 fixes.

---

### Reports (archive/reports/)

Build verification and deployment reports (5 documents).

**Why Archived**: These were point-in-time snapshots for v9.2.0 deployment. CHANGELOG.md now serves as the authoritative release documentation.

**Documents**:
- `BUILD_DEPLOYMENT_REPORT.md` — v9.2.0 deployment report
- `ICON_COVER_FIX_QUICK_REF.md` — Icon/cover quick reference
- `IMPLEMENTATION_SUMMARY.md` — Implementation summary
- `module-organization.md` — Module structure report
- `module-verification-report.md` — Module verification

**Recently archived (2025-11-09):**
- `html-formatting-processing-order.md` — superseded by `html-processing-order.md`
- `content-verification-oauth-github-jwt.md` — point-in-time verification notes
- `restart-server-commands.md` — replaced by VS Code tasks and scripts

**When to Use**: Reference these for historical context about v9.2.0 deployment process and module organization decisions.

---

## 🚀 Getting Started Paths

### I want to test the application
1. Start with `TESTING_SCENARIOS.md`
2. Pick a scenario and follow the test steps
3. Use test URLs provided in the document
4. Check expected behavior against actual results

### I want to understand how it works
1. Start with main project `README.md` (in root)
2. Read `notion-blocks-reference.md` for API overview
3. Review `table-image-extraction.md` for conversion logic
4. Check `VERSION_9.2_FIXES.md` for recent changes

### I want to fix a bug
1. Check `TESTING_SCENARIOS.md` for related test scenarios
2. Review `VERSION_9.2_FIXES.md` for similar issues
3. Reference `notion-blocks-reference.md` for API constraints
4. Check archived fix docs if needed

### I want to add a feature
1. Review `notion-blocks-reference.md` for API capabilities
2. Study similar implementations in `table-image-extraction.md`
3. Add test scenarios to `TESTING_SCENARIOS.md`
4. Update this index when documentation is complete

---

## 📝 Documentation Standards

### Active Documentation (docs/)
- Keep focused on current version features
- Update after each significant change
- Include examples and code snippets
- Maintain test scenarios with status

### Archived Documentation (docs/archive/)
- Move superseded implementation docs
- Keep version-specific detailed docs
- Maintain for historical reference
- Don't delete (git history not always accessible)

### When to Archive
- Feature documentation after feature is complete and in CHANGELOG
- Individual fix docs after consolidation into version summary
- Build reports after release is deployed
- Verification reports after superseded by newer versions

---

## 🔗 Related Documentation

### In Root Directory
- `README.md` — Project overview and setup
- `CHANGELOG.md` — Comprehensive release notes
- `.github/copilot-instructions.md` — AI coding agent guidelines

### In Server Directory
- `server/README.md` — Server architecture and API

---

## 📊 Documentation Statistics

| Category | Active Docs | Archived Docs | Total |
|----------|-------------|---------------|-------|
| Testing | 2 | 0 | 2 |
| Technical Reference | 3 | 0 | 3 |
| Fix History | 2 | 8 | 10 |
| Features | 0 | 5 | 5 |
| Reports | 0 | 5 | 5 |
| **Total** | **7** | **18** | **25** |

---

## 🛠️ Maintenance

### Regular Updates
- Update `TESTING_SCENARIOS.md` after each feature/fix
- Update fix history docs for each version
- Archive old implementation docs after consolidation
- Keep this index current with doc changes

### Version-Specific Docs
- Create detailed fix docs for complex issues
- Consolidate into version summary after release
- Move detailed docs to archive
- Keep version summary active for current major.minor

### Archive Trigger Events
- Feature complete and documented in CHANGELOG
- Multiple fix docs consolidated into version summary
- Build/verification reports superseded by release
- Documentation reorganization (like this one!)

### Documentation Maintenance (New)
- Prefer updating an existing doc over creating near-duplicates (merge & archive older title).
- Keep testing/fixtures docs under `docs/` and code-specific validation docs under `server/utils/`.
- Link cross-cutting backend docs (e.g., validation) from Technical Reference with explicit path.
- Archive one-off operational notes once replaced by tasks/scripts.

---

## ❓ FAQ

**Q: Where do I start?**  
A: Check the "Getting Started Paths" section above based on your goal.

**Q: Why are some docs archived?**  
A: To keep active documentation focused and manageable while preserving historical context.

**Q: Can I delete archived docs?**  
A: No, keep them for reference. Git history isn't always accessible and these provide valuable context.

**Q: How do I know if a doc is current?**  
A: Check the "Last Updated" date and version number at the top of each document.

**Q: Where's the access-limited feature documentation?**  
A: Summary in `VERSION_9.2_FIXES.md` (active), detailed docs in `archive/features/access-limited/` (archived).

**Q: I need to understand a specific v9.2.0 fix in detail**  
A: Check `archive/fixes/v9.2/` for the original detailed documentation.

---

## 📞 Support

**Questions about documentation?**  
- Check this index first
- Review related documents
- Search archived docs if needed

**Found outdated documentation?**  
- Update the document
- Update this index if needed
- Commit with clear description

**Need to add new documentation?**  
- Follow documentation standards above
- Add entry to this index
- Update statistics section

---

*This index is maintained as part of the ServiceNow-2-Notion project*  
*For code documentation, see inline comments and TypeScript definitions*  
*For API documentation, see `server/README.md` and `docs/notion-blocks-reference.md`*

---

**Last Updated**: October 18, 2025  
**Maintained By**: ServiceNow-2-Notion Project Team
