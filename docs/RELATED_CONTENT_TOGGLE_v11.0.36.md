# Related Content Toggle Feature (v11.0.36)

## Overview

ServiceNow documentation pages often have a "Related Content" section at the end containing links to related articles. This feature converts those sections into collapsible H3 toggles in Notion for better readability and organization.

## Behavior

### Detection
- **Pattern**: Case-insensitive regex matching "related content" in heading text
- **Regex**: `/related\s+content/i`
- **Matches**: "Related Content", "related content", "RELATED CONTENT", "Related    Content", etc.

### Conversion
When a heading containing "related content" is detected:

1. **Heading Level**: Forced to H3 (`heading_3`) regardless of original level
2. **Toggleable**: Set `is_toggleable: true` on the heading
3. **Children Collection**: 
   - Collects all following sibling elements
   - Stops when hitting another heading (h1-h6)
   - Processes each sibling recursively to convert to Notion blocks
   - Nests converted blocks as `children` array

### Result Structure

**Initial Page Creation:**
```json
{
  "object": "block",
  "type": "heading_3",
  "heading_3": {
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "Related Content"
        }
      },
      {
        "type": "text",
        "text": {
          "content": " sn2n:marker:related-content__abc123"
        }
      }
    ],
    "is_toggleable": true
  }
}
```

**After Orchestration (marker removed, children appended):**
```json
{
  "object": "block",
  "type": "heading_3",
  "heading_3": {
    "rich_text": [
      {
        "type": "text",
        "text": {
          "content": "Related Content"
        }
      }
    ],
    "is_toggleable": true
  },
  "children": [
    {
      "object": "block",
      "type": "numbered_list_item",
      "numbered_list_item": {
        "rich_text": [...]
      }
    },
    // ... more children
  ]
}
```

## Implementation Details

### Location
- **File**: `server/services/servicenow.cjs`
- **Lines**: ~1875-1920
- **Function Context**: Inside the `processElement()` heading processing block

### Algorithm

```javascript
// 1. Extract heading text and check for "Related Content"
const headingText = $elem.text().trim();
const isRelatedContent = /related\s+content/i.test(headingText);

if (isRelatedContent) {
  // 2. Force to H3
  level = 3;
  
  // 3. Collect following siblings until next heading
  const toggleChildren = [];
  let nextSibling = $elem.next();
  
  while (nextSibling && nextSibling.length > 0) {
    const siblingTag = nextSibling.get(0)?.tagName?.toLowerCase();
    
    // Stop at next heading
    if (/^h[1-6]$/.test(siblingTag)) break;
    
    // Process sibling recursively
    const childBlocks = await processElement(nextSibling);
    toggleChildren.push(...childBlocks);
    
    // Move to next sibling
    const currentSibling = nextSibling;
    nextSibling = nextSibling.next();
    currentSibling.remove(); // Mark as processed
  }
  
  // 4. Create marker for deep nesting orchestration
  //    Notion API doesn't allow children in heading blocks during initial creation
  const marker = createMarker('related-content');
  
  // 5. Add marker token to heading rich_text
  headingRichText.push({
    type: "text",
    text: { content: ` sn2n:marker:${marker}` },
    annotations: { /* ... */ }
  });
  
  // 6. Tag children with marker and mark as collected
  toggleChildren.forEach(child => {
    child._sn2n_marker = marker;
    child._sn2n_collected = true;
  });
  
  // 7. Create H3 toggle WITHOUT children (will be added via PATCH)
  processedBlocks.push({
    type: "heading_3",
    heading_3: {
      rich_text: headingRichText,
      is_toggleable: true,
    },
    // NO children property - will be appended via orchestration
  });
}
```

**Deep Nesting Orchestration:**

After the page is created, the `orchestrateDeepNesting()` function:
1. Searches the page for blocks containing `sn2n:marker:` tokens
2. For each marker, retrieves the stored children from `markerMap`
3. Appends children to the heading block via PATCH request
4. Removes the marker token from the heading's `rich_text`

This two-phase approach avoids Notion API validation errors while maintaining the desired structure.

### Debug Logging
Debug logs use the `[RELATED-CONTENT]` bracketed keyword for easy filtering:

- `🔍 [RELATED-CONTENT] Detected "Related Content" heading, converting to H3 toggle`
- `🔍 [RELATED-CONTENT] Stopped at next heading: h2`
- `🔍 [RELATED-CONTENT] Processing toggle child: ul`
- `🔍 [RELATED-CONTENT] Created toggle with 3 children`

## Testing

### Test File
`test-related-content-toggle.cjs`

### Test Coverage
1. Case-insensitive detection ("Related Content" vs "related content")
2. Multiple "Related Content" sections in one page
3. Various child content types (lists, paragraphs, links)
4. Stops at next heading boundary
5. Verifies H3 level enforcement
6. Verifies `is_toggleable: true` flag
7. Verifies children are nested correctly

### Running Tests
```bash
node test-related-content-toggle.cjs
```

Expected output:
```
🧪 Testing "Related Content" toggle conversion...
✅ Response has 8 blocks
📊 Found 4 heading blocks:
  3. HEADING_3: "Related Content"
     - Toggleable: ✅ YES
     - Children: ✅ 3 blocks
✅ All tests passed!
```

## Edge Cases

### Empty Content
If a "Related Content" heading has no following content (next sibling is another heading), the toggle will have no children. The `children` property is set to `undefined` in this case.

### Nested Structures
The recursive `processElement()` call handles nested structures (lists within lists, tables, etc.) correctly. Each child is fully processed before being added to the toggle.

### Non-ServiceNow Pages
This feature only activates when:
1. A heading element (h1-h6) is detected
2. The heading text matches the "related content" pattern

It's safe to use with any HTML source, not just ServiceNow.

## Benefits

### User Experience
- **Cleaner Pages**: Related content doesn't clutter the main content
- **Collapsible**: Users can expand when needed, collapse when not
- **Consistent**: All "Related Content" sections use the same H3 toggle format

### Implementation
- **No Breaking Changes**: Regular headings continue to work as before
- **Minimal Performance Impact**: Simple text match and sibling traversal
- **Extensible**: Pattern can be easily modified to match other section types

## Future Enhancements

Potential improvements:
1. Support for other collapsible sections (e.g., "See also", "References")
2. Configuration option to disable toggle conversion
3. Custom heading level (allow H2 or H3 via config)
4. Preserve original heading level instead of forcing H3

## Version History

- **v11.0.36**: Initial implementation
  - Case-insensitive "Related Content" detection
  - Force to H3 with toggle
  - Recursive child collection
  - Test coverage
