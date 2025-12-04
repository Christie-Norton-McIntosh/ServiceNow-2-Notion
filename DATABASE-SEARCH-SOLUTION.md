# Database Search Issue — Complete Solution Summary

**Date**: December 4, 2025  
**Issue**: Database search returns "not found" / "no accessible databases"  
**Status**: ✅ **Diagnosed and Documented**

---

## What's Happening

When you search for your database using:
- **URL**: `https://www.notion.so/norton-mcintosh/2b2a89fedba58033a6aeee258611a908?v=...`
- **ID**: `2b2a89fe-dba5-8033-a6ae-ee258611a908`

You get the error:
```
Database "..." not found.
No accessible databases found. Make sure at least one database is shared with your Notion integration.
```

---

## Why This Happens

Your Notion **integration** (the bot/app that ServiceNow-2-Notion uses) doesn't have permission to access any databases.

**This is NOT a bug** — it's a security feature! Notion requires you to explicitly grant database access to integrations.

### The Fix is Manual (On Your End)

You need to:
1. Open the database in Notion
2. Click "Share"
3. Add your integration to the access list
4. Try again

---

## What We've Done (v11.0.114-11.0.116)

We've made multiple improvements to help you understand and fix this:

### ✅ Code Improvements

**File: `server/routes/databases.cjs`**
- Fixed inconsistent response formats (cached vs non-cached)
- Implemented proper error handling with status codes
- Added permission error detection (403/404)

**File: `src/ui/main-panel.js`**
- Added URL extraction validation with helpful error messages
- Improved error detection to distinguish permission vs other errors
- Enhanced user guidance with step-by-step instructions
- Shows database ID clearly so you can verify it

### ✅ Documentation

Created comprehensive guides:
- **HOW-TO-SHARE-DATABASE.md** — Complete step-by-step instructions
- **DATABASE-SEARCH-FIX-v11.0.114.md** — Technical details of fixes

---

## What You Need To Do

### **Immediate Action: Share Database with Integration**

1. **Go to Notion** → Find your database
2. **Click Share** button (top right)
3. **Find your integration** in the access list
   - If not there, click "Invite" and select it
4. **Grant Edit access**
5. **Refresh** the ServiceNow page
6. **Try searching again**

👉 **See**: `HOW-TO-SHARE-DATABASE.md` for detailed instructions

---

## How the Fixed System Works

### Before (v11.0.113)
❌ Generic "not found" message  
❌ Confusing error with full URL shown  
❌ No guidance on what to do

### After (v11.0.116)
✅ URL automatically extracts database ID  
✅ Clear error message with extracted ID  
✅ Step-by-step guidance on sharing database  
✅ Distinguishes permission errors from other issues

### Error Flow

```
User enters URL/ID
        ↓
Extract database ID from URL (if needed)
        ↓
Try to fetch database from Notion
        ↓
ERROR: Permission denied (403) or Not found (404)
        ↓
Show helpful message:
  - Database ID (so you can verify)
  - Step-by-step sharing instructions
  - What permission level needed
```

---

## Testing After You Share

Once you've shared the database:

### Test 1: Using Full URL
```
Search Databases: https://www.notion.so/norton-mcintosh/2b2a89fedba58033a6aeee258611a908?v=...
Expected: ✅ Found database: [Your Database Name]
```

### Test 2: Using Database ID
```
Search Databases: 2b2a89fe-dba5-8033-a6ae-ee258611a908
Expected: ✅ Found database: [Your Database Name]
```

### Test 3: Using Database Name
```
Search Databases: [Part of database name]
Expected: ✅ Found database: [Your Database Name]
```

---

## Files Modified

| File | Version | Changes |
|------|---------|---------|
| `server/routes/databases.cjs` | 11.0.114 | Fixed response format, error handling, cache storage |
| `src/ui/main-panel.js` | 11.0.116 | Improved URL extraction, error messages, guidance |
| **New**: `DATABASE-SEARCH-FIX-v11.0.114.md` | - | Technical documentation |
| **New**: `HOW-TO-SHARE-DATABASE.md` | - | User guide |

---

## Version Timeline

| Version | Changes | Status |
|---------|---------|--------|
| 11.0.113 | Initial version | ⚠️ Generic error messages |
| 11.0.114 | Database fix #1 - response format, error handling | ✅ Improved |
| 11.0.115 | Version bump | - |
| 11.0.116 | Database fix #2 - URL extraction, user guidance | ✅ **CURRENT** |

---

## What to Do Next

### Step 1: Update Your Userscript
- Update to v11.0.116 in Tampermonkey
- Refresh the ServiceNow page

### Step 2: Share Database with Integration
- Follow guide: `HOW-TO-SHARE-DATABASE.md`
- Takes about 2 minutes

### Step 3: Test Search Function
- Use URL, ID, or database name
- Should find your database ✅

### Step 4: Use Normally
- Select the database
- Extract content as usual

---

## Common Issues & Solutions

### "Database not found" message
**Solution**: Database is not shared with integration. See `HOW-TO-SHARE-DATABASE.md` Step 4.

### "No accessible databases found"
**Solution**: No databases are shared yet. Share at least one following the guide.

### Integration doesn't appear in Share menu
**Solution**: Create integration at [notion.so/my-integrations](https://www.notion.so/my-integrations) first.

### Shared database still not working
**Solutions**:
1. Check that integration has "Edit" access (not just "Can Edit")
2. Refresh the ServiceNow page (F5)
3. Check you're in the correct Notion workspace
4. Try a different database as a test

---

## Technical Details

### Why Notion Requires This

This is intentional **security design**:
- Integrations can only access databases you explicitly grant
- Prevents malicious apps from reading all your data
- You control exactly what integrations can see

### How It Works

1. You create an integration and get a token
2. Token identifies "this specific app in this workspace"
3. When app tries to access a database, Notion checks:
   - Is this token valid? ✅
   - Is this database shared with this token? ❌ → Permission denied
4. Sharing a database with the token allows access ✅

### What We Fixed

Previously, when this failed, users got:
- Confusing error message with full URL
- No clear guidance
- No indication of what went wrong

Now users get:
- Clear extracted database ID
- Step-by-step sharing instructions
- Information about permissions needed
- Alternative search methods

---

## Success Indicators

Once working, you'll see:

✅ Database search returns results  
✅ Can select database from dropdown  
✅ Can extract content to Notion  
✅ No more "not found" errors  

---

## Support Resources

**For Setup Help**:
- `HOW-TO-SHARE-DATABASE.md` — Complete step-by-step guide

**For Technical Details**:
- `DATABASE-SEARCH-FIX-v11.0.114.md` — Implementation details

**For Console Debugging**:
- Open browser console (F12)
- Look for `[DATABASE]` prefixed messages
- Share with helpful details if stuck

---

## Conclusion

Your issue is **not a bug** — it's a configuration step that Notion requires for security.

**The good news**: It's a one-time setup!

Once you share your database with the integration, everything will work smoothly.

**Next**: See `HOW-TO-SHARE-DATABASE.md` for step-by-step instructions.

---

*Last updated: December 4, 2025*  
*Current version: 11.0.116*  
*Status: ✅ Fully documented and fixed*
