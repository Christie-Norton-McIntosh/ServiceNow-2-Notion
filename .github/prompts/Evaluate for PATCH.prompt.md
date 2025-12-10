---
mode: agent
---
to Activate, tell Copilot: Begin evaluating the pages in patch/pages/pages-to-update/ using the prompt from .github/prompts/Evaluate for PATCH.prompt.md

# Task: Evaluate Failed PATCH Pages and Implement Systematic Fixes

## Objective
Analyze all failed pages in `patch/pages/pages-to-update/` directory to discover root causes, implement fixes in both POST and PATCH endpoints, correct existing flagged pages via PATCH, and prevent future occurrences. Collect pattern data for ML-based prevention.

## Directory Context
- **Input**: `patch/pages/pages-to-update/` - Contains HTML files of pages that failed validation
- **File Types**: 
  - `*.html` - Source HTML with metadata comments (Page ID, validation results, issues)
  - `*-content-validation-failed-*.html` - Content validation failures (AUDIT coverage < 95% or > 105%)
  - `*-patch-validation-failed-*.html` - PATCH operation failures (general validation errors)

## Analysis Requirements

### 1. Issue Discovery Phase
For each failed page in `pages-to-update/`:

1. **Extract Metadata** from HTML comments:
   - Page ID (32-char UUID)
   - Page Title
   - Source URL
   - Timestamp
   - Validation Result (JSON)
   - Validation Issues (list)
   - Validation Warnings (list)

2. **Analyze Failure Patterns**:
   - Group pages by failure type (content validation vs patch validation)
   - Identify common HTML patterns in failing pages
   - Extract AUDIT results from metadata (missing/extra segments)
   - Analyze MissingText and ExtraText patterns
   - Look for structural issues (tables, lists, callouts, code blocks)

3. **Cross-Reference Server Code**:
   - Match failure patterns to conversion logic in `server/services/servicenow.cjs`
   - Check table handling in `server/converters/table.cjs`
   - Review rich text conversion in `server/converters/rich-text.cjs`
   - Examine orchestration logic in `server/orchestration/*.cjs`

### 2. Root Cause Identification

For each distinct failure pattern:

1. **HTML Characteristics**:
   - Specific tags, classes, or structure causing issues
   - Content complexity (nested elements, special formatting)
   - Edge cases (empty elements, whitespace, special characters)

2. **Server-Side Processing Gaps**:
   - Missing conversion rules
   - Incorrect filtering logic
   - Inadequate normalization
   - Deep nesting limitations

3. **Validation Logic Issues**:
   - AUDIT coverage threshold edge cases
   - Block counting mismatches
   - Text extraction inconsistencies

### 3. Fix Implementation Phase

For each identified root cause:

#### A. Code Changes Required

1. **POST Endpoint Prevention** (`server/routes/w2n.cjs`, `server/services/servicenow.cjs`):
   - Add/modify HTML conversion rules
   - Improve filtering logic (e.g., Related Content, navigation)
   - Enhance normalization (whitespace, newlines)
   - Update block generation logic
   - Add validation for edge cases

2. **PATCH Endpoint Consistency** (`server/routes/w2n.cjs`):
   - Ensure PATCH uses identical conversion logic as POST
   - Verify property updates (Audit, ContentComparison, MissingText, ExtraText)
   - Confirm validation timing and retry logic

3. **Converter Modules** (`server/converters/*.cjs`):
   - Table cell content handling
   - Rich text annotation extraction
   - Image processing and extraction
   - Code block detection and formatting

#### B. Testing Strategy

1. **Isolated Test**:
   - Create test fixture from failing page HTML
   - Run through conversion pipeline
   - Verify AUDIT results improve
   - Check block counts match expectations

2. **Regression Prevention**:
   - Add test case to `tests/` or `server/tests/`
   - Document the pattern in comments
   - Add to automated test suite

### 4. PATCH Correction Phase

For each fixed issue:

1. **Batch PATCH Script**:
   - Use `patch/config/batch-patch-with-cooldown.sh`
   - Process pages in chunks (3 at a time, 10s cooldown)
   - Verify validation passes after PATCH
   - Move corrected pages to `patch/pages/updated-pages/`

2. **Task Configuration Update**:
   - **CRITICAL**: Update `.vscode/tasks.json` "🔄 Run Batch PATCH" task with any new environment variables or configuration needed for the fix
   - Add new env vars to the task's `command` property (e.g., `SN2N_FIX_PATTERN_X=1`)
   - Document the purpose of each new env var in the task's `detail` field
   - This ensures the fix can be rolled out in **1 click** via VS Code Tasks
   - Example format:
     ```json
     {
       "label": "🔄 Run Batch PATCH",
       "command": "cd ${workspaceFolder}/patch/config && SN2N_VERBOSE=1 SN2N_VALIDATE_OUTPUT=1 SN2N_FIX_NEW_PATTERN=1 bash batch-patch-with-cooldown.sh",
       "detail": "PATCH with new fix: SN2N_FIX_NEW_PATTERN=1 enables [description of fix]"
     }
     ```

3. **Validation Verification**:
   - Confirm all four properties updated (Audit, ContentComparison, MissingText, ExtraText)
   - Check AUDIT coverage now in 95-105% range
   - Verify no "Related Content" in ExtraText
   - Ensure block counts accurate (tables, images, callouts)

### 5. Pattern Learning Data Collection

For ML/pattern recognition, collect:

```json
{
  "pattern_id": "unique-pattern-identifier",
  "failure_type": "content_validation|patch_validation",
  "frequency": 0,
  "pages_affected": [],
  "html_pattern": {
    "tags": [],
    "classes": [],
    "structure_signature": "",
    "complexity_metrics": {
      "nesting_depth": 0,
      "table_count": 0,
      "list_count": 0,
      "callout_count": 0
    }
  },
  "audit_characteristics": {
    "avg_coverage": 0,
    "avg_missing_percent": 0,
    "avg_extra_percent": 0,
    "common_missing_contexts": [],
    "common_extra_contexts": []
  },
  "fix_applied": {
    "code_location": "",
    "change_type": "filter|converter|normalizer|orchestrator",
    "description": "",
    "test_coverage": ""
  },
  "success_metrics": {
    "pages_fixed": 0,
    "avg_coverage_improvement": 0,
    "validation_pass_rate": 0
  }
}
```

## Success Criteria

### Immediate Success
- [ ] All pages in `pages-to-update/` analyzed and categorized
- [ ] Root causes identified for each failure pattern
- [ ] Fixes implemented in POST and PATCH endpoints
- [ ] All fixable pages successfully PATCH'd and moved to `updated-pages/`
- [ ] Test cases added for regression prevention

### Code Quality
- [ ] Both POST and PATCH use identical conversion logic
- [ ] All four validation properties consistently updated
- [ ] Edge cases documented and handled
- [ ] No hardcoded workarounds - root cause fixes only

### Pattern Learning
- [ ] Pattern database created with JSON records
- [ ] Frequency and success metrics tracked
- [ ] HTML signatures extracted for future detection
- [ ] Test fixtures saved in `tests/fixtures/`

### Documentation
- [ ] Each fix documented with:
  - Problem description
  - Root cause analysis  
  - Solution approach
  - Test coverage
  - Related pages affected
- [ ] Pattern learning data exportable for ML training

## Constraints

1. **No Manual Intervention**: Fixes must be automated and reproducible
2. **Backward Compatibility**: Don't break existing working pages
3. **Performance**: Maintain current conversion speed
4. **Validation Integrity**: Don't artificially inflate AUDIT coverage
5. **Code Maintainability**: Keep fixes clear and well-commented

## Output Format

For each analysis session, provide:

```markdown
## Analysis Summary
- Total pages analyzed: X
- Unique failure patterns identified: Y
- Pages requiring code fixes: Z
- Pages correctable with existing code: W

## Failure Patterns

### Pattern 1: [Name]
- **Frequency**: X pages
- **Root Cause**: [Description]
- **Example Pages**: [List]
- **Fix Location**: [File:Line]
- **Fix Description**: [What changed]
- **Test Coverage**: [Test file added]

[Repeat for each pattern]

## Code Changes Made
- [ ] File1: Description
- [ ] File2: Description

## PATCH Operations
- [ ] X pages successfully PATCH'd
- [ ] Y pages moved to updated-pages/
- [ ] Z pages still failing (requires additional fixes)

## Pattern Learning Data
- [ ] JSON records created: X patterns
- [ ] Exported to: [path]

## Next Steps
1. [Action item 1]
2. [Action item 2]
```

## Execution Workflow

1. **Start**: Read all HTML files in `pages-to-update/`
2. **Analyze**: Extract metadata, group by patterns
3. **Diagnose**: Map patterns to code locations
4. **Implement**: Make fixes in servicenow.cjs, converters, etc.
5. **Test**: Run isolated tests, verify improvements
6. **PATCH**: Correct existing pages with batch script
7. **Validate**: Confirm all pages pass validation
8. **Learn**: Export pattern data for ML
9. **Document**: Update this prompt with findings

## Key Files to Examine

### Server-Side Processing
- `server/services/servicenow.cjs` - Main HTML→Notion conversion
- `server/converters/table.cjs` - Table cell processing
- `server/converters/rich-text.cjs` - Text formatting extraction
- `server/orchestration/*.cjs` - Deep nesting, marker management
- `server/routes/w2n.cjs` - POST/PATCH endpoints

### Testing
- `tests/fixtures/*.html` - Test HTML samples
- `tests/test-*.cjs` - Client-side tests
- `server/tests/test-*.cjs` - Server-side tests

### PATCH Workflow
- `patch/config/batch-patch-with-cooldown.sh` - Batch processing script
- `patch/pages/pages-to-update/` - Failed pages (INPUT)
- `patch/pages/updated-pages/` - Fixed pages (OUTPUT)