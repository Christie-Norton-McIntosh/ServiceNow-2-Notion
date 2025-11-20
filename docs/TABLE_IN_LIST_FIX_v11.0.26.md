# Table in List Fix (v11.0.26)

## Problem

Tables inside numbered lists were breaking the list numbering sequence. When a table appeared as a child of a list item, it would reset the numbering for subsequent list items.

**Example:**
```
1. First step
2. Second step
   [Table appears here]
1. Third step  ← Numbering resets!
2. Fourth step
```

## Root Cause

The code was allowing `'table'` in the `supportedAsChildren` array for list items, treating tables as valid direct children of list items. However, **Notion's API does not actually support tables as direct children of list items**.

When tables are added as children to list items:
- They break out of the list context
- The list numbering resets after the table
- The visual continuity of the list is disrupted

## Solution

**Removed `'table'` from `supportedAsChildren` array** (line 4174).

### Before (v11.0.25):
```javascript
const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image', 'table'];
```

### After (v11.0.26):
```javascript
// FIX v11.0.26: Remove 'table' from supportedAsChildren - Notion API doesn't support tables as direct children of list items
// Tables break list context and reset numbering. They should use markers for deep nesting orchestration instead.
const supportedAsChildren = ['bulleted_list_item', 'numbered_list_item', 'paragraph', 'to_do', 'toggle', 'image'];
```

## How It Works Now

With this fix, when a table is found inside a list item:

1. **Table is NOT added as immediate child** of the list item
2. **Table gets a marker token** for deep nesting orchestration
3. **Orchestration phase** handles the table placement via separate API calls
4. **List numbering continues** without interruption

## Notion API Constraints

According to Notion's API, list items (`numbered_list_item`, `bulleted_list_item`) can have these block types as children:

✅ **Supported:**
- `paragraph`
- `bulleted_list_item` (nested lists)
- `numbered_list_item` (nested lists)
- `to_do`
- `toggle`
- `image`

❌ **NOT Supported as direct children:**
- `table` ← Fixed in v11.0.26
- `heading_*` (headings)
- `callout`
- `code`
- `divider`

## Impact

### Before Fix:
- ❌ Tables broke list numbering
- ❌ Lists would restart from 1 after tables
- ❌ Visual continuity disrupted

### After Fix (v11.0.26):
- ✅ List numbering remains continuous
- ✅ Tables are handled via orchestration (placed outside list context)
- ✅ Clean, properly structured lists

## Alternative: Tables Outside Lists

If tables are semantically part of a list step's content, consider these approaches:

1. **Reference in list text**: "See table below for details..."
2. **Place after entire list**: Complete the list, then show tables
3. **Use callouts**: Wrap table descriptions in callouts for context

## Testing

To verify the fix:

1. **Create content with tables in numbered lists**:
   ```html
   <ol>
     <li>First step</li>
     <li>Second step
       <table>
         <tr><td>Data</td></tr>
       </table>
     </li>
     <li>Third step</li>
   </ol>
   ```

2. **Extract to Notion** (POST or PATCH)

3. **Verify**:
   - ✅ List numbering: 1, 2, 3 (continuous)
   - ✅ No reset after table
   - ✅ Table appears correctly (via orchestration)

## Version

- **Version**: 11.0.26
- **Date**: 2025-11-19
- **Type**: Bug Fix
- **Priority**: High (affects document structure)
- **File**: `server/services/servicenow.cjs` (line 4174)
