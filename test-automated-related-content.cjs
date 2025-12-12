#!/usr/bin/env node

console.log('🚀 Starting test script...');

/**
 * Automated Related Content Extraction Test
 * Tests Related Content extraction from HTML fixtures
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
    this.log('🚀 Starting Related Content End-to-End Test');
    this.maxRetries = 1; // Just one attempt for testing
    this.retryDelay = 500; // 0.5 seconds
  }

  log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }

  async createAndVerifyPage() {
    this.log('Creating/updating Notion page and verifying Related Content...');

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

    const databaseId = process.env.NOTION_TEST_DATABASE_ID || '2c2a89fe-dba5-80f3-ac4c-f654255a43dc'; // Real database ID for testing

    let attempt = 0;
    let pageId = null;

    while (attempt < this.maxRetries) {
      attempt++;
      this.log(`🔄 Attempt ${attempt}/${this.maxRetries}: Creating/updating page...`);

      try {
        // Create/update the page (not dryRun)
        const createResponse = await axios.post(`http://localhost:3004/api/W2N`, {
          title: `Related Content Test - Attempt ${attempt}`,
          databaseId: databaseId,
          contentHtml: htmlContent,
          dryRun: false // Actually create the page
        });

        if (createResponse.data && (createResponse.data.pageId || (createResponse.data.data && createResponse.data.data.page && createResponse.data.data.page.id))) {
          pageId = createResponse.data.pageId || createResponse.data.data.page.id;
          this.log(`✅ Page created/updated: ${pageId}`);
        } else {
          this.log(`❌ No pageId in response: ${JSON.stringify(createResponse.data)}`);
          continue;
        }

        // Wait a moment for Notion to process
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verify the page content
        const verificationResult = await this.verifyPageContent(pageId);
        if (verificationResult.success) {
          this.log(`🎉 SUCCESS on attempt ${attempt}! Related Content found in Notion page`);
          return { success: true, pageId, attempt };
        } else {
          this.log(`❌ Attempt ${attempt} failed: ${verificationResult.error}`);
          if (attempt < this.maxRetries) {
            this.log(`⏳ Waiting ${this.retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, this.retryDelay));
          }
        }

      } catch (error) {
        this.log(`❌ Attempt ${attempt} failed with error: ${error.response?.data?.error || error.message}`);
        if (attempt < this.maxRetries) {
          this.log(`⏳ Waiting ${this.retryDelay}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        }
      }
    }

    this.log(`💥 FAILED: Could not verify Related Content after ${this.maxRetries} attempts`);
    return { success: false, pageId, attempt: this.maxRetries };
  }

  async verifyPageContent(pageId) {
    try {
      // Get the page content from Notion API
      const notionToken = process.env.NOTION_TOKEN;
      if (!notionToken) {
        return { success: false, error: 'NOTION_TOKEN not set' };
      }

      const response = await axios.get(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Notion-Version': '2022-06-28'
        }
      });

      const blocks = response.data.results;
      this.log(`📄 Retrieved ${blocks.length} blocks from Notion page`);

      // Find Related Content heading
      const relatedHeading = blocks.find(block =>
        block.type === 'heading_3' &&
        block.heading_3?.rich_text?.[0]?.text?.content?.toLowerCase().includes('related content')
      );

      if (!relatedHeading) {
        return { success: false, error: 'No Related Content heading found' };
      }

      // Get the index and find subsequent bulleted list items
      const headingIndex = blocks.indexOf(relatedHeading);
      const foundLinks = [];

      for (let i = headingIndex + 1; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.type === 'bulleted_list_item') {
          const text = block.bulleted_list_item?.rich_text?.[0]?.text?.content || '';
          if (text) foundLinks.push(text);
        } else if (block.type !== 'paragraph') {
          // Stop when we hit something that's not a bulleted item or description paragraph
          break;
        }
      }

      this.log(`🔗 Found ${foundLinks.length} links in Notion: ${foundLinks.join(', ')}`);

      // Check for expected links
      const missingLinks = EXPECTED_LINKS.filter(expected =>
        !foundLinks.some(found => found.includes(expected))
      );

      if (missingLinks.length === 0) {
        return { success: true, foundLinks };
      } else {
        return { success: false, error: `Missing links: ${missingLinks.join(', ')}` };
      }

    } catch (error) {
      return { success: false, error: `API error: ${error.response?.data?.message || error.message}` };
    }
  }

  async run() {
    // Create and verify page with retries
    const result = await this.createAndVerifyPage();

    if (result.success) {
      this.log(`🎉 Test passed after ${result.attempt} attempts! Page ID: ${result.pageId}`);
      process.exit(0);
    } else {
      this.log(`💥 Test failed after ${result.attempt} attempts - Related Content not found in Notion page`);
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