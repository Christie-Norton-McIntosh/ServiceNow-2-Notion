# Quick Fix Checklist — Database Not Found Error

**Problem**: "No accessible databases found" error  
**Solution Type**: Configuration (not a bug)  
**Time Required**: ~5 minutes  
**Status**: One-time setup

---

## ✅ Pre-Flight Check

- [ ] I'm running v11.0.116 or later (check console or script info)
- [ ] I have a Notion workspace with at least one database
- [ ] I know which database ID I want to use
- [ ] I can log in to my Notion workspace

---

## 🔧 The Fix (5 Steps)

### Step 1: Open Your Database in Notion
- [ ] Go to [notion.so](https://notion.so)
- [ ] Log in if needed
- [ ] Navigate to the database you want to use
- [ ] Copy the database ID from the URL (middle part)

### Step 2: Access Share Settings
- [ ] Click the **"Share"** button (top right corner)
- [ ] A menu should appear with sharing options

### Step 3: Find Your Integration
- [ ] Look for "My connections" or integration dropdown
- [ ] Click "Invite" or "Add" button
- [ ] Search for your integration name:
  - Default: "ServiceNow-2-Notion"
  - Or whatever you named it
  - **Not sure?** Go to [notion.so/my-integrations](https://www.notion.so/my-integrations) to find the name

### Step 4: Grant Permission
- [ ] Select your integration from the list
- [ ] Choose permission level: **"Edit"** (recommended)
- [ ] Click **"Invite"** or **"Confirm"**
- [ ] Your integration should now appear in the Share list

### Step 5: Verify & Test
- [ ] Close Notion (or minimize browser)
- [ ] Go back to ServiceNow page
- [ ] Refresh the page (F5 or Cmd+R)
- [ ] Click "Search Databases"
- [ ] Try searching with:
  - [ ] Full URL: `https://www.notion.so/.../database-id...`
  - [ ] Database ID: `2b2a89fe-dba5-8033-a6ae-ee258611a908`
  - [ ] Database name: `[Part of name]`

---

## 🎯 Expected Results

### ✅ Success Indicators
- [ ] Search returns database name
- [ ] Message shows: "✅ Found database: [Name]"
- [ ] Database selected in dropdown
- [ ] Can now extract content

### ❌ Still Not Working?
- [ ] Double-check integration name in Share menu
- [ ] Verify integration has "Edit" access (not just invited)
- [ ] Refresh page again (sometimes takes a moment)
- [ ] Try searching with database name instead of ID
- [ ] Check that you're in correct Notion workspace

---

## 🚨 Troubleshooting

### Integration Not in Share Menu?

**Problem**: Can't find your integration when trying to invite it

**Solutions**:
1. [ ] Create integration if you don't have one: [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. [ ] Make sure you're in the right Notion workspace
3. [ ] Sign out of Notion and sign back in
4. [ ] Try creating a test database and sharing with integration

### "Still Not Found" After Sharing?

**Problem**: Shared the database but still getting error

**Solutions**:
1. [ ] Refresh ServiceNow page (F5)
2. [ ] Close and reopen browser
3. [ ] Check integration name is spelled exactly right
4. [ ] Verify integration appears in Share list with "Edit" permission
5. [ ] Try database name instead of URL/ID

### Integration Invited But Not Confirmed?

**Problem**: Integration shows as "Invited" but not active

**Solutions**:
1. [ ] Click on the integration in the Share list
2. [ ] Look for "Accept" or "Confirm" button
3. [ ] If using API token, the invitation might auto-accept
4. [ ] Wait a moment and refresh

### Only One Integration Available?

**Problem**: Only one integration type appears in the Share menu

**Solutions**:
1. [ ] You may have only created one integration (that's okay!)
2. [ ] Make sure it's the right one (check [my-integrations](https://www.notion.so/my-integrations))
3. [ ] If using a shared integration, ask workspace admin to add it
4. [ ] Create new integration if needed

---

## 💡 Common Questions

**Q: Why does this require sharing?**  
A: Security feature. Prevents apps from reading all your databases.

**Q: Do I need to share every database?**  
A: No, just the ones you want to extract to. One-time setup per database.

**Q: Can I share multiple databases?**  
A: Yes! Share as many as you need with the same integration.

**Q: What permission level do I need?**  
A: "Edit" minimum (allows creating pages). "Read" won't work.

**Q: Will this work with database names?**  
A: Yes! You can search by name instead of URL/ID.

**Q: How long does it take?**  
A: Usually instant, but can take up to 1 minute for Notion to propagate.

---

## 📚 Need More Help?

| Document | Purpose |
|----------|---------|
| **HOW-TO-SHARE-DATABASE.md** | Detailed step-by-step with images |
| **DATABASE-SEARCH-SOLUTION.md** | Complete solution overview |
| **DATABASE-SEARCH-FIX-v11.0.114.md** | Technical implementation details |

---

## ✨ Success! 

Once you see ✅ **"Found database: [Your Database Name]"**, you're all set!

**Next**: Use the database selector to choose which database to extract to.

---

## 🔄 Quick Ref: What Gets Shared?

| Item | Gets Shared | Reason |
|------|-------------|--------|
| Integration name | ✅ Yes | Identifies the app |
| Integration token | ❌ No | Stays secret (hidden) |
| Database content | ✅ Yes | Integration can read/create |
| Your account | ❌ No | Integration is separate entity |
| Other databases | ❌ No | Only ones you explicitly share |

---

## 📞 Still Stuck?

1. **Check browser console** (F12 → Console tab)
2. **Look for `[DATABASE]` prefix** in logs
3. **Share the error message** (redact personal URLs)
4. **Include**:
   - Database ID (first 8 chars only)
   - Integration name
   - Error message from screen

---

*Last Updated: December 4, 2025*  
*Version: 11.0.116*  
*Status: ✅ Ready to use*
