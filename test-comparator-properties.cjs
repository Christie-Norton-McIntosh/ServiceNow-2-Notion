#!/usr/bin/env node
/**
 * Test script to verify that getDetailedTextComparison properly populates
 * Coverage, MissingCount, MissingSpans, Status, Method, LastChecked, RunId properties
 */

require('dotenv').config({ path: require('path').join(__dirname, 'server', '.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function testComparatorProperties() {
  console.log('\n🧪 Testing Comparator Property Population');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  // Pick a test page from pages-to-update
  const pagesDir = path.join(__dirname, 'patch/pages/pages-to-update');
  const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));
  
  if (files.length === 0) {
    console.log('❌ No HTML files found in pages-to-update');
    return;
  }
  
  // Use the first file
  const testFile = files[0];
  const testFilePath = path.join(pagesDir, testFile);
  console.log(`📄 Test file: ${testFile}`);
  
  // Read HTML content
  const htmlContent = fs.readFileSync(testFilePath, 'utf-8');
  
  // Extract page ID from HTML comment
  const pageIdMatch = htmlContent.match(/Page ID:\s*([a-f0-9-]+)/i);
  if (!pageIdMatch) {
    console.log('❌ Could not find Page ID in HTML file');
    return;
  }
  
  const pageId = pageIdMatch[1];
  console.log(`🆔 Page ID: ${pageId}`);
  
  // Extract title
  const titleMatch = htmlContent.match(/Page Title:\s*(.+)/i);
  const title = titleMatch ? titleMatch[1].trim() : 'Test Page';
  console.log(`📝 Title: ${title}`);
  
  // Extract HTML content (remove comment block)
  const htmlBodyStart = htmlContent.indexOf('-->');
  const html = htmlBodyStart >= 0 ? htmlContent.substring(htmlBodyStart + 3).trim() : htmlContent;
  
  console.log(`📏 HTML length: ${html.length} chars\n`);
  
  // Send PATCH request
  console.log('🔄 Sending PATCH request to server...');
  try {
    const response = await axios.patch(`http://localhost:3004/api/W2N/${pageId}`, {
      title,
      contentHtml: html,
      url: 'https://www.servicenow.com/test'
    });
    
    console.log('✅ PATCH successful\n');
    
    // Wait a moment for properties to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Fetch page to verify properties
    console.log('🔍 Fetching page properties...');
    const page = await notion.pages.retrieve({ page_id: pageId });
    
    console.log('\n📊 Comparator Property Values:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    const propsToCheck = ['Coverage', 'MissingCount', 'MissingSpans', 'Status', 'Method', 'LastChecked', 'RunId'];
    
    propsToCheck.forEach(propName => {
      const prop = page.properties[propName];
      if (!prop) {
        console.log(`${propName}: ❌ (property doesn't exist)`);
        return;
      }
      
      console.log(`${propName}:`);
      console.log(`  Type: ${prop.type}`);
      
      if (prop.type === 'number' && prop.number !== null) {
        console.log(`  Value: ${prop.number}`);
      } else if (prop.type === 'rich_text' && prop.rich_text.length > 0) {
        const text = prop.rich_text.map(t => t.plain_text).join('');
        console.log(`  Value: ${text.substring(0, 150)}${text.length > 150 ? '...' : ''}`);
      } else if (prop.type === 'select' && prop.select) {
        console.log(`  Value: ${prop.select.name}`);
      } else if (prop.type === 'checkbox') {
        console.log(`  Value: ${prop.checkbox}`);
      } else if (prop.type === 'date' && prop.date) {
        console.log(`  Value: ${prop.date.start}`);
      } else {
        console.log(`  Value: ❌ (empty/null)`);
      }
      console.log('');
    });
    
    // Check if all properties were populated
    const allPopulated = propsToCheck.every(propName => {
      const prop = page.properties[propName];
      if (!prop) return false;
      
      if (prop.type === 'number') return prop.number !== null;
      if (prop.type === 'rich_text') return prop.rich_text.length > 0;
      if (prop.type === 'select') return prop.select !== null;
      if (prop.type === 'date') return prop.date !== null;
      
      return false;
    });
    
    if (allPopulated) {
      console.log('✅ SUCCESS: All comparator properties were populated!');
    } else {
      console.log('⚠️ WARNING: Some comparator properties are still empty');
    }
    
  } catch (error) {
    console.log(`❌ PATCH failed: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data: ${JSON.stringify(error.response.data).substring(0, 500)}`);
    }
  }
}

testComparatorProperties().catch(console.error);
