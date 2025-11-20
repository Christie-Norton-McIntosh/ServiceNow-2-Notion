# Table-in-List Debug Logging - v11.0.27

**Date**: November 19, 2025  
**Issue**: Tables in numbered lists appearing at root level instead of nested under list items  
**Status**: Comprehensive debug logging added to trace execution flow

## Overview

Added extensive debug logging to trace tables through the marker-based orchestration system. This will help identify where the breakdown occurs in the expected flow.

## Debug Keywords for Filtering

Use these bracketed keywords to filter logs:

- **`[TABLE-DEBUG]`** - General table processing logs
- **`[TABLE-DEBUG-OL]`** - Table processing specific to numbered (ordered) lists
- **`[MARKER-PRESERVE-TABLE]`** - When tables are marked for orchestration
- **`📊`** - Emoji prefix for all table-related logs

## Expected Flow

Tables in lists should follow this path:

1. **Detection** → Table found as nested block in list item
2. **Marking** → Table added to `markedBlocks` array
3. **Marker Assignment** → Table gets `_sn2n_marker` property with unique ID
4. **Token Insertion** → Marker token `(sn2n:marker-id)` added to list item rich_text
5. **Top-Level Push** → Table pushed to top-level `processedBlocks` (NOT as child of list)
6. **Collection** → `collectAndStripMarkers` finds table, adds to markerMap, sets `_sn2n_collected = true`
7. **Removal** → `removeCollectedBlocks` removes table from top-level blocks
8. **Page Creation** → Page created with list items (containing marker tokens) but NO tables
9. **Orchestration** → `orchestrateDeepNesting` finds marker tokens, appends tables to list items via API

## Debug Logging Added

### 1. servicenow.cjs - Table Detection & Marking

**Location**: Lines 2844-2860 (OL processing)

```javascript
if (block.type === 'table') {
  console.log(`🔍 [MARKER-PRESERVE-TABLE] Table block deferred for orchestration to preserve source order`);
  // DEBUG: Log table details for tracking
  const tableWidth = block.table?.table_width || 'unknown';
  const tableRows = block.table?.children?.length || 0;
  console.log(`🔍 [TABLE-DEBUG-OL] Table dimensions: ${tableWidth} cols x ${tableRows} rows`);
  console.log(`🔍 [TABLE-DEBUG-OL] Table block before marking - has _sn2n_marker: ${!!block._sn2n_marker}`);
}
markedBlocks.push(block);
```

**What to look for**: Verify tables are detected and added to markedBlocks

### 2. servicenow.cjs - Marker Assignment

**Location**: Lines 2903-2915

```javascript
blocksNeedingMarker.forEach(block => {
  block._sn2n_marker = marker;
  // DEBUG: Log when table gets marker
  if (block.type === 'table') {
    const tableWidth = block.table?.table_width || 'unknown';
    const tableRows = block.table?.children?.length || 0;
    console.log(`🔍 [TABLE-DEBUG-OL] ✅ Table marked with "${marker}" (${tableWidth} cols x ${tableRows} rows)`);
  }
});
```

**What to look for**: Confirm tables receive `_sn2n_marker` property

### 3. servicenow.cjs - Top-Level Push

**Location**: Lines 2957-2969

```javascript
if (markedBlocks.length > 0) {
  console.log(`🔍 Adding ${markedBlocks.length} marked blocks as top-level blocks (NOT children) for collection & orchestration`);
  // DEBUG: Log each table being pushed
  const tablesToPush = markedBlocks.filter(b => b.type === 'table');
  if (tablesToPush.length > 0) {
    console.log(`🔍 [TABLE-DEBUG-OL] ➡️ Pushing ${tablesToPush.length} table(s) to TOP-LEVEL processedBlocks`);
    tablesToPush.forEach((table, idx) => {
      const tableWidth = table.table?.table_width || 'unknown';
      const tableRows = table.table?.children?.length || 0;
      console.log(`🔍 [TABLE-DEBUG-OL]   Table ${idx+1}: marker="${table._sn2n_marker || 'NONE'}", ${tableWidth} cols x ${tableRows} rows`);
    });
  }
  processedBlocks.push(...markedBlocks);
}
```

**What to look for**: Verify tables are pushed to processedBlocks with markers

### 4. marker-management.cjs - Collection

**Location**: Lines 106-113

```javascript
// DEBUG: Log when table is collected
if (b.type === 'table') {
  const tableWidth = b.table?.table_width || 'unknown';
  const tableRows = b.table?.children?.length || 0;
  console.log(`${indent}🔖 [TABLE-DEBUG] ✅ COLLECTED table (${tableWidth} cols x ${tableRows} rows) with marker "${m}"`);
}

map[m].push(b);
b._sn2n_collected = true;
```

**What to look for**: Confirm tables are collected into markerMap and flagged as collected

### 5. marker-management.cjs - Removal

**Location**: Lines 162-169

```javascript
if (b._sn2n_collected) {
  console.log(`${indent}🗑️   Removing block at index ${i}, type: ${b.type} [COLLECTED]`);
  // DEBUG: Log when table is removed
  if (b.type === 'table') {
    const tableWidth = b.table?.table_width || 'unknown';
    const tableRows = b.table?.children?.length || 0;
    console.log(`${indent}🗑️ [TABLE-DEBUG] ✅ REMOVED table (${tableWidth} cols x ${tableRows} rows) from top-level [COLLECTED]`);
  }
  blocks.splice(i, 1);
  removed++;
}
```

**What to look for**: Verify tables are removed from top-level blocks after collection

### 6. w2n.cjs - MarkerMap Analysis (POST)

**Location**: Lines 797-814

```javascript
Object.keys(markerMap).forEach(marker => {
  const blocks = markerMap[marker] || [];
  const blockTypes = blocks.map(b => b.type).join(', ');
  log(`🔖   Marker "${marker}": ${blocks.length} block(s) [${blockTypes}]`);
  // DEBUG: Check if this marker contains tables
  const tableBlocks = blocks.filter(b => b && b.type === 'table');
  if (tableBlocks.length > 0) {
    totalTablesInMarkers += tableBlocks.length;
    log(`📊 [TABLE-DEBUG] Marker "${marker}" contains ${tableBlocks.length} table(s)`);
  }
});
if (totalTablesInMarkers > 0) {
  log(`📊 [TABLE-DEBUG] Total tables in markerMap: ${totalTablesInMarkers}`);
}
```

**What to look for**: Check if tables are present in markerMap before page creation

### 7. w2n.cjs - MarkerMap Analysis (PATCH)

**Location**: Lines 1860-1875

Same logging as POST endpoint.

### 8. deep-nesting.cjs - Orchestration Start

**Location**: Lines 243-254

```javascript
// DEBUG: Log if this marker has table blocks
const tableCount = blocksToAppend.filter(b => b && b.type === 'table').length;
if (tableCount > 0) {
  log(`📊 [TABLE-DEBUG] Marker "${marker}" has ${tableCount} table block(s) out of ${blocksToAppend.length} total`);
  blocksToAppend.filter(b => b.type === 'table').forEach((table, idx) => {
    const tableWidth = table.table?.table_width || 'unknown';
    const tableRows = table.table?.children?.length || 0;
    log(`📊 [TABLE-DEBUG]   Table ${idx+1}: ${tableWidth} cols x ${tableRows} rows`);
  });
}
```

**What to look for**: Verify tables are present in orchestrator's blocksToAppend

### 9. deep-nesting.cjs - Parent Found

**Location**: Lines 282-285

```javascript
if (tableCount > 0) {
  log(`📊 [TABLE-DEBUG] Parent found! Will append ${tableCount} table(s) to parent ${parentId}`);
}
```

**What to look for**: Confirm orchestrator found the parent list item

### 10. deep-nesting.cjs - Append Success

**Location**: Lines 479-482

```javascript
// DEBUG: Log successful table append
if (tableCount > 0) {
  log(`📊 [TABLE-DEBUG] ✅ Successfully appended ${tableCount} table(s) to parent ${parentId}`);
}
```

**What to look for**: Verify tables were successfully appended to list items

## Diagnostic Checklist

When a table appears at root level instead of nested in a list:

- [ ] Table detected in list processing (`[TABLE-DEBUG-OL] Table dimensions`)
- [ ] Table added to markedBlocks (`[MARKER-PRESERVE-TABLE]`)
- [ ] Table receives marker (`✅ Table marked with`)
- [ ] Table pushed to top-level processedBlocks (`➡️ Pushing X table(s)`)
- [ ] Table collected into markerMap (`✅ COLLECTED table`)
- [ ] Table removed from top-level (`✅ REMOVED table from top-level`)
- [ ] Table present in markerMap summary (`Total tables in markerMap: X`)
- [ ] Orchestrator processes table marker (`Marker "X" has Y table block(s)`)
- [ ] Orchestrator finds parent list item (`Parent found! Will append`)
- [ ] Table successfully appended (`✅ Successfully appended X table(s)`)

**If any step fails**, that's where the issue is occurring.

## Filtering Logs

### Server Console

```bash
# Filter for all table-related logs
grep -i "table-debug\|📊"

# Filter for specific stages
grep "TABLE-DEBUG-OL"        # List processing
grep "COLLECTED table"       # Collection phase
grep "REMOVED table"         # Removal phase
grep "Will append.*table"    # Orchestration phase
```

### Browser Console (userscript)

```javascript
// Filter logs in browser DevTools
console.save = function(data, filename) {
  const blob = new Blob([data], {type: 'text/plain'});
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
};

// Save filtered logs
const tableLogs = performance.getEntries()
  .filter(e => e.name.includes('TABLE-DEBUG'))
  .map(e => e.name);
console.save(tableLogs.join('\n'), 'table-debug.log');
```

## Next Steps

1. **Test with page containing tables in numbered lists**
2. **Review logs to identify which step fails**
3. **Fix the specific failure point**
4. **Verify fix with same test page**
5. **Remove debug logging once issue is resolved**

## Files Modified

- `server/services/servicenow.cjs` - 3 logging additions in OL processing
- `server/orchestration/marker-management.cjs` - 2 logging additions (collection & removal)
- `server/orchestration/deep-nesting.cjs` - 3 logging additions (orchestration stages)
- `server/routes/w2n.cjs` - 2 logging additions (POST & PATCH markerMap analysis)

## Related Documentation

- `docs/FIX_TABLE_IN_LIST_NESTING.md` - Original issue documentation
- `docs/deep-nesting-architecture.md` - Marker-based orchestration design
- `server/orchestration/README.md` - Orchestration module overview
