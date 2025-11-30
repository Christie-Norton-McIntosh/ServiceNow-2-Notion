#!/usr/bin/env node

/**
 * Test script for POST /api/W2N/:pageId/cleanup-markers endpoint
 * 
 * Usage:
 *   node test-marker-cleanup-endpoint.cjs <pageId>
 * 
 * Example:
 *   node test-marker-cleanup-endpoint.cjs 1234567890abcdef1234567890abcdef
 */

const http = require('http');

const pageId = process.argv[2];

if (!pageId) {
  console.error('❌ Error: Page ID required');
  console.error('Usage: node test-marker-cleanup-endpoint.cjs <pageId>');
  process.exit(1);
}

// Remove hyphens if present
const cleanPageId = pageId.replace(/-/g, '');

if (cleanPageId.length !== 32) {
  console.error('❌ Error: Page ID must be 32 characters (UUID without hyphens)');
  process.exit(1);
}

console.log(`🧹 Testing marker cleanup endpoint for page ${cleanPageId}...`);

const options = {
  hostname: 'localhost',
  port: 3004,
  path: `/api/W2N/${cleanPageId}/cleanup-markers`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`\n📊 Status: ${res.statusCode}`);
    
    try {
      const result = JSON.parse(data);
      console.log('\n📦 Response:');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.success) {
        console.log(`\n✅ Success! Updated ${result.data.updated} block(s)`);
        console.log(`⏱️  Elapsed: ${(result.data.elapsedMs / 1000).toFixed(1)}s`);
      } else {
        console.log('\n❌ Request failed');
      }
    } catch (e) {
      console.error('❌ Failed to parse response:', e.message);
      console.log('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error.message);
  console.error('\n💡 Make sure the server is running on port 3004');
  console.error('   Run: npm start  (or use VS Code task "🚀 Start Server (Verbose)")');
  process.exit(1);
});

req.end();
