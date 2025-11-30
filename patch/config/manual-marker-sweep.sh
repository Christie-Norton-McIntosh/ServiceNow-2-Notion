#!/usr/bin/env bash
# Manual marker sweep for specific page IDs

PAGE_ID="${1:-2a8a89fe-dba5-8137-8dbe-d803a3e6c7f0}"

# Load .env file if it exists
if [ -f "server/.env" ]; then
  export $(grep -v '^#' server/.env | xargs)
fi

echo "Sweeping markers from page: $PAGE_ID"
echo ""

# Use Node to call the sweep function directly
cd server && node -e "
const { Client } = require('@notionhq/client');
const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function sweepPage(pageId) {
  console.log('Fetching all blocks...');
  let allBlocks = [];
  let cursor = undefined;
  
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor
    });
    allBlocks = allBlocks.concat(response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  
  console.log(\`Found \${allBlocks.length} blocks\`);
  
  // Find blocks with markers
  const markerRegex = /\\(sn2n:[a-zA-Z0-9_-]+\\)/gi;
  let updatedCount = 0;
  
  for (const block of allBlocks) {
    let needsUpdate = false;
    let updatedBlock = JSON.parse(JSON.stringify(block));
    
    // Check all rich_text arrays
    const checkRichText = (obj, path = '') => {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          checkRichText(obj[i], \`\${path}[\${i}]\`);
        }
      } else if (obj && typeof obj === 'object') {
        if (obj.rich_text && Array.isArray(obj.rich_text)) {
          for (let rt of obj.rich_text) {
            if (rt.text && rt.text.content && markerRegex.test(rt.text.content)) {
              console.log(\`  Found marker in block \${block.id}: \${rt.text.content}\`);
              rt.text.content = rt.text.content.replace(markerRegex, '').trim();
              needsUpdate = true;
            }
          }
        }
        for (const key in obj) {
          if (key !== 'id' && key !== 'type' && key !== 'parent' && key !== 'created_time' && key !== 'last_edited_time' && key !== 'created_by' && key !== 'last_edited_by' && key !== 'has_children' && key !== 'archived') {
            checkRichText(obj[key], \`\${path}.\${key}\`);
          }
        }
      }
    };
    
    checkRichText(updatedBlock);
    
    if (needsUpdate) {
      console.log(\`  Updating block \${block.id}...\`);
      const updatePayload = { [block.type]: updatedBlock[block.type] };
      
      try {
        await notion.blocks.update({
          block_id: block.id,
          ...updatePayload
        });
        updatedCount++;
        console.log(\`  ✅ Updated\`);
      } catch (error) {
        console.log(\`  ❌ Failed: \${error.message}\`);
      }
      
      // Small delay to avoid conflicts
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(\`\\nSweep complete: \${updatedCount} blocks updated\`);
}

sweepPage('$PAGE_ID').catch(console.error);
"
