# Pages Requiring Re-Extraction

**Date**: 2025-11-18  
**Issue**: Marker leaks detected during manual revalidation  

## Summary

Out of 5 pages revalidated, **3 pages have marker leaks** and need re-extraction from ServiceNow.

---

## ❌ Pages with Marker Leaks (Need Re-Extraction)

### 1. Create a CMDB 360 Compare Attribute Values query
- **Page ID**: `2b0a89fedba581db9adaee70908ffb12`
- **Notion URL**: https://www.notion.so/Create-a-CMDB-360-Compare-Attribute-Values-query-2b0a89fedba581db9adaee70908ffb12
- **Block Count**: 27 blocks
- **Markers Found**: 2
  - `(sn2n:mi5jiuqd-t7b3uf)`
  - `(sn2n:mi5jiuqf-mmz7oq)`
- **Block Types**: paragraph:7, callout:1, numbered_list_item:12, table:2, heading_3:1, bulleted_list_item:4
- **HTML File**: ❌ NOT FOUND - needs fresh extraction from ServiceNow

### 2. Schedule a CMDB 360 query for a report
- **Page ID**: `2b0a89fedba5819abeb0eb84b5e65626`
- **Notion URL**: https://www.notion.so/Schedule-a-CMDB-360-query-for-a-report-2b0a89fedba5819abeb0eb84b5e65626
- **Block Count**: 18 blocks
- **Markers Found**: 1
  - `(sn2n:mi5jj6af-s0c02f)`
- **Block Types**: paragraph:7, callout:1, numbered_list_item:6, heading_3:1, bulleted_list_item:3
- **HTML File**: ❌ NOT FOUND - needs fresh extraction from ServiceNow

### 3. Hardware [cmdb_ci_hardware] class
- **Page ID**: `2b0a89fedba581138783c5e7c5611856`
- **Notion URL**: https://www.notion.so/Hardware-cmdb_ci_hardware-class-2b0a89fedba581138783c5e7c5611856
- **Block Count**: 26 blocks
- **Markers Found**: 6
  - `(sn2n:mi5iy7da-nfxi8c)`
  - `(sn2n:mi5iy7df-cwtfj7)`
  - `(sn2n:mi5iy7di-7cctlk)`
  - `(sn2n:mi5iy7dk-1z1lxa)`
  - `(sn2n:mi5iy7do-k6y7jn)`
  - (1 more not shown)
- **Block Types**: paragraph:4, image:1, callout:1, heading_2:4, table:1, bulleted_list_item:11, numbered_list_item:4
- **HTML File**: ❌ NOT FOUND - needs fresh extraction from ServiceNow
- **Note**: A different Hardware page exists in pages-to-update folder (`2b0a89fe-dba5-8121-b6d9-f3adc8819409`) but it's not the same page

---

## ✅ Pages Validated Successfully (No Action Needed)

### 4. Exclude classes from CMDB 360
- **Page ID**: `2b0a89fedba5819585d1efe570e7113c`
- **Notion URL**: https://www.notion.so/Exclude-classes-from-CMDB-360-2b0a89fedba5819585d1efe570e7113c
- **Block Count**: 11 blocks
- **Markers Found**: 0 ✅
- **Block Types**: paragraph:8, callout:1, numbered_list_item:2
- **Status**: Clean - no re-extraction needed

### 5. Components and process of Identification and Reconciliation
- **Page ID**: `2b0a89fedba58119a619d23708f07d2b`
- **Notion URL**: https://www.notion.so/Components-and-process-of-Identification-and-Reconciliation-2b0a89fedba58119a619d23708f07d2b
- **Block Count**: 29 blocks
- **Markers Found**: 0 ✅
- **Block Types**: paragraph:17, heading_2:2, bulleted_list_item:9, image:1
- **Status**: Clean - no re-extraction needed

---

## 📋 Next Steps

### For the 3 pages with marker leaks:

1. **Open each page in ServiceNow** (use the original ServiceNow URLs)
2. **Use the userscript to re-extract** each page
3. **Userscript will automatically PATCH** the existing pages to remove markers

### Alternative: If you have the original ServiceNow URLs

If you have access to the original ServiceNow documentation pages, you can:

1. Navigate to each page in ServiceNow
2. Use the ServiceNow-2-Notion userscript's "Extract to Notion" button
3. Select "Update existing page" and choose the matching Notion page
4. The userscript will PATCH the page with fresh content, removing the markers

---

## 🔍 Why These Pages Have Markers

These pages were likely created **before v11.0.23**, which fixed the POST marker sweep issue. The markers are residual from the orchestration process and weren't cleaned up by the final sweep.

The fix (v11.0.23) ensures:
- POST always runs a final marker sweep with 1s delay (matching PATCH behavior)
- PATCH always sweeps markers regardless of validation settings
- Both endpoints now have consistent marker cleanup

Re-extracting these pages with the current version will apply the fixed marker cleanup logic.

---

## 📁 File Location

This summary is saved at:
`/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/docs/pages-needing-reextraction-2025-11-18.md`
