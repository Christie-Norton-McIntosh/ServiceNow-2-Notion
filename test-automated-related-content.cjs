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
    this.log('Testing extraction using PATCH dryRun...');

    const axios = require('axios');

    try {
      // Use PATCH with dryRun to test extraction without creating/updating a real page
      // Use a dummy page ID since dryRun doesn't actually access the page
      const dummyPageId = '12345678-1234-1234-1234-123456789012';
      
      const response = await axios.patch(`http://localhost:3004/api/W2N/${dummyPageId}`, {
        title: 'Related Content Test',
        contentHtml: htmlContent,
        dryRun: true // Return extracted blocks without updating page
      });

      this.log(`Response status: ${response.status}`);
      this.log(`Response data keys: ${Object.keys(response.data).join(', ')}`);
      if (response.data.data) {
        this.log(`Response data.data keys: ${Object.keys(response.data.data).join(', ')}`);
      }
      
      const { children } = response.data.data || response.data;

      // Find Related Content heading (it's heading_3, not heading_5)
      const relatedHeading = children.find(block =>
        block.type === 'heading_3' &&
        block.heading_3?.rich_text?.[0]?.text?.content?.toLowerCase().includes('related content')
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
          const text = block.bulleted_list_item?.rich_text?.[0]?.text?.content || '';
          if (text) foundLinks.push(text);
        } else if (block.type !== 'paragraph') {
          // Stop when we hit something that's not a bulleted item or description paragraph
          break;
        }
        // Continue through paragraphs (they're descriptions for the links)
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