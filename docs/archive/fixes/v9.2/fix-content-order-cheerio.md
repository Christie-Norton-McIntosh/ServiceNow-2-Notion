# Fix: Content Order Preservation with Cheerio

## Problem

Content from ServiceNow pages was being converted to Notion blocks out of order. For example:

**Original Order:**
1. Heading: "Tables"
2. Table with data
3. Heading: "Properties"
4. Paragraph
5. Callout/Note

**Incorrect Output Order:**
1. Callout/Note (processed first)
2. Table (processed second)
3. Headings (processed third)
4. Paragraphs (processed last)

## Root Cause

The HTML parsing logic used sequential regex matching by element type:
1. Extract all callouts → remove from HTML
2. Extract all tables → remove from HTML
3. Extract all code blocks → remove from HTML
4. Extract all headings → remove from HTML
5. Extract all lists → remove from HTML
6. Extract all paragraphs → remove from HTML

This approach grouped elements by type rather than preserving their document order.

## Solution

Replaced regex-based parsing with **cheerio** DOM traversal:

### Before (Regex-based):
```javascript
// Process all callouts first
const calloutRegex = /<div[^>]*class=["']note[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
while ((calloutMatch = calloutRegex.exec(html)) !== null) {
  // ... process callout
  html = html.replace(calloutMatch[0], "");
}

// Then process all tables
const tableRegex = /<table[\s\S]*?<\/table>/gi;
while ((tableMatch = tableRegex.exec(html)) !== null) {
  // ... process table
  html = html.replace(tableHtml, "");
}
// ... etc for headings, lists, paragraphs
```

### After (Cheerio-based):
```javascript
const $ = cheerio.load(html, { 
  decodeEntities: false,
  _useHtmlParser2: true 
});

// Process elements in document order
const children = bodyContent.children().toArray();
for (const child of children) {
  const childBlocks = await processElement(child); // Handles any element type
  blocks.push(...childBlocks);
}
```

## Changes Made

1. **Installed cheerio**: `npm install cheerio` in server directory
2. **Added import**: `const cheerio = require('cheerio');`
3. **Refactored `extractContentFromHtml()`**: 
   - Load HTML with cheerio
   - Walk DOM tree in document order
   - Process each element based on its tag name
   - Preserve original sequence

## Benefits

✅ **Document order preserved**: Elements appear in Notion exactly as they appear in ServiceNow  
✅ **More robust parsing**: Proper DOM parsing instead of regex  
✅ **Easier to maintain**: Single `processElement()` function handles all types  
✅ **Better nested content handling**: Cheerio properly handles nested HTML structures  

## Testing

Test by sending ServiceNow documentation with mixed content types (headings, tables, callouts, lists) and verify the order matches in Notion.

## Files Modified

- `server/services/servicenow.cjs`: Replaced regex-based parsing with cheerio DOM traversal
- `server/package.json`: Added cheerio dependency (auto-updated by npm install)

## Date

October 13, 2025
