#!/usr/bin/env node
/**
 * Diagnostic script to troubleshoot database access issues
 * 
 * Usage: node diagnose-database-access.cjs <database-id>
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { Client } = require('@notionhq/client');

const dbId = process.argv[2];
if (!dbId) {
  console.error('❌ Please provide a database ID as argument');
  console.error('Usage: node diagnose-database-access.cjs <database-id>');
  process.exit(1);
}

const token = process.env.NOTION_TOKEN;
if (!token) {
  console.error('❌ NOTION_TOKEN not found in .env');
  process.exit(1);
}

console.log('\n🔍 Database Access Diagnostics\n');
console.log(`Database ID: ${dbId}`);
console.log(`Token: ${token.substring(0, 20)}...${token.substring(token.length - 4)}`);
console.log('');

// Initialize Notion client
const notion = new Client({ auth: token });

// Normalize database ID (add hyphens if missing)
function hyphenateId(id) {
  const clean = id.replace(/-/g, '');
  if (clean.length !== 32) {
    console.error(`❌ Invalid ID length: ${clean.length} (expected 32)`);
    process.exit(1);
  }
  return clean.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
}

const hyphenatedId = hyphenateId(dbId);
console.log(`Hyphenated ID: ${hyphenatedId}\n`);

async function runDiagnostics() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Test 1: Try to retrieve database directly
  console.log('Test 1: Direct database retrieval');
  console.log('─────────────────────────────────');
  try {
    const db = await notion.databases.retrieve({ database_id: hyphenatedId });
    console.log('✅ SUCCESS: Database is accessible!');
    console.log(`   Title: ${db.title?.[0]?.plain_text || 'Untitled'}`);
    console.log(`   URL: ${db.url}`);
    console.log(`   Properties: ${Object.keys(db.properties || {}).length} properties`);
    console.log(`   Created: ${db.created_time}`);
    console.log(`   Last edited: ${db.last_edited_time}`);
    console.log('\n✨ The database IS shared with your integration!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return true;
  } catch (error) {
    console.log('❌ FAILED: Cannot access database directly');
    console.log(`   Status: ${error.status || 'unknown'}`);
    console.log(`   Code: ${error.code || 'unknown'}`);
    console.log(`   Message: ${error.message || 'unknown'}`);
    
    if (error.status === 404) {
      console.log('\n💡 404 means: Database not found OR not shared');
    } else if (error.status === 403) {
      console.log('\n💡 403 means: Permission denied (definitely not shared)');
    } else if (error.code === 'unauthorized') {
      console.log('\n💡 Unauthorized means: Invalid token or integration');
    }
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 2: Search for all accessible databases
  console.log('Test 2: List all accessible databases');
  console.log('─────────────────────────────────────────');
  try {
    const searchResults = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 100
    });

    const databases = searchResults.results || [];
    console.log(`✅ Found ${databases.length} accessible database(s):\n`);

    databases.forEach((db, idx) => {
      const title = db.title?.[0]?.plain_text || 'Untitled';
      const id = db.id;
      const isTarget = id.replace(/-/g, '') === hyphenatedId.replace(/-/g, '');
      console.log(`${idx + 1}. ${isTarget ? '🎯 ' : '   '}${title}`);
      console.log(`   ID: ${id}${isTarget ? ' ← TARGET DATABASE' : ''}`);
      console.log(`   URL: ${db.url}`);
      console.log('');
    });

    const targetFound = databases.some(db => db.id.replace(/-/g, '') === hyphenatedId.replace(/-/g, ''));
    
    if (targetFound) {
      console.log('✅ Target database IS in the accessible list!');
      console.log('   This is strange - it should have worked in Test 1.\n');
      console.log('   Possible causes:');
      console.log('   - API caching issue (try again in a few seconds)');
      console.log('   - Different integration token used by server');
      console.log('   - Database ID mismatch\n');
    } else {
      console.log('❌ Target database NOT in the accessible list');
      console.log('\n📋 Troubleshooting steps:');
      console.log('   1. Double-check the database ID is correct');
      console.log('   2. Verify you\'re in the right Notion workspace');
      console.log('   3. Open the database in Notion');
      console.log('   4. Click "Share" button (top right)');
      console.log('   5. Look for your integration in the connections');
      console.log('   6. If not there, click "Invite" and add it');
      console.log('   7. Ensure permission is "Edit" (not just "Read")');
      console.log('   8. Wait 10-30 seconds for Notion to sync');
      console.log('   9. Run this script again\n');
    }

    if (databases.length === 0) {
      console.log('⚠️  No databases are currently shared with this integration!');
      console.log('   You need to share at least one database to use the integration.\n');
    }

  } catch (error) {
    console.log('❌ FAILED to list databases');
    console.log(`   Error: ${error.message}`);
    console.log('');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 3: Verify token and integration info
  console.log('Test 3: Integration verification');
  console.log('─────────────────────────────────');
  try {
    // Try to get bot info (this works even without database access)
    const me = await notion.users.me();
    console.log('✅ Integration token is valid');
    console.log(`   Type: ${me.type}`);
    console.log(`   Bot: ${me.bot?.owner?.type || 'unknown'}`);
    console.log(`   Workspace: ${me.bot?.workspace_name || 'unknown'}`);
    console.log('');
  } catch (error) {
    console.log('❌ FAILED to verify integration');
    console.log(`   Error: ${error.message}`);
    console.log('   This suggests the NOTION_TOKEN might be invalid.\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  return false;
}

runDiagnostics()
  .then(success => {
    if (success) {
      console.log('✨ All tests passed! The database is accessible.\n');
      process.exit(0);
    } else {
      console.log('❌ Some tests failed. Review the output above.\n');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });
