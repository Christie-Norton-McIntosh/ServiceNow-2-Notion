# Release Notes - v9.2.25

**Release Date:** October 25, 2025

## 🐛 Bug Fixes

### Fixed: Missing Articles in ServiceNow Documentation Extraction

**Issue:** When extracting ServiceNow documentation pages with multiple articles, only 4 of 7 articles were being processed and converted to Notion blocks. The 3 missing articles were being silently skipped.

**Root Cause:** Some `article.nested1` elements in the ServiceNow HTML were "orphaned" - they existed in the DOM but were not nested inside the `.zDocsTopicPageBody` container. The original code only processed articles within this container, causing the orphaned articles to be ignored.

**Solution:** 
- Added detection logic to identify orphaned `article.nested1` elements
- Uses jQuery's `.closest()` method to filter articles not inside `.zDocsTopicPageBody`
- Appends orphaned articles to the `contentElements` array for processing
- All articles are now processed regardless of their DOM location

**Impact:**
- **Before:** 63 blocks created from 4 articles
- **After:** 106 blocks created from all 7 articles
- **Result:** Complete content extraction with no missing sections

**Files Modified:**
- `server/services/servicenow.cjs` (lines 3227-3240)

## 📊 Metrics

- **Blocks Increase:** +68% (63 → 106 blocks)
- **Articles Recovered:** 3 previously missing articles now captured
- **Content Completeness:** 100% (7/7 articles)

## 🔍 Technical Details

### Code Changes

Added orphaned article detection after collecting `.zDocsTopicPageBody` children:

```javascript
// FIX: Also collect any orphaned article.nested1 elements that are NOT inside .zDocsTopicPageBody
const allNested1 = $('article.nested1').toArray();
const orphanedNested1 = allNested1.filter(article => {
  const $article = $(article);
  return $article.closest('.zDocsTopicPageBody').length === 0;
});

if (orphanedNested1.length > 0) {
  console.log(`🔍 FIX: Found ${orphanedNested1.length} orphaned article.nested1 elements outside .zDocsTopicPageBody`);
  console.log(`🔍 FIX: Orphaned article IDs: ${orphanedNested1.map(a => $(a).attr('id') || 'NO-ID').join(', ')}`);
  contentElements.push(...orphanedNested1);
}
```

### Diagnostic Output

During extraction, the fix logs:
```
🔍 Processing from .zDocsTopicPageBody, found 4 children
🔍 FIX: Found 3 orphaned article.nested1 elements outside .zDocsTopicPageBody
🔍 FIX: Orphaned article IDs: dev-ops-create-jwt-prov-github, dev-ops-reg-github-oauth-prov-jwt, dev-ops-create-cred-github-jwt
```

### Articles Now Captured

**Previously Processed (4):**
1. dev-ops-config-github-acct-jwt
2. dev-ops-generate-jks-cert-github
3. dev-ops-attach-jks-cert-github
4. dev-ops-create-jwt-key-github

**Now Also Captured (3):**
5. dev-ops-create-jwt-prov-github ✅
6. dev-ops-reg-github-oauth-prov-jwt ✅
7. dev-ops-create-cred-github-jwt ✅

## 🧪 Testing

Verified with ServiceNow "OAuth 2.0 credentials for GitHub Apps (JWT)" documentation page:

1. ✅ Client sends all 7 articles (52,806 characters)
2. ✅ Server receives complete HTML payload
3. ✅ Cheerio parses all 7 articles without loss
4. ✅ Orphaned article detection finds 3 missing articles
5. ✅ All 7 articles processed into 106 Notion blocks
6. ✅ Deep nesting orchestration works (14 markers)
7. ✅ Final Notion page contains complete content

## 📝 Migration Notes

No action required. The fix is backward compatible and automatically applies to all ServiceNow documentation extractions.

## 🔗 Related Issues

- Initial report: "there should be 7 unique h2-headings/articles but we are only getting 4"
- Investigation revealed DOM structure differences causing orphaned elements
- Fix ensures complete content capture regardless of DOM organization

## 👥 Credits

Investigation and fix by Christie Norton-McIntosh with diagnostic assistance.
