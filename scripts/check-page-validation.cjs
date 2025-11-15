#!/usr/bin/env node
/**
 * Check validation errors for a list of Notion pages
 * Usage: node scripts/check-page-validation.cjs
 */

const { Client } = require('@notionhq/client');
require('dotenv').config({ path: require('path').join(__dirname, '../server/.env') });

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// List of page IDs extracted from the URLs
const pageIds = [
  '2aaa89fedba58115936cc71b949d5d5c', // End a conference call from major incident
  '2aaa89fedba581c48906ed3b45a97945', // Performance overview
  '2aaa89fedba5818baf46d77cf296f891', // Similar Demands
  '2aaa89fedba5818da82cc7630b2c160b', // Similar Business Applications
  '2aaa89fedba581a4a980cc876a07ba7f', // Vendor KPI Groups
  '2aaa89fedba5817b98a7fe0cf7b95eb6', // Add targets for vendor score KPIs
  '2aaa89fedba581d0bb2ddd58f9841200', // Set up table attributes
  '2aaa89fedba58179808dfc462304d921', // Create a service credit
  '2aaa89fedba58198beeaf653046eae41', // Train the similarity model
  '2aaa89fedba5812b808acfb90f948a67', // Create target for the KPI
  '2a9a89fedba581bf82e7dabe4bf38080', // Cancel a Universal Request
  '2a9a89fedba58104bfc5e66199b9f88d', // Create a Universal Request
  '2a9a89fedba58106850ddca8a5f31728', // Universal Request
  '2a9a89fedba58142a8facd661480fdfd', // Computer Telephony Integration
  '2a9a89fedba581d88d33c93e714ee15d', // On-call support for an incident
  '2a9a89fedba58171b6f0e9d103aa4677', // Create and edit shift
  '2a9a89fedba58154a5eae1c4ea95d366', // Manage your work and schedule absence
  '2a9a89fedba581578066e75d31378a97', // Managing a major incident record
  '2a9a89fedba581f3887edae4b8352334', // Major Incident Management
  '2a9a89fedba5810ea8c3e24f30c511ff', // Knowledge Management
  '2a9a89fedba581d89ec2fef36e56c18a', // Conduct a CAB meeting
  '2a9a89fedba581758f76dd9da46a3219', // Create a CAB definition
  '2a9a89fedba58184bf4cc8cf9b02a485', // Create a change request
  '2a9a89fedba581619a71c2c79c193d44', // Features of the Investigation tab
  '2a9a89fedba58138ad34fcd0f606b308', // Close resolved incident
  '2a9a89fedba581a391bae7ce7f71fe2c', // View and update incident information
  '2a9a89fedba5815a80a4fccebedf500f', // Create an incident in SOW
  '2a9a89fedba5815aa083e48081b66c27', // Setting up AI Search
  '2a9a89fedba581ac8b57f07a430de7fb', // Configure remedial actions
  '2a9a89fedba5819c9f23d6fbd52d7540', // Create a problem model
  '2a9a89fedba581279dfce67e6659ad29', // Assign a playbook to MIM
  '2a9a89fedba58192aa5be507b5e4ae03', // Configure a communication plan
  '2a9a89fedba581ccacccc97f9c622d39', // Configure a communications template for SMS
  '2a9a89fedba581babcd0d878b535790d', // Perform post-migration tasks
  '2a9a89fedba5815f8350dca1b45e2d79', // Migration of highlighted fields
  '2a9a89fedba581be8213fc756a2868c4', // Migration of view rules
  '2a9a89fedba581b8a4bcf25f29e1d785', // Migration of UI actions
  '2a9a89fedba581b28abde0bdecc6e453', // Exploring Recommended Actions
  '2a9a89fedba581568164c8e81375b778', // Create a known error article
  '2a8a89fedba58132b34bc945cf540ca4', // Enable users to subscribe
  '2a8a89fedba581c7b8f0e53d173cc371', // Analyze sentiments
  '2a8a89fedba581b787fcd3b445784238', // Ask questions about an incident
  '2a8a89fedba58108a7e6f277b2efb33f', // Generate a knowledge article
  '2a8a89fedba581ca9d87ec66f8d644a9', // Explain the risk of a change request
  '2a8a89fedba581d8afa0c8bd63a5065f', // Manage Microsoft 365 group members
  '2a8a89fedba5818abe0fd1e89bb55bc0', // Wrap-up and resolve incident
  '2a8a89fedba581218d89cc93a9ad4109', // Customize a Now Assist skill
  '2a8a89fedba581be89d7f56daf840215', // Configure Now Assist
  '2a8a89fedba581f2a30de64fae587d35', // Create an incident
  '2a8a89fedba581afa071e008f00d5118', // Integrate Coaching With Learning
];

async function checkPageValidation(pageId) {
  try {
    // Format page ID with hyphens for API call
    const formattedId = pageId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
    
    const page = await notion.pages.retrieve({ page_id: formattedId });
    
    // Get the Validation property
    const validation = page.properties?.Validation;
    
    return {
      id: pageId,
      title: page.properties?.Name?.title?.[0]?.plain_text || page.properties?.title?.title?.[0]?.plain_text || 'Unknown',
      validation: validation?.rich_text?.[0]?.plain_text || validation?.select?.name || 'No validation property',
      url: page.url
    };
  } catch (error) {
    return {
      id: pageId,
      title: 'Error',
      validation: `Error: ${error.message}`,
      url: null
    };
  }
}

async function main() {
  console.log('Checking validation status for pages...\n');
  
  const results = [];
  
  for (const pageId of pageIds) {
    const result = await checkPageValidation(pageId);
    results.push(result);
    
    // Determine if validation passed or failed
    const validationText = result.validation || '';
    const isPassed = validationText.includes('✅') || 
                     validationText.toLowerCase().includes('validation passed') ||
                     validationText === 'Valid' ||
                     validationText === 'Passed';
    const isFailed = validationText.includes('❌') || 
                     validationText.toLowerCase().includes('validation failed') ||
                     (validationText.toLowerCase().includes('marker leak') && 
                      !validationText.toLowerCase().includes('no marker leak'));
    
    if (result.validation && result.validation !== 'No validation property' && !result.validation.startsWith('Error:')) {
      const emoji = isPassed ? '✅' : (isFailed ? '❌' : '⚠️');
      console.log(`${emoji} ${result.title}`);
      console.log(`   Validation: ${result.validation}`);
      console.log(`   URL: ${result.url}\n`);
    }
  }
  
  // Summary - only count actual failures
  const pagesWithErrors = results.filter(r => {
    const validationText = r.validation || '';
    const isFailed = validationText.includes('❌') || 
                     validationText.toLowerCase().includes('validation failed') ||
                     (validationText.toLowerCase().includes('marker leak') && 
                      !validationText.toLowerCase().includes('no marker leak'));
    return r.validation && 
           r.validation !== 'No validation property' && 
           !r.validation.startsWith('Error:') &&
           isFailed;
  });
  
  // Count passed vs failed
  const pagesPassed = results.filter(r => {
    const validationText = r.validation || '';
    return (validationText.includes('✅') || 
            validationText.toLowerCase().includes('validation passed')) &&
           !validationText.toLowerCase().includes('validation failed');
  }).length;
  
  const pagesFailed = pagesWithErrors.length;
  
  console.log('\n' + '='.repeat(80));
  console.log(`Total pages checked: ${results.length}`);
  console.log(`✅ Pages passed: ${pagesPassed}`);
  console.log(`❌ Pages failed: ${pagesFailed}`);
  console.log('='.repeat(80));
  
  if (pagesWithErrors.length > 0) {
    // Group by error type
    const errorGroups = {};
    pagesWithErrors.forEach(page => {
      const error = page.validation;
      if (!errorGroups[error]) {
        errorGroups[error] = [];
      }
      errorGroups[error].push(page.title);
    });
    
    console.log('\n❌ Errors by type:');
    Object.entries(errorGroups).forEach(([error, pages]) => {
      console.log(`\n${error} (${pages.length} pages):`);
      pages.forEach(title => console.log(`  - ${title}`));
    });
  } else {
    console.log('\n✅ All pages passed validation!');
  }
}

main().catch(console.error);
