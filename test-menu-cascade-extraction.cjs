#!/usr/bin/env node

/**
 * Test Script: Menu Cascade Fix with Real Extraction
 * 
 * This script tests the menu cascade fix by extracting content from
 * the "Script includes and customization" page HTML
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SERVER_URL = 'http://localhost:3004';
const TEST_HTML_FILE = '/Users/norton-mcintosh/GitHub/ServiceNow-2-Notion/patch/pages/page-not-found/script-includes-and-customization-content-validation-failed-2025-12-06T06-42-41.html';

console.log(`
╔════════════════════════════════════════════════════════════════╗
║  MENU CASCADE FIX TEST - Real Extraction                       ║
╚════════════════════════════════════════════════════════════════╝
`);

async function testMenuCascadeFix() {
  try {
    // Read the HTML file
    if (!fs.existsSync(TEST_HTML_FILE)) {
      console.error(`❌ ERROR: Test HTML file not found: ${TEST_HTML_FILE}`);
      process.exit(1);
    }
    
    const html = fs.readFileSync(TEST_HTML_FILE, 'utf-8');
    console.log(`\n📄 Loaded HTML file (${html.length} bytes)`);
    
    // Check if HTML contains menu cascades
    const menuCascadeCount = (html.match(/<span[^>]*class="[^"]*menucascade/g) || []).length;
    const abbrCount = (html.match(/<abbr[^>]*>/g) || []).length;
    
    console.log(`   Found ${menuCascadeCount} menu cascade elements`);
    console.log(`   Found ${abbrCount} abbreviation elements`);
    
    if (menuCascadeCount === 0 && abbrCount === 0) {
      console.warn(`⚠️  WARNING: HTML doesn't contain menu cascades or abbreviations`);
    }
    
    // Test extraction with PATCH (supports dryRun)
    console.log(`\n🚀 Calling PATCH /api/W2N/:pageId with dryRun=true...`);
    
    // Use a test page ID (32-char UUID format, doesn't need to exist for dryRun)
    const testPageId = '12345678901234567890123456789012';
    
    const response = await axios.patch(`${SERVER_URL}/api/W2N/${testPageId}`, {
      title: 'Test: Script Includes and Customization',
      contentHtml: html,
      dryRun: true  // Don't actually update page
    }, {
      timeout: 30000
    });
    
    const { children, hasVideos } = response.data;
    
    console.log(`\n✅ Extraction completed successfully!`);
    console.log(`   Total blocks: ${children ? children.length : 0}`);
    console.log(`   Has videos: ${hasVideos}`);
    
    // Count block types
    const blockTypeCounts = {};
    if (children) {
      for (const block of children) {
        const type = block.type;
        blockTypeCounts[type] = (blockTypeCounts[type] || 0) + 1;
      }
      
      console.log(`\n📊 Block type breakdown:`);
      for (const [type, count] of Object.entries(blockTypeCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${type}: ${count}`);
      }
    }
    
    // Look for menu cascade content in blocks
    console.log(`\n🔍 Searching for menu cascade content in extracted blocks...`);
    let foundMenuCascadeContent = false;
    
    if (children) {
      for (const block of children) {
        if (!block[block.type]) continue;
        
        const richText = block[block.type].rich_text;
        if (!Array.isArray(richText)) continue;
        
        for (const rt of richText) {
          if (rt.text && rt.text.content) {
            const text = rt.text.content;
            
            // Look for menu path patterns like "X > Y"
            if (text.includes('>') && (
              text.includes('Self Service') ||
              text.includes('File') ||
              text.includes('System') ||
              text.includes('Edit')
            )) {
              console.log(`   ✅ Found menu cascade content: "${text.substring(0, 80)}..."`);
              foundMenuCascadeContent = true;
            }
          }
        }
      }
    }
    
    if (!foundMenuCascadeContent && menuCascadeCount > 0) {
      console.log(`   ⚠️  No menu cascade content found in extracted blocks`);
    }
    
    console.log(`\n✨ Test completed!`);
    return true;
    
  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);
    if (error.response) {
      console.error(`   Response status: ${error.response.status}`);
      console.error(`   Response data:`, error.response.data);
    }
    return false;
  }
}

testMenuCascadeFix().then(success => {
  process.exit(success ? 0 : 1);
});
