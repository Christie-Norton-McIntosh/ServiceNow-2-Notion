// Test: Verify element IDs are incorporated into markers for debugging
//
// Purpose: Ensure generateMarker() uses element IDs when available to make
// duplicate detection and tracing easier in logs.
//
// Expected behavior:
// - List items with IDs should generate markers like "my-id__timestamp-random"
// - List items without IDs should generate markers like "timestamp-random"
// - Markers should appear in rich_text marker tokens

const axios = require('axios');

const htmlWithIds = `
<ul>
  <li id="step-with-id">
    Text content
    <div id="callout-with-id" class="note">
      <span class="note__title">Note: </span>
      This is a callout with nested content
      <ul>
        <li>Nested list item 1</li>
        <li>Nested list item 2</li>
      </ul>
    </div>
  </li>
  <li>
    Text without ID
    <div class="note">
      <span class="note__title">Note: </span>
      This callout has nested content but no ID
      <p>Nested paragraph</p>
    </div>
  </li>
</ul>
`;

async function test() {
  console.log('🧪 Testing element ID incorporation in markers...\n');
  
  try {
    const res = await axios.post('http://localhost:3004/api/W2N', {
      title: 'Marker element ID test',
      contentHtml: htmlWithIds,
      dryRun: true
    });
    
    const result = res.data.data;
    
    console.log(`📦 Total blocks: ${result.children.length}\n`);
    
    let hasIdMarker = false;
    let hasNoIdMarker = false;
    
    // Recursively search for markers in all blocks
    function findMarkers(blocks, depth = 0) {
      const indent = '  '.repeat(depth);
      
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        
        // Check if block has _sn2n_marker
        if (block._sn2n_marker) {
          const marker = block._sn2n_marker;
          console.log(`${indent}🔖 Block ${i} (type: ${block.type}) has marker: "${marker}"`);
          
          // Check if marker contains "step-with-id"
          if (marker.includes('step-with-id') || marker.includes('step_with_id')) {
            console.log(`${indent}   ✅ Marker contains element ID!`);
            hasIdMarker = true;
          } else if (marker.match(/^[a-z0-9]+\-[a-z0-9]+$/)) {
            // Marker format: "timestamp-random" (no element ID)
            console.log(`${indent}   ℹ️  Marker has no element ID (expected for list item without ID)`);
            hasNoIdMarker = true;
          }
        }
        
        // Check rich_text for marker tokens
        const blockType = block.type;
        if (blockType && block[blockType]?.rich_text) {
          const richText = block[blockType].rich_text;
          const markerTokens = richText.filter(rt => 
            rt.text?.content?.includes('(sn2n:')
          );
          
          if (markerTokens.length > 0) {
            markerTokens.forEach(rt => {
              const match = rt.text.content.match(/\(sn2n:([^)]+)\)/);
              if (match) {
                const markerToken = match[1];
                console.log(`${indent}🎫 Block ${i} (type: ${block.type}) has marker token in rich_text: "${markerToken}"`);
                
                if (markerToken.includes('step-with-id') || markerToken.includes('step_with_id')) {
                  console.log(`${indent}   ✅ Marker token contains element ID!`);
                  hasIdMarker = true;
                }
              }
            });
          }
        }
        
        // Recurse into children
        if (blockType && block[blockType]?.children) {
          findMarkers(block[blockType].children, depth + 1);
        }
        if (block.children) {
          findMarkers(block.children, depth + 1);
        }
      }
    }
    
    findMarkers(result.children);
    
    console.log('\n📋 Validation:');
    
    if (hasIdMarker) {
      console.log('✅ PASS: Found marker with element ID "step-with-id"');
    } else {
      console.log('❌ FAIL: No marker found with element ID "step-with-id"');
      console.log('\n📄 Full result for debugging:');
      console.log(JSON.stringify(result.children, null, 2));
    }
    
    if (hasNoIdMarker) {
      console.log('✅ PASS: Found marker without element ID (for list item without ID)');
    } else {
      console.log('⚠️  INFO: No marker without element ID found (this is OK if both list items got IDs)');
    }
    
    process.exit(hasIdMarker ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

test();
