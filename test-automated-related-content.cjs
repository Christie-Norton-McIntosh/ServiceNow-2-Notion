#!/usr/bin/env node

/**
 * Automated Related Content Extraction Test
 * Tests Related Content extraction from HTML fixtures
 */

const fs = require('fs');
const path = require('path');

// Expected Related Content links that should appear
const EXPECTED_LINKS = [
  'Procurement roles',
  'Procurement workflows',
  'Use the Procurement Overview module',
  'Sourcing items in a service catalog request',
  'Procurement purchase order management for assets',
  'Receive assets',
  'Domain separation and Procurement'
];

class RelatedContentTester {
  constructor() {
    this.log('🚀 Starting Related Content Extraction Test');
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async testExtraction(htmlContent) {
    this.log('Testing extraction with server...');

    const axios = require('axios');

    try {
      const response = await axios.post('http://localhost:3004/api/W2N', {
        title: 'Related Content Test',
        databaseId: process.env.NOTION_TEST_DATABASE_ID,
        contentHtml: htmlContent,
        dryRun: true // Don't create actual page, just return blocks
      });

      const { children } = response.data;

      // Find Related Content heading
      const relatedHeading = children.find(block =>
        block.type === 'heading_5' &&
        block.heading_5?.rich_text?.[0]?.plain_text?.toLowerCase().includes('related content')
      );

      if (!relatedHeading) {
        this.log('❌ No Related Content heading found');
        return { success: false, foundLinks: [] };
      }

      // Get the index and find subsequent bulleted list items
      const headingIndex = children.indexOf(relatedHeading);
      const foundLinks = [];

      for (let i = headingIndex + 1; i < children.length; i++) {
        const block = children[i];
        if (block.type === 'bulleted_list_item') {
          const text = block.bulleted_list_item?.rich_text?.[0]?.plain_text || '';
          if (text) foundLinks.push(text);
        } else if (foundLinks.length > 0) {
          break; // Stop after the list
        }
      }

      this.log(`Found ${foundLinks.length} links: ${foundLinks.join(', ')}`);

      // Check for expected links
      const missingLinks = EXPECTED_LINKS.filter(expected =>
        !foundLinks.some(found => found.includes(expected))
      );

      if (missingLinks.length === 0) {
        this.log('✅ SUCCESS: All expected Related Content links found!');
        return { success: true, foundLinks };
      } else {
        this.log(`❌ Missing links: ${missingLinks.join(', ')}`);
        return { success: false, foundLinks, missingLinks };
      }

    } catch (error) {
      this.log(`❌ Test failed: ${error.response?.data?.error || error.message}`);
      return { success: false, error: error.message };
    }
  }

  async run() {
    // Check environment
    if (!process.env.NOTION_TEST_DATABASE_ID) {
      this.log('❌ NOTION_TEST_DATABASE_ID environment variable not set');
      process.exit(1);
    }

    // Load HTML fixture
    const fixturePath = path.join(__dirname, 'tests', 'fixtures', 'activate-procurement-with-placeholders.html');
    let htmlContent;

    try {
      htmlContent = fs.readFileSync(fixturePath, 'utf8');
      this.log(`Loaded HTML fixture (${htmlContent.length} chars)`);
    } catch (error) {
      this.log(`❌ Failed to load HTML fixture: ${error.message}`);
      process.exit(1);
    }

    // Test extraction
    const result = await this.testExtraction(htmlContent);

    if (result.success) {
      this.log('🎉 Test passed!');
      process.exit(0);
    } else {
      this.log('💥 Test failed - Related Content extraction not working correctly');
      process.exit(1);
    }
  }
}

// Run the test
const tester = new RelatedContentTester();
tester.run().catch(error => {
  console.error('Test crashed:', error);
  process.exit(1);
});