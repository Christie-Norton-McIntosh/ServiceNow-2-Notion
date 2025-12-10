# Stats Property Removal & Heading Count Fix - v11.0.182

## Overview
Removed all references to the legacy "Stats" property name and ensured `span.title` elements are counted as headings in HTML→Notion comparisons.

## Changes Made

### 1. Removed "Stats" Property References

All references to the legacy "Stats" property have been removed in favor of "ContentComparison":

#### Files Modified:
- **server/routes/validate.cjs**
  - Updated JSDoc comments (line 26)
  - Removed Stats property fallback logic (lines 54-137)
  - Only checks for ContentComparison property now

- **server/routes/w2n.cjs**
  - Updated file header comments (lines 14, 18, 890)
  - Removed Stats backward compatibility in POST endpoint (lines 2317-2364)
  - Removed Stats backward compatibility in PATCH endpoint (lines 5138-5202)
  - Updated all inline comments referencing "Stats"
  - Changed variable names from `statsPropertyName` to `comparisonPropertyName`

- **server/services/servicenow.cjs**
  - Updated JSDoc comment for plain-text validation (line 7398)

#### Before:
```javascript
// Check for Stats property first, then ContentComparison
const hasOldStats = dbProps.includes("Stats");
const hasNewStats = dbProps.includes("ContentComparison");

if (hasOldStats && !hasNewStats) {
  statsPropertyName = "Stats";
  log(`Using legacy property name: "Stats"`);
}
```

#### After:
```javascript
// Only check for ContentComparison property
const hasContentComparison = dbProps.includes("ContentComparison");

if (!hasContentComparison && propertyUpdates["ContentComparison"]) {
  log(`ContentComparison property not found, skipping update`);
  delete propertyUpdates["ContentComparison"];
}
```

### 2. Added span.title to Heading Counts

ServiceNow documentation uses `<span class="title">` elements that are converted to headings in Notion, but they weren't being counted in the HTML source count. This caused mismatches in the ContentComparison property.

#### Files Modified:
- **server/routes/w2n.cjs**
  - POST endpoint heading count (line 2147): Added `span.title` to selector
  - PATCH endpoint heading count (line 4418): Added `span.title` to selector

#### Before:
```javascript
// Count headings (h1-h6)
const hCount = $('h1, h2, h3, h4, h5, h6').length;
sourceCounts.headings = hCount;
log(`Found ${hCount} heading tags`);
```

#### After:
```javascript
// Count headings (h1-h6 + span.title which become headings in Notion)
const hCount = $('h1, h2, h3, h4, h5, h6, span.title').length;
sourceCounts.headings = hCount;
log(`Found ${hCount} heading tags (includes span.title)`);
```

## Impact

### Positive:
- **Simplified codebase**: No more backward compatibility logic for Stats property
- **Clearer property naming**: All validation comparison data in ContentComparison
- **Accurate heading counts**: span.title elements now counted, reducing false mismatches
- **Reduced validation failures**: Pages with span.title will show correct heading counts

### Breaking Changes:
- **Legacy databases with "Stats" property**: Will no longer be updated
  - Solution: Databases must have "ContentComparison" property to receive updates
  - Migration: Rename "Stats" to "ContentComparison" in Notion database schema

## Testing

### Test Heading Count Fix:
1. Find a ServiceNow page with `<span class="title">` elements
2. Extract to Notion with validation enabled
3. Check ContentComparison property
4. Verify: Headings count should match (HTML count includes span.title)

### Test Stats Property Removal:
1. Query database properties: `GET /api/databases/:id`
2. Verify database has "ContentComparison" property
3. POST/PATCH a page with validation
4. Verify: ContentComparison property updated, no "Stats" property references in logs

## Files Modified

1. `server/routes/validate.cjs` (lines 26, 54-137)
2. `server/routes/w2n.cjs` (lines 14, 18, 890, 1911, 2107, 2147, 2317-2364, 3934, 3937, 4018, 4021, 4375, 4377, 4418, 5138-5202)
3. `server/services/servicenow.cjs` (line 7398)

## Related Issues

- Legacy "Stats" property deprecated in favor of "ContentComparison"
- span.title elements converted to headings but not counted (causes validation mismatches)
- v11.0.115 introduced backward compatibility (now removed)

## Next Steps

1. Monitor batch PATCH logs for "ContentComparison property not found" warnings
2. Update any databases still using "Stats" property name
3. Re-validate pages with span.title elements to confirm accurate heading counts
4. Update documentation to reflect ContentComparison as the canonical property name
