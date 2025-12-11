# How to Share a Database with Your Notion Integration — v11.0.116

**Date**: December 4, 2025  
**Version**: 11.0.116  
**Issue**: Database not found or not accessible error

---

## Problem You're Seeing

When you try to search for a database using a URL or ID, you get:

```
Database "https://www.notion.so/norton-mcintosh/2b2a89fedba58033a6aeee258611a908?..." not found.
No accessible databases found. Make sure at least one database is shared with your Notion integration.
```

**Root Cause**: Your Notion integration doesn't have access to any databases. They need to be explicitly shared with the integration token/bot.

---

## Solution: Share Your Database with the Integration

### Step-by-Step Instructions

#### **Step 1: Identify Your Integration**
First, you need to know what your Notion integration is called. This is typically:
- A "bot" or "integration" name you created
- Often named something like "ServiceNow-2-Notion" or similar
- Check your Notion workspace settings → Integrations

#### **Step 2: Open the Database in Notion**
1. Go to [notion.so](https://notion.so) and sign in
2. Find the database you want to share (the one with ID: `2b2a89fedba58033a6aeee258611a908`)
3. Open it

#### **Step 3: Open Database Permissions**
1. Click the **"Share"** button (top right corner of the database)
2. Look for a **"Share"** or **"Add people"** section

#### **Step 4: Add Your Integration**
1. In the Share menu, click **"Invite"** or **"Add"**
2. Look for your integration/bot name in the dropdown
3. Select it
4. Choose the permission level:
   - **Edit** (recommended) - allows reading and creating/updating content
   - **Read** - only allows reading, won't allow creating pages
5. Click **"Invite"**

#### **Step 5: Confirm Access**
1. Close the Share menu
2. Your integration should now appear in the access list
3. The database is now shared with your integration!

---

## Verify It's Working

### Method 1: Test the URL Again
1. In ServiceNow, click **"Search Databases"**
2. Paste your database URL: `https://www.notion.so/norton-mcintosh/2b2a89fedba58033a6aeee258611a908?v=...`
3. Should now show: ✅ Database found and loaded

### Method 2: Test the Database ID
1. Click **"Search Databases"**
2. Paste just the ID: `2b2a89fe-dba5-8033-a6ae-ee258611a908` (or without hyphens)
3. Should find the database

### Method 3: Test by Name
1. Click **"Search Databases"**
2. Enter part of the database name
3. Should find it in the list

---

## Troubleshooting

### Still Getting "Not Found" Error?

**Check 1: Is the integration actually in the Share list?**
- Go back to the database
- Click Share
- Look for your integration name
- If it's not there, repeat Step 4

**Check 2: Do you need to restart?**
- Close the ServiceNow page
- Refresh (F5 or Cmd+R)
- Try again

**Check 3: Is the integration name exactly right?**
- Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
- Find your integration
- Copy the exact name
- Go back to the database and search again with the correct name

**Check 4: Does the integration have the right permissions?**
- Click Share on the database
- Make sure your integration has at least "Edit" access (not just invited)
- If it shows as "Invited" but not confirmed, click on it and confirm the invitation

### "No accessible databases found" Message

This means **zero** databases are shared with your integration.

**Solutions**:
1. Make sure you've followed Step 1-5 above for at least one database
2. Try a different database as a test
3. Check that you're sharing with the correct integration (copy-paste the name from My Integrations)

### "Database ID: 2b2a89fedba58033a6aeee258611a908 - This database is not accessible"

This means:
- The ID is correct ✅
- The database exists ✅
- But it's NOT shared with your integration ❌

**Solution**: Follow Step 4 again - share this specific database with the integration

---

## Advanced: What's a "Notion Integration"?

A Notion integration is a bot/application that can access your Notion workspace. When you create an integration:
- It gets a unique token/ID
- You control what permissions it has
- You share databases with it just like you'd share with a person
- It acts as an "account" within your Notion workspace

Your ServiceNow-2-Notion userscript uses this integration to:
- Read pages from ServiceNow
- Create/update pages in Notion
- Query your databases

---

## Common Integration Names

If you're not sure what your integration is called, it might be:
- "ServiceNow-2-Notion"
- "ServiceNow to Notion"
- "SN2N"
- The name you gave it when creating it
- Or check [notion.so/my-integrations](https://www.notion.so/my-integrations)

---

## Can't Find Your Integration?

If you don't see your integration listed when trying to share:

1. **Did you create it?** 
   - Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
   - Create a new integration if you don't have one

2. **Is it in a different Notion workspace?**
   - You can only access databases from the workspace where the integration was created
   - Make sure you're in the right workspace

3. **Does the database exist?**
   - Make sure the database URL is from the same Notion workspace
   - Try accessing it manually first

---

## Still Need Help?

If you're still having issues after following these steps:

1. **Check the browser console** (F12 or Cmd+Option+I)
2. Look for `[DATABASE]` logs
3. Share the error message (redact any personal URLs/IDs)
4. Include:
   - The database ID you're trying to use
   - The name of your integration
   - Whether the integration is listed in the database's Share list

---

## Quick Checklist

Before reporting an issue, verify:

- [ ] I have created a Notion integration
- [ ] The database exists in my Notion workspace
- [ ] I can access the database manually in Notion
- [ ] I opened the database in Notion
- [ ] I clicked the "Share" button
- [ ] I invited my integration to the database
- [ ] My integration appears in the Share list with Edit access
- [ ] I refreshed the ServiceNow page after sharing
- [ ] I tried searching with the database URL
- [ ] I tried searching with the database ID
- [ ] I tried searching with the database name

---

## Success!

Once a database is properly shared, you should see:

✅ **"Found database: [Database Name]"**  
✅ **Database selected and ready to use**  
✅ **Can now extract content to this database**

Happy extracting! 🎉
